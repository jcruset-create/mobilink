/**
 * API de Mobilink Cash: `/api/cash/*`.
 *
 * Todas las rutas pasan por `authenticate` (sesión unificada de Supabase),
 * `requireModule("cash")` (licencia vigente) y `cargarPermisosCaja`. Es el
 * mismo encadenado que usan los demás módulos del SaaS; no hay puerta trasera.
 *
 * El router valida forma (que los números sean números, que las líneas de
 * denominación estén bien construidas) y delega TODO lo demás en el servicio,
 * que es quien decide con la jornada bloqueada. Aquí no hay ni una regla de
 * negocio: si la hubiera, existirían dos sitios donde mirar cuando algo cuadre
 * mal.
 */

import { Router, type Request, type RequestHandler, type Response } from "express";
import multer from "multer";
import pool from "../db.ts";
import { authenticate, requireModule } from "../core/auth.ts";
import { supabase, SUPABASE_STORAGE_BUCKET } from "../supabase.ts";
import { registrarAuditoria } from "../core/auditoria.ts";
import { cargarPermisosCaja, exigirPermiso } from "./permissions.ts";
import { miniaturaBoton, miniaturaFicha } from "./images.ts";
import { ErrorCaja, cargarDenominaciones, obtenerSesion, sesionAbierta, movimientosDeSesion } from "./repository.ts";
import type { LineaDenominacion } from "./domain/inventory.ts";
import { CAMBIO_MAXIMO_CENTIMOS } from "./domain/change.ts";
import * as servicio from "./service.ts";
import * as config from "./config.ts";
import * as tesoreria from "./treasury.ts";
import * as documentos from "./documents.ts";
import * as ingresos from "./bankdeposits.ts";
import { informeCierre } from "./report.ts";
import { conectorPara, configuracionErp, conectoresDisponibles, estadoIntegracion } from "./erp/registry.ts";
import { procesarOutbox, reintentarErrores } from "./erp/worker.ts";

/**
 * Subida de la imagen del botón. Instancia propia y no la de `server/index.ts`
 * porque el tratamiento es distinto: aquí la imagen se reduce a tamaño de botón
 * antes de guardarla.
 */
const subidaImagen = multer({
  storage: multer.memoryStorage(),
  // El límite es de entrada, no de almacenamiento: la imagen se reduce en el
  // servidor a tamaño de botón antes de guardarla, así que aceptar la foto de
  // un móvil no cuesta nada.
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
});

/**
 * Justificantes escaneados. El límite es mucho más alto que el de los iconos:
 * un PDF de varias páginas de un escáner de mostrador ronda los pocos MB, y
 * quedarse corto obligaría a rebajar la calidad del escaneo de una factura.
 */
const subidaDocumento = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
});

/**
 * Envuelve un middleware de multer para que sus errores hablen claro.
 *
 * Sin esto, un fichero que pasa del límite lanza un MulterError que se salta
 * el manejador del router —multer corre ANTES que `ruta()`— y acaba en el 500
 * genérico de la aplicación: "Error interno del servidor", sin pista ninguna.
 * Pasó de verdad con la imagen de un botón de cobro.
 */
/**
 * Reduce la imagen y la sube a Storage. Devuelve su URL.
 *
 * El tratamiento no es el mismo para todo. El logotipo de un banco llena su
 * botón y su fondo forma parte del logotipo —el azul del BBVA es el BBVA— así
 * que se deja tal cual. Un billete o una moneda es una ficha suelta que se
 * pinta sobre lo que sea, y la foto que uno encuentra viene en JPG sobre fondo
 * blanco: ahí el fondo se recorta.
 */
async function guardarImagenBoton(
  fichero: { buffer: Buffer },
  ruta_: string,
  tratamiento: "boton" | "ficha" = "boton"
): Promise<string> {
  const miniatura =
    tratamiento === "ficha"
      ? await miniaturaFicha(fichero.buffer)
      : await miniaturaBoton(fichero.buffer);

  let error: { message?: string } | null = null;
  try {
    ({ error } = await supabase.storage
      .from(SUPABASE_STORAGE_BUCKET)
      .upload(ruta_, miniatura, { contentType: "image/png", upsert: true }));
  } catch (e) {
    error = e as { message?: string };
  }
  if (error) {
    console.error("Mobilink Cash: error subiendo la imagen del botón:", error);
    throw new ErrorCaja("SUBIDA_FALLIDA", "No se ha podido guardar la imagen.", 502);
  }

  return supabase.storage.from(SUPABASE_STORAGE_BUCKET).getPublicUrl(ruta_).data.publicUrl;
}

function subida(mw: RequestHandler, limiteMb: number): RequestHandler {
  return (req, res, next) => {
    mw(req, res, (err?: unknown) => {
      if (!err) return next();
      const codigo = (err as { code?: string })?.code;
      if (codigo === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          error: `El fichero pasa de ${limiteMb} MB. Redúcelo o escanéalo con menos resolución.`,
          code: "FICHERO_DEMASIADO_GRANDE",
        });
      }
      console.error("[Mobilink Cash] error de subida:", err);
      res.status(400).json({
        error: "No se ha podido leer el fichero adjunto. Vuelve a intentarlo.",
        code: "SUBIDA_NO_VALIDA",
      });
    });
  };
}

// ── Validación de entrada ──────────────────────────────────────────────────

function entero(v: unknown, campo: string): number {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isSafeInteger(n)) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", `${campo} tiene que ser un número entero.`, 400);
  }
  return n;
}

function enteroPositivo(v: unknown, campo: string): number {
  const n = entero(v, campo);
  if (n <= 0) throw new ErrorCaja("ENTRADA_NO_VALIDA", `${campo} tiene que ser mayor que cero.`, 400);
  return n;
}

/**
 * Líneas de denominación. Se valida la forma con cuidado porque es la entrada
 * que acaba convertida en movimientos de dinero: un `cantidad: "3"` que se
 * cuele haría que `valor * cantidad` fuera una concatenación de texto.
 */
function lineas(v: unknown, campo: string): LineaDenominacion[] {
  if (v == null) return [];
  if (!Array.isArray(v)) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", `${campo} tiene que ser una lista de denominaciones.`, 400);
  }
  return v.map((l, i) => {
    if (!l || typeof l !== "object") {
      throw new ErrorCaja("ENTRADA_NO_VALIDA", `${campo}[${i}] no es una línea válida.`, 400);
    }
    const valor = enteroPositivo((l as Record<string, unknown>).valor, `${campo}[${i}].valor`);
    const cantidad = entero((l as Record<string, unknown>).cantidad, `${campo}[${i}].cantidad`);
    if (cantidad < 0) {
      throw new ErrorCaja("ENTRADA_NO_VALIDA", `${campo}[${i}].cantidad no puede ser negativa.`, 400);
    }
    return { valor, cantidad };
  }).filter((l) => l.cantidad > 0);
}

/**
 * Líneas que además llevan envases y una explicación: lo que se le pide al
 * banco y lo que el banco acaba dando. `cantidad` son SIEMPRE piezas;
 * `cartuchos` y `bolsas`, cuántos envases precintados son esas piezas.
 */
function lineasConCartuchos(
  v: unknown,
  campo: string
): {
  valor: number;
  cantidad: number;
  cartuchos: number;
  bolsas: number;
  motivo?: string;
}[] {
  if (v == null) return [];
  if (!Array.isArray(v)) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", `${campo} tiene que ser una lista de denominaciones.`, 400);
  }
  return v
    .map((l, i) => {
      if (!l || typeof l !== "object") {
        throw new ErrorCaja("ENTRADA_NO_VALIDA", `${campo}[${i}] no es una línea válida.`, 400);
      }
      const o = l as Record<string, unknown>;
      const cantidad = entero(o.cantidad, `${campo}[${i}].cantidad`);
      if (cantidad < 0) {
        throw new ErrorCaja("ENTRADA_NO_VALIDA", `${campo}[${i}].cantidad no puede ser negativa.`, 400);
      }
      const cartuchos = o.cartuchos == null ? 0 : entero(o.cartuchos, `${campo}[${i}].cartuchos`);
      if (cartuchos < 0) {
        throw new ErrorCaja("ENTRADA_NO_VALIDA", `${campo}[${i}].cartuchos no puede ser negativo.`, 400);
      }
      const bolsas = o.bolsas == null ? 0 : entero(o.bolsas, `${campo}[${i}].bolsas`);
      if (bolsas < 0) {
        throw new ErrorCaja("ENTRADA_NO_VALIDA", `${campo}[${i}].bolsas no puede ser negativo.`, 400);
      }
      if (cartuchos > 0 && bolsas > 0) {
        throw new ErrorCaja(
          "ENTRADA_NO_VALIDA",
          `${campo}[${i}] no puede ser cartucho y bolsa a la vez.`,
          400
        );
      }
      return {
        valor: enteroPositivo(o.valor, `${campo}[${i}].valor`),
        cantidad,
        cartuchos,
        bolsas,
        motivo: typeof o.motivo === "string" ? o.motivo : undefined,
      };
    })
    .filter((l) => l.cantidad > 0);
}

function formasPago(v: unknown): { forma: never; importe: number; referencia?: string | null }[] {
  if (!Array.isArray(v) || v.length === 0) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", "Hay que indicar al menos una forma de pago.", 400);
  }
  return v.map((f, i) => {
    const o = (f ?? {}) as Record<string, unknown>;
    if (typeof o.forma !== "string" || !o.forma) {
      throw new ErrorCaja("ENTRADA_NO_VALIDA", `formasPago[${i}].forma es obligatoria.`, 400);
    }
    return {
      forma: o.forma as never,
      importe: enteroPositivo(o.importe, `formasPago[${i}].importe`),
      referencia: typeof o.referencia === "string" ? o.referencia : null,
    };
  });
}

function contexto(req: Request): servicio.Contexto {
  return {
    empresaId: req.authCtx!.empresaId,
    userId: req.authCtx!.userId,
    ip: req.ip,
  };
}

/** Envuelve un handler async y traduce `ErrorCaja` a su código HTTP. */
function ruta(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof ErrorCaja) {
        return res.status(e.estado).json({ error: e.message, code: e.codigo, detalle: e.detalle });
      }
      console.error("[Mobilink Cash] error no controlado:", e);
      res.status(500).json({ error: "Error interno de Mobilink Cash" });
    }
  };
}

// ── Router ─────────────────────────────────────────────────────────────────

export function createCashRouter(): Router {
  const r = Router();

  r.use(authenticate, requireModule("cash"), cargarPermisosCaja);

  // ── Contexto de arranque de la interfaz ─────────────────────────────────
  r.get(
    "/bootstrap",
    exigirPermiso("cash.view"),
    ruta(async (req, res) => {
      const empresaId = req.authCtx!.empresaId;
      const [denominaciones, formasPago, cajas, erp, ajustes, secciones] = await Promise.all([
        cargarDenominaciones(pool, true),
        config.listarFormasPago(empresaId),
        pool.query(
          `SELECT id, centro, nombre FROM cash_registers
            WHERE empresa_id = $1 AND activa = true ORDER BY centro, nombre`,
          [empresaId]
        ),
        estadoIntegracion(empresaId),
        config.ajustes(empresaId),
        config.listarSecciones(empresaId),
      ]);

      res.json({
        denominaciones,
        formasPago,
        secciones,
        ajustes,
        cajas: cajas.rows,
        permisos: req.cashPermisos,
        rol: req.cashRol,
        erp: { estado: erp.estado, connectorKey: erp.connectorKey, displayName: erp.displayName },
        cambioMaximoCentimos: CAMBIO_MAXIMO_CENTIMOS,
      });
    })
  );

  // ── Cajas ────────────────────────────────────────────────────────────────

  r.get(
    "/registers",
    exigirPermiso("cash.configure"),
    ruta(async (req, res) => {
      res.json({ cajas: await config.listarCajas(req.authCtx!.empresaId) });
    })
  );

  r.post(
    "/registers",
    exigirPermiso("cash.configure"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const caja = await config.crearCaja(contexto(req), {
        nombre: typeof b.nombre === "string" ? b.nombre : "",
        centro: typeof b.centro === "string" ? b.centro : "",
      });
      res.status(201).json({ caja });
    })
  );

  r.patch(
    "/registers/:id",
    exigirPermiso("cash.configure"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const caja = await config.actualizarCaja(contexto(req), enteroPositivo(req.params.id, "id"), {
        nombre: typeof b.nombre === "string" ? b.nombre : undefined,
        centro: typeof b.centro === "string" ? b.centro : undefined,
        activa: typeof b.activa === "boolean" ? b.activa : undefined,
      });
      res.json({ caja });
    })
  );

  // ── Catálogo de denominaciones ───────────────────────────────────────────

  /** Todas, activas o no: la pantalla de configuración necesita las desactivadas. */
  r.get(
    "/denominations",
    exigirPermiso("cash.view"),
    ruta(async (_req, res) => {
      res.json({ denominaciones: await cargarDenominaciones(pool, false) });
    })
  );

  r.patch(
    "/denominations/:id",
    exigirPermiso("cash.denominations.configure"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      // `null` es un valor con significado (sin cartucho), así que se distingue
      // de "no se ha mandado el campo".
      const piezas =
        b.piezasPorCartucho === undefined
          ? undefined
          : b.piezasPorCartucho === null || b.piezasPorCartucho === ""
            ? null
            : entero(b.piezasPorCartucho, "piezasPorCartucho");
      const porBolsa =
        b.piezasPorBolsa === undefined
          ? undefined
          : b.piezasPorBolsa === null || b.piezasPorBolsa === ""
            ? null
            : entero(b.piezasPorBolsa, "piezasPorBolsa");

      const denominacion = await config.actualizarDenominacion(
        contexto(req),
        enteroPositivo(req.params.id, "id"),
        {
          activa: typeof b.activa === "boolean" ? b.activa : undefined,
          piezasPorCartucho: piezas,
          piezasPorBolsa: porBolsa,
        }
      );
      res.json({ denominacion });
    })
  );

  /**
   * Foto del billete o de la moneda.
   *
   * Va en el catálogo, que es de toda la instalación: un billete de 20 € se ve
   * igual en todas las empresas, así que la imagen se sube una vez. La URL no
   * se puede mandar por el PATCH a mano —solo se pone subiendo un fichero— para
   * que la pantalla no acabe cargando imágenes de cualquier sitio de internet.
   */
  r.post(
    "/denominations/:id/image",
    exigirPermiso("cash.denominations.configure"),
    subida(subidaImagen.single("imagen"), 8),
    ruta(async (req, res) => {
      const id = enteroPositivo(req.params.id, "id");
      const fichero = req.file;
      if (!fichero) {
        throw new ErrorCaja("ENTRADA_NO_VALIDA", "No ha llegado ninguna imagen.", 400);
      }
      if (!/^image\//.test(fichero.mimetype)) {
        throw new ErrorCaja("ENTRADA_NO_VALIDA", "El fichero tiene que ser una imagen.", 400);
      }

      const url = await guardarImagenBoton(
        fichero,
        `cash/denominations/${id}_${Date.now()}.png`,
        "ficha"
      );
      const denominacion = await config.actualizarDenominacion(contexto(req), id, {
        imagenUrl: url,
      });
      res.json({ denominacion });
    })
  );

  /**
   * Recorta el fondo de las fotos que ya estaban subidas.
   *
   * Las primeras se guardaron tal cual venían, con su fondo blanco de JPG
   * dentro. Volver a subir quince fotos a mano para arreglarlo es trabajo
   * tonto: el recorte funciona igual sobre lo que ya está guardado, así que se
   * hace desde aquí.
   *
   * La foto nueva se sube a otra ruta y la fila apunta a ella. Machacar la
   * anterior dejaría la pantalla enseñando la vieja durante horas, porque las
   * imágenes públicas de Storage se quedan en la caché del navegador.
   */
  r.post(
    "/denominations/images/rebuild",
    exigirPermiso("cash.denominations.configure"),
    ruta(async (req, res) => {
      const denominaciones = await cargarDenominaciones(pool, false);
      let recortadas = 0;
      const fallos: string[] = [];

      for (const d of denominaciones) {
        if (!d.imagenUrl) continue;
        try {
          const respuesta = await fetch(d.imagenUrl);
          if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
          const buffer = Buffer.from(await respuesta.arrayBuffer());
          const url = await guardarImagenBoton(
            { buffer },
            `cash/denominations/${d.id}_${Date.now()}.png`,
            "ficha"
          );
          await config.actualizarDenominacion(contexto(req), d.id, { imagenUrl: url });
          recortadas++;
        } catch (e) {
          // Una foto que falle no puede llevarse por delante las demás.
          console.error(`Mobilink Cash: no se ha podido recortar ${d.etiqueta}:`, e);
          fallos.push(d.etiqueta);
        }
      }

      res.json({
        recortadas,
        fallos,
        denominaciones: await cargarDenominaciones(pool, false),
      });
    })
  );

  r.delete(
    "/denominations/:id/image",
    exigirPermiso("cash.denominations.configure"),
    ruta(async (req, res) => {
      const denominacion = await config.actualizarDenominacion(
        contexto(req),
        enteroPositivo(req.params.id, "id"),
        { imagenUrl: null }
      );
      res.json({ denominacion });
    })
  );

  // ── Catálogo de formas de pago ───────────────────────────────────────────

  /** Todas, activas o no: Configuración necesita ver también las de baja. */
  r.get(
    "/payment-methods",
    exigirPermiso("cash.view"),
    ruta(async (req, res) => {
      res.json({ formasPago: await config.listarFormasPago(req.authCtx!.empresaId) });
    })
  );

  r.post(
    "/payment-methods",
    exigirPermiso("cash.configure"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const forma = await config.crearFormaPago(contexto(req), {
        nombre: typeof b.nombre === "string" ? b.nombre : "",
        codigo: typeof b.codigo === "string" ? b.codigo : undefined,
        pideReferencia: typeof b.pideReferencia === "boolean" ? b.pideReferencia : undefined,
        enCobros: typeof b.enCobros === "boolean" ? b.enCobros : undefined,
        enPagos: typeof b.enPagos === "boolean" ? b.enPagos : undefined,
        orden: b.orden === undefined ? undefined : entero(b.orden, "orden"),
      });
      res.status(201).json({ forma });
    })
  );

  r.patch(
    "/payment-methods/:id",
    exigirPermiso("cash.configure"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      // `null` borra la imagen y `undefined` la deja como está: son cosas
      // distintas y el cliente necesita poder decir las dos.
      const imagenUrl =
        b.imagenUrl === undefined
          ? undefined
          : b.imagenUrl === null || b.imagenUrl === ""
            ? null
            : String(b.imagenUrl);

      const forma = await config.actualizarFormaPago(
        contexto(req),
        enteroPositivo(req.params.id, "id"),
        {
          nombre: typeof b.nombre === "string" ? b.nombre : undefined,
          activa: typeof b.activa === "boolean" ? b.activa : undefined,
          pideReferencia: typeof b.pideReferencia === "boolean" ? b.pideReferencia : undefined,
          enCobros: typeof b.enCobros === "boolean" ? b.enCobros : undefined,
          enPagos: typeof b.enPagos === "boolean" ? b.enPagos : undefined,
          orden: b.orden === undefined ? undefined : entero(b.orden, "orden"),
          imagenUrl,
        }
      );
      res.json({ forma });
    })
  );

  /**
   * Imagen del botón.
   *
   * Mismo camino que el avatar de técnicos: multer en memoria y el fichero a
   * Supabase Storage, del que se guarda la URL pública. En disco local no,
   * porque el contenedor de Render es efímero y la imagen se perdería en el
   * siguiente despliegue.
   */
  r.post(
    "/payment-methods/:id/image",
    exigirPermiso("cash.configure"),
    subida(subidaImagen.single("imagen"), 8),
    ruta(async (req, res) => {
      const id = enteroPositivo(req.params.id, "id");
      const fichero = req.file;
      if (!fichero) {
        throw new ErrorCaja("ENTRADA_NO_VALIDA", "No ha llegado ninguna imagen.", 400);
      }
      if (!/^image\//.test(fichero.mimetype)) {
        throw new ErrorCaja("ENTRADA_NO_VALIDA", "El fichero tiene que ser una imagen.", 400);
      }

      const url = await guardarImagenBoton(
        fichero,
        `cash/payment-methods/${req.authCtx!.empresaId}/${id}_${Date.now()}.png`
      );
      const forma = await config.actualizarFormaPago(contexto(req), id, { imagenUrl: url });
      res.json({ forma });
    })
  );

  // ── Ajustes del módulo ───────────────────────────────────────────────────

  /**
   * Imagen del botón «Mixto».
   *
   * Va por ajustes y no por el catálogo de formas de pago porque Mixto no es
   * una forma de pago: es un reparto entre varias. Darle fila en el catálogo
   * permitiría registrar un cobro «en Mixto», que no dice por dónde entró el
   * dinero.
   */
  r.post(
    "/settings/mixed-image",
    exigirPermiso("cash.configure"),
    subida(subidaImagen.single("imagen"), 8),
    ruta(async (req, res) => {
      const fichero = req.file;
      if (!fichero) {
        throw new ErrorCaja("ENTRADA_NO_VALIDA", "No ha llegado ninguna imagen.", 400);
      }
      if (!/^image\//.test(fichero.mimetype)) {
        throw new ErrorCaja("ENTRADA_NO_VALIDA", "El fichero tiene que ser una imagen.", 400);
      }

      const url = await guardarImagenBoton(
        fichero,
        `cash/settings/${req.authCtx!.empresaId}/mixto_${Date.now()}.png`
      );
      res.json({ ajustes: await config.fijarAjuste(contexto(req), config.AJUSTES.MIXTO_IMAGEN, url) });
    })
  );

  r.delete(
    "/settings/mixed-image",
    exigirPermiso("cash.configure"),
    ruta(async (req, res) => {
      res.json({ ajustes: await config.fijarAjuste(contexto(req), config.AJUSTES.MIXTO_IMAGEN, null) });
    })
  );

  // ── Justificantes escaneados ─────────────────────────────────────────────

  r.get(
    "/operations/:id/documents",
    exigirPermiso("cash.view"),
    ruta(async (req, res) => {
      res.json({
        documentos: await documentos.documentosDeOperacion(
          req.authCtx!.empresaId,
          enteroPositivo(req.params.id, "id")
        ),
      });
    })
  );

  /**
   * Adjunta el PDF del escáner a una operación ya registrada.
   *
   * Va en su propia petición, después de crear el cobro, y no dentro de la
   * transacción: si el almacenamiento falla, el dinero ya está contado y solo
   * queda volver a adjuntar. Al revés, un fallo de red dejaría sin registrar un
   * cobro que ya ha ocurrido.
   */
  r.post(
    "/operations/:id/documents",
    exigirPermiso("cash.document.attach"),
    subida(subidaDocumento.single("documento"), 15),
    ruta(async (req, res) => {
      if (!req.file) {
        throw new ErrorCaja("ENTRADA_NO_VALIDA", "No ha llegado ningún documento.", 400);
      }
      const documento = await documentos.adjuntarDocumento(
        contexto(req),
        enteroPositivo(req.params.id, "id"),
        req.file
      );
      res.status(201).json({ documento });
    })
  );

  r.post(
    "/documents/:id/void",
    exigirPermiso("cash.document.void"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const documento = await documentos.anularDocumento(
        contexto(req),
        enteroPositivo(req.params.id, "id"),
        typeof b.motivo === "string" ? b.motivo : ""
      );
      res.json({ documento });
    })
  );

  /** Informe de cierre: el papeleo del día en un solo PDF. */
  r.get(
    "/sessions/:id/report.pdf",
    exigirPermiso("cash.view"),
    ruta(async (req, res) => {
      const sessionId = enteroPositivo(req.params.id, "id");
      const pdf = await informeCierre(req.authCtx!.empresaId, sessionId);
      const sesion = await obtenerSesion(sessionId);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="cierre-caja-${sesion?.fecha ?? sessionId}.pdf"`
      );
      res.send(pdf);
    })
  );

  // ── Ingresos bancarios ───────────────────────────────────────────────────

  /** Pendientes, remanente e historial de la caja: la pantalla en una llamada. */
  r.get(
    "/registers/:id/bank-deposits",
    exigirPermiso("cash.view"),
    ruta(async (req, res) => {
      const registerId = enteroPositivo(req.params.id, "id");
      res.json(await ingresos.panelIngresos(req.authCtx!.empresaId, registerId));
    })
  );

  r.post(
    "/bank-deposits",
    exigirPermiso("cash.treasury.manage"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      if (!Array.isArray(b.sessionIds)) {
        throw new ErrorCaja("ENTRADA_NO_VALIDA", "sessionIds tiene que ser una lista.", 400);
      }
      const ingreso = await ingresos.crearIngreso(contexto(req), {
        registerId: enteroPositivo(b.registerId, "registerId"),
        sessionIds: b.sessionIds.map((v: unknown, i: number) =>
          enteroPositivo(v, `sessionIds[${i}]`)
        ),
        importeCentimos: enteroPositivo(b.importeCentimos, "importeCentimos"),
        fechaIngreso:
          typeof b.fechaIngreso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.fechaIngreso)
            ? b.fechaIngreso
            : undefined,
        referencia: typeof b.referencia === "string" ? b.referencia : undefined,
        observaciones: typeof b.observaciones === "string" ? b.observaciones : undefined,
      });
      res.status(201).json({ ingreso });
    })
  );

  r.post(
    "/bank-deposits/:id/void",
    exigirPermiso("cash.treasury.manage"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const ingreso = await ingresos.anularIngreso(
        contexto(req),
        enteroPositivo(req.params.id, "id"),
        typeof b.motivo === "string" ? b.motivo : ""
      );
      res.json({ ingreso });
    })
  );

  // ── Tesorería: cambio al banco y entregas de dinero ──────────────────────

  r.get(
    "/registers/:id/treasury",
    exigirPermiso("cash.view"),
    ruta(async (req, res) => {
      const registerId = enteroPositivo(req.params.id, "id");
      const empresaId = req.authCtx!.empresaId;
      const [pedidos, entregas] = await Promise.all([
        tesoreria.listarPedidos(empresaId, registerId),
        tesoreria.listarEntregas(empresaId, registerId),
      ]);
      res.json({ pedidos, entregas });
    })
  );

  /** Lo que está fuera de la caja ahora: para los avisos de jornada y cierre. */
  r.get(
    "/registers/:id/treasury/pending",
    exigirPermiso("cash.view"),
    ruta(async (req, res) => {
      res.json(
        await tesoreria.pendientes(req.authCtx!.empresaId, enteroPositivo(req.params.id, "id"))
      );
    })
  );

  /** Qué conviene pedirle al banco. Es una consulta: no mueve nada. */
  r.get(
    "/sessions/:id/change-order/proposal",
    exigirPermiso("cash.treasury.manage"),
    ruta(async (req, res) => {
      const sessionId = enteroPositivo(req.params.id, "id");
      const sesion = await obtenerSesion(sessionId);
      if (!sesion || sesion.empresaId !== req.authCtx!.empresaId) {
        throw new ErrorCaja("JORNADA_NO_ENCONTRADA", "La jornada no existe.", 404);
      }
      const importe = enteroPositivo(req.query.importe, "importe");
      res.json(await tesoreria.proponerPedido(sessionId, sesion.registerId, importe));
    })
  );

  r.post(
    "/change-orders",
    exigirPermiso("cash.treasury.manage"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const pedido = await tesoreria.crearPedido(contexto(req), {
        sessionId: enteroPositivo(b.sessionId, "sessionId"),
        importeCentimos: enteroPositivo(b.importeCentimos, "importeCentimos"),
        solicitado: lineasConCartuchos(b.solicitado, "solicitado"),
        salida: lineas(b.salida, "salida"),
        notas: typeof b.notas === "string" ? b.notas : undefined,
      });
      res.status(201).json({ pedido });
    })
  );

  r.post(
    "/change-orders/:id/receive",
    exigirPermiso("cash.treasury.manage"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const pedido = await tesoreria.recibirPedido(
        contexto(req),
        enteroPositivo(req.params.id, "id"),
        {
          sessionId: enteroPositivo(b.sessionId, "sessionId"),
          recibido: lineasConCartuchos(b.recibido, "recibido"),
          diferenciaMotivo: typeof b.diferenciaMotivo === "string" ? b.diferenciaMotivo : undefined,
        }
      );
      res.json({ pedido });
    })
  );

  r.post(
    "/change-orders/:id/cancel",
    exigirPermiso("cash.treasury.manage"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const pedido = await tesoreria.cancelarPedido(
        contexto(req),
        enteroPositivo(req.params.id, "id"),
        enteroPositivo(b.sessionId, "sessionId"),
        typeof b.motivo === "string" ? b.motivo : ""
      );
      res.json({ pedido });
    })
  );

  r.post(
    "/advances",
    exigirPermiso("cash.treasury.manage"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const entrega = await tesoreria.entregarDinero(contexto(req), {
        sessionId: enteroPositivo(b.sessionId, "sessionId"),
        persona: typeof b.persona === "string" ? b.persona : "",
        motivo: typeof b.motivo === "string" ? b.motivo : "",
        importeCentimos: enteroPositivo(b.importeCentimos, "importeCentimos"),
        entregado: lineas(b.entregado, "entregado"),
        notas: typeof b.notas === "string" ? b.notas : undefined,
      });
      res.status(201).json({ entrega });
    })
  );

  r.post(
    "/advances/:id/settle",
    exigirPermiso("cash.treasury.manage"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const entrega = await tesoreria.liquidarEntrega(
        contexto(req),
        enteroPositivo(req.params.id, "id"),
        {
          sessionId: enteroPositivo(b.sessionId, "sessionId"),
          // Cero es válido: es el caso de "no compró nada y lo devuelve todo".
          gastoCentimos: entero(b.gastoCentimos ?? 0, "gastoCentimos"),
          devuelto: lineas(b.devuelto, "devuelto"),
          proveedor: typeof b.proveedor === "string" ? b.proveedor : undefined,
          facturaReferencia:
            typeof b.facturaReferencia === "string" ? b.facturaReferencia : undefined,
          concepto: typeof b.concepto === "string" ? b.concepto : undefined,
          diferenciaMotivo: typeof b.diferenciaMotivo === "string" ? b.diferenciaMotivo : undefined,
        }
      );
      res.json({ entrega });
    })
  );

  // ── Jornadas ─────────────────────────────────────────────────────────────
  r.get(
    "/registers/:id/session",
    exigirPermiso("cash.view"),
    ruta(async (req, res) => {
      const sesion = await sesionAbierta(enteroPositivo(req.params.id, "id"));
      if (!sesion) return res.json({ sesion: null });
      res.json(await servicio.resumenJornada(sesion.id));
    })
  );

  r.post(
    "/sessions",
    exigirPermiso("cash.open_session"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const salida = await servicio.abrirJornada(contexto(req), {
        registerId: enteroPositivo(b.registerId, "registerId"),
        fondoManual: lineas(b.fondoManual, "fondoManual"),
        fondoCartuchos: lineas(b.fondoCartuchos, "fondoCartuchos"),
        fondoBolsas: lineas(b.fondoBolsas, "fondoBolsas"),
        motivoFondoManual: typeof b.motivoFondoManual === "string" ? b.motivoFondoManual : undefined,
        fecha: typeof b.fecha === "string" && b.fecha !== "" ? b.fecha : undefined,
        permitirFechaRepetida: b.permitirFechaRepetida === true,
        notas: typeof b.notas === "string" ? b.notas : undefined,
      });
      res.status(201).json(salida);
    })
  );

  r.get(
    "/sessions/:id",
    exigirPermiso("cash.view"),
    ruta(async (req, res) => {
      res.json(await servicio.detalleJornada(enteroPositivo(req.params.id, "id")));
    })
  );

  r.get(
    "/sessions/:id/stock",
    exigirPermiso("cash.view"),
    ruta(async (req, res) => {
      res.json(await servicio.stockDeJornada(enteroPositivo(req.params.id, "id")));
    })
  );

  r.get(
    "/sessions/:id/movements",
    exigirPermiso("cash.view"),
    ruta(async (req, res) => {
      res.json({ movimientos: await movimientosDeSesion(enteroPositivo(req.params.id, "id")) });
    })
  );

  /** Propuesta de cambio. Es una consulta: no reserva nada. */
  r.get(
    "/sessions/:id/change",
    exigirPermiso("cash.view"),
    ruta(async (req, res) => {
      const importe = entero(req.query.importe, "importe");
      res.json(await servicio.proponerCambio(enteroPositivo(req.params.id, "id"), importe));
    })
  );

  r.post(
    "/sessions/:id/reopen",
    exigirPermiso("cash.session.reopen"),
    ruta(async (req, res) => {
      const motivo = String((req.body ?? {}).motivo ?? "");
      res.json({
        sesion: await servicio.reabrirJornada(contexto(req), enteroPositivo(req.params.id, "id"), motivo),
      });
    })
  );

  // ── Cobros ───────────────────────────────────────────────────────────────
  r.post(
    "/collections",
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const esManual = !b.externalDocumentId;

      // El encargo pedía justamente esto: se puede tener permiso para cobrar
      // facturas de la ERP y no tenerlo para inventarse un cobro manual.
      const permiso = esManual ? "cash.collection.create_manual" : "cash.collection.create";
      if (!req.cashPermisos?.includes(permiso)) {
        return res.status(403).json({ error: "No tienes permiso para este tipo de cobro.", code: "PERMISO_DENEGADO", permiso });
      }

      const salida = await servicio.registrarCobro(contexto(req), {
        sessionId: enteroPositivo(b.sessionId, "sessionId"),
        origen: esManual ? "MANUAL" : "ERP",
        importeCentimos: enteroPositivo(b.importeCentimos, "importeCentimos"),
        formasPago: formasPago(b.formasPago),
        efectivoRecibido: lineas(b.efectivoRecibido, "efectivoRecibido"),
        cambioManual: b.cambioManual ? lineas(b.cambioManual, "cambioManual") : undefined,
        partyNombre: typeof b.partyNombre === "string" ? b.partyNombre : "",
        concepto: typeof b.concepto === "string" ? b.concepto : "",
        referencia: typeof b.referencia === "string" ? b.referencia : null,
        documentoId: b.documentoId ? enteroPositivo(b.documentoId, "documentoId") : null,
        externalSystem: typeof b.externalSystem === "string" ? b.externalSystem : null,
        externalDocumentId: typeof b.externalDocumentId === "string" ? b.externalDocumentId : null,
        externalDocumentReference:
          typeof b.externalDocumentReference === "string" ? b.externalDocumentReference : null,
        sectionId: b.sectionId ? enteroPositivo(b.sectionId, "sectionId") : null,
      });
      res.status(201).json(salida);
    })
  );

  // ── Pagos ────────────────────────────────────────────────────────────────
  r.post(
    "/payments",
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const esManual = !b.externalDocumentId;
      const permiso = esManual ? "cash.payment.create_manual" : "cash.payment.create";
      if (!req.cashPermisos?.includes(permiso)) {
        return res.status(403).json({ error: "No tienes permiso para este tipo de pago.", code: "PERMISO_DENEGADO", permiso });
      }

      const salida = await servicio.registrarOperacion(contexto(req), {
        sessionId: enteroPositivo(b.sessionId, "sessionId"),
        tipo: "PAYMENT",
        origen: esManual ? "MANUAL" : "ERP",
        importeCentimos: enteroPositivo(b.importeCentimos, "importeCentimos"),
        formasPago: formasPago(b.formasPago),
        efectivoEntregado: lineas(b.efectivoEntregado, "efectivoEntregado"),
        // Vuelta del proveedor: se paga con un billete de 20 € un importe de
        // 19,50 € y devuelve 0,50 €. Salen 20 € y entran 0,50 €, y el motor
        // comprueba que la diferencia es exactamente el pago.
        efectivoRecibido: lineas(b.efectivoRecibido, "efectivoRecibido"),
        partyNombre: typeof b.partyNombre === "string" ? b.partyNombre : "",
        concepto: typeof b.concepto === "string" ? b.concepto : "",
        referencia: typeof b.referencia === "string" ? b.referencia : null,
        documentoId: b.documentoId ? enteroPositivo(b.documentoId, "documentoId") : null,
        externalSystem: typeof b.externalSystem === "string" ? b.externalSystem : null,
        externalDocumentId: typeof b.externalDocumentId === "string" ? b.externalDocumentId : null,
        externalDocumentReference:
          typeof b.externalDocumentReference === "string" ? b.externalDocumentReference : null,
        /*
         * Los pagos no preguntan la sección: van todos al negocio principal.
         * El campo se guarda igual, relleno con la sección por defecto, para
         * que el día que se quiera imputar el gasto a cada negocio no haya que
         * migrar datos reales. Si el cliente la manda, se respeta.
         */
        sectionId: b.sectionId
          ? enteroPositivo(b.sectionId, "sectionId")
          : await config.seccionPorDefecto(req.authCtx!.empresaId),
      });
      res.status(201).json(salida);
    })
  );

  /**
   * Reclasificar una operación: cambiarle la sección.
   *
   * `cash.configure` y no un permiso de cobro: no mueve dinero, pero cambia
   * un número que alguien mira para decidir, así que es cosa de responsable.
   */
  r.patch(
    "/operations/:id/section",
    exigirPermiso("cash.configure"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const salida = await servicio.cambiarSeccion(
        contexto(req),
        enteroPositivo(req.params.id, "id"),
        b.sectionId == null ? null : enteroPositivo(b.sectionId, "sectionId")
      );
      res.json(salida);
    })
  );

  /**
   * Regularizar la caja contra el último arqueo.
   *
   * `cash.adjustment.create` —permiso de responsable— porque esto SÍ mueve el
   * libro de piezas: deja el teórico igual a lo contado y escribe la
   * diferencia. No es lo mismo que contar, que puede hacer un cajero.
   */
  r.post(
    "/sessions/:id/regularize",
    exigirPermiso("cash.adjustment.create"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const salida = await servicio.regularizarArqueo(contexto(req), {
        sessionId: enteroPositivo(req.params.id, "id"),
        motivo: typeof b.motivo === "string" ? b.motivo : undefined,
      });
      res.status(201).json(salida);
    })
  );

  // ── Secciones de negocio ─────────────────────────────────────────────────

  r.get(
    "/sections",
    exigirPermiso("cash.view"),
    ruta(async (req, res) => {
      res.json({ secciones: await config.listarSecciones(req.authCtx!.empresaId) });
    })
  );

  r.post(
    "/sections",
    exigirPermiso("cash.configure"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const seccion = await config.crearSeccion(contexto(req), {
        nombre: typeof b.nombre === "string" ? b.nombre : "",
        codigo: typeof b.codigo === "string" ? b.codigo : undefined,
        orden: b.orden != null ? entero(b.orden, "orden") : undefined,
      });
      res.status(201).json({ seccion });
    })
  );

  r.patch(
    "/sections/:id",
    exigirPermiso("cash.configure"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const seccion = await config.actualizarSeccion(
        contexto(req),
        enteroPositivo(req.params.id, "id"),
        {
          nombre: typeof b.nombre === "string" ? b.nombre : undefined,
          activa: typeof b.activa === "boolean" ? b.activa : undefined,
          porDefecto: typeof b.porDefecto === "boolean" ? b.porDefecto : undefined,
          orden: b.orden != null ? entero(b.orden, "orden") : undefined,
        }
      );
      res.json({ seccion });
    })
  );

  // ── Otros movimientos de efectivo ────────────────────────────────────────
  const TIPOS_MOVIMIENTO = new Set(["MANUAL_IN", "MANUAL_OUT", "CASH_DELIVERY", "BANK_DEPOSIT", "ADJUSTMENT"]);

  r.post(
    "/movements",
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const tipo = String(b.tipo ?? "");
      if (!TIPOS_MOVIMIENTO.has(tipo)) {
        throw new ErrorCaja("ENTRADA_NO_VALIDA", `Tipo de movimiento no válido: ${tipo}.`, 400);
      }

      const permiso = tipo === "ADJUSTMENT" ? "cash.adjustment.create" : "cash.movement.create";
      if (!req.cashPermisos?.includes(permiso)) {
        return res.status(403).json({ error: "No tienes permiso para este movimiento.", code: "PERMISO_DENEGADO", permiso });
      }

      // Un ajuste sin motivo es un descuadre sin explicar: no se acepta.
      const concepto = typeof b.concepto === "string" ? b.concepto.trim() : "";
      if (tipo === "ADJUSTMENT" && !concepto) {
        throw new ErrorCaja("FALTA_MOTIVO", "Un ajuste exige indicar el motivo.", 400);
      }

      const importe = enteroPositivo(b.importeCentimos, "importeCentimos");
      const entra = tipo === "MANUAL_IN";

      const salida = await servicio.registrarOperacion(contexto(req), {
        sessionId: enteroPositivo(b.sessionId, "sessionId"),
        tipo: tipo as never,
        origen: "MANUAL",
        importeCentimos: importe,
        formasPago: [{ forma: "CASH" as never, importe }],
        efectivoRecibido: entra ? lineas(b.efectivo, "efectivo") : undefined,
        efectivoEntregado: entra ? undefined : lineas(b.efectivo, "efectivo"),
        // Tubos precintados: entran o salen sin abrirse. `cantidad` son tubos.
        cartuchosRecibidos: entra ? lineas(b.cartuchos, "cartuchos") : undefined,
        cartuchosEntregados: entra ? undefined : lineas(b.cartuchos, "cartuchos"),
        bolsasRecibidas: entra ? lineas(b.bolsas, "bolsas") : undefined,
        bolsasEntregadas: entra ? undefined : lineas(b.bolsas, "bolsas"),
        partyNombre: typeof b.partyNombre === "string" ? b.partyNombre : "",
        concepto,
        referencia: typeof b.referencia === "string" ? b.referencia : null,
      });
      res.status(201).json(salida);
    })
  );

  // ── Anulación por reversión ──────────────────────────────────────────────
  r.post(
    "/operations/:id/reverse",
    exigirPermiso("cash.operation.reverse"),
    ruta(async (req, res) => {
      const motivo = String((req.body ?? {}).motivo ?? "");
      res.json(
        await servicio.anularOperacion(contexto(req), enteroPositivo(req.params.id, "id"), motivo)
      );
    })
  );

  // ── Arqueo ───────────────────────────────────────────────────────────────
  r.post(
    "/sessions/:id/count",
    exigirPermiso("cash.count.create"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      res.status(201).json(
        await servicio.guardarArqueo(contexto(req), {
          sessionId: enteroPositivo(req.params.id, "id"),
          contado: lineas(b.contado, "contado"),
          cartuchos: lineas(b.cartuchos, "cartuchos"),
          bolsas: lineas(b.bolsas, "bolsas"),
          tipo: b.tipo === "INTERMEDIATE" ? "INTERMEDIATE" : "CLOSING",
          notas: typeof b.notas === "string" ? b.notas : undefined,
        })
      );
    })
  );

  // ── Cierre ───────────────────────────────────────────────────────────────
  r.get(
    "/sessions/:id/closing-proposal",
    exigirPermiso("cash.view"),
    ruta(async (req, res) => {
      const objetivo = entero(req.query.objetivo ?? 0, "objetivo");
      res.json(await servicio.proponerCierre(enteroPositivo(req.params.id, "id"), objetivo));
    })
  );

  r.post(
    "/sessions/:id/close",
    exigirPermiso("cash.close_session"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      res.json(
        await servicio.cerrarJornada(contexto(req), {
          sessionId: enteroPositivo(req.params.id, "id"),
          cambioFinal: lineas(b.cambioFinal, "cambioFinal"),
          cambioFinalCartuchos: lineas(b.cambioFinalCartuchos, "cambioFinalCartuchos"),
          cambioFinalBolsas: lineas(b.cambioFinalBolsas, "cambioFinalBolsas"),
          arqueoId: b.arqueoId ? enteroPositivo(b.arqueoId, "arqueoId") : undefined,
          notas: typeof b.notas === "string" ? b.notas : undefined,
        })
      );
    })
  );

  // ── Histórico ────────────────────────────────────────────────────────────
  r.get(
    "/sessions",
    exigirPermiso("cash.view"),
    ruta(async (req, res) => {
      const { desde, hasta, registerId, estado } = req.query;
      const filtros: string[] = ["s.empresa_id = $1"];
      const params: unknown[] = [req.authCtx!.empresaId];

      if (typeof desde === "string" && desde) {
        params.push(desde);
        filtros.push(`s.fecha >= $${params.length}`);
      }
      if (typeof hasta === "string" && hasta) {
        params.push(hasta);
        filtros.push(`s.fecha <= $${params.length}`);
      }
      if (registerId) {
        params.push(enteroPositivo(registerId, "registerId"));
        filtros.push(`s.register_id = $${params.length}`);
      }
      if (typeof estado === "string" && estado) {
        params.push(estado);
        filtros.push(`s.estado = $${params.length}`);
      }

      const { rows } = await pool.query(
        `SELECT s.*, c.nombre AS caja_nombre, c.centro AS caja_centro
           FROM cash_sessions s
           JOIN cash_registers c ON c.id = s.register_id
          WHERE ${filtros.join(" AND ")}
          ORDER BY s.fecha DESC, s.id DESC
          LIMIT 200`,
        params
      );
      res.json({ sesiones: rows });
    })
  );

  // ── Documentos de la ERP ─────────────────────────────────────────────────
  r.get(
    "/documents",
    exigirPermiso("cash.view"),
    ruta(async (req, res) => {
      const tipo = req.query.tipo === "PAYABLE" ? "SUPPLIER_INVOICE" : "CUSTOMER_INVOICE";
      const busca = typeof req.query.q === "string" ? req.query.q.trim() : "";

      const params: unknown[] = [req.authCtx!.empresaId, tipo];
      let filtroBusqueda = "";
      if (busca) {
        params.push(`%${busca}%`);
        filtroBusqueda = ` AND (numero ILIKE $3 OR party_nombre ILIKE $3 OR external_reference ILIKE $3)`;
      }

      const { rows } = await pool.query(
        `SELECT * FROM cash_external_documents
          WHERE empresa_id = $1 AND tipo = $2 AND estado IN ('OPEN','PARTIALLY_PAID')
          ${filtroBusqueda}
          ORDER BY fecha DESC NULLS LAST, id DESC
          LIMIT 100`,
        params
      );
      res.json({ documentos: rows });
    })
  );

  // ── Panel de integración ERP ─────────────────────────────────────────────
  r.get(
    "/erp/status",
    exigirPermiso("cash.erp.view"),
    ruta(async (req, res) => {
      const empresaId = req.authCtx!.empresaId;
      const estado = await estadoIntegracion(empresaId);

      const { rows: contadores } = await pool.query(
        `SELECT estado, COUNT(*) AS n FROM cash_erp_outbox WHERE empresa_id = $1 GROUP BY estado`,
        [empresaId]
      );
      const { rows: documentos } = await pool.query(
        `SELECT COUNT(*) AS n FROM cash_external_documents WHERE empresa_id = $1`,
        [empresaId]
      );
      const { rows: errores } = await pool.query(
        `SELECT evento, mobilink_id, last_error, intentos, created_at_ms
           FROM cash_erp_logs
          WHERE empresa_id = $1 AND estado = 'ERROR'
          ORDER BY id DESC LIMIT 20`,
        [empresaId]
      );

      res.json({
        ...estado,
        conectoresDisponibles: conectoresDisponibles(),
        documentosRecibidos: Number(documentos[0].n),
        outbox: Object.fromEntries(
          contadores.map((c: { estado: string; n: string }) => [c.estado, Number(c.n)])
        ),
        errores,
      });
    })
  );

  r.post(
    "/erp/test",
    exigirPermiso("cash.erp.view"),
    ruta(async (req, res) => {
      const { conector } = await conectorPara(req.authCtx!.empresaId);
      if (!conector) {
        return res.json({ ok: false, mensaje: "No hay ninguna ERP configurada. Mobilink Cash funciona en modo autónomo." });
      }
      res.json(await conector.probarConexion());
    })
  );

  /**
   * Importa los documentos pendientes de la ERP a la caché local.
   *
   * El upsert por (empresa, sistema, id) es lo que evita duplicar una factura
   * que ya se había importado: se actualiza en vez de insertarse otra vez.
   */
  r.post(
    "/erp/sync",
    exigirPermiso("cash.erp.sync"),
    ruta(async (req, res) => {
      const empresaId = req.authCtx!.empresaId;
      const { conector, config } = await conectorPara(empresaId);
      if (!conector) throw new ErrorCaja("ERP_NO_CONFIGURADA", "No hay ninguna ERP configurada.", 409);

      const ahora = Date.now();
      const aCobrar = conector.documentosACobrar ? await conector.documentosACobrar() : [];
      const aPagar = conector.documentosAPagar ? await conector.documentosAPagar() : [];
      let importados = 0;

      for (const d of [...aCobrar, ...aPagar]) {
        await pool.query(
          `INSERT INTO cash_external_documents
             (empresa_id, external_system, external_id, external_reference, tipo, party_tipo,
              party_external_id, party_nombre, numero, fecha, vencimiento, total_centimos,
              pendiente_centimos, moneda, estado_erp, metadata, last_sync_at_ms,
              created_at_ms, updated_at_ms)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17,$17)
           ON CONFLICT (empresa_id, external_system, external_id) DO UPDATE SET
             external_reference = EXCLUDED.external_reference,
             party_nombre = EXCLUDED.party_nombre,
             numero = EXCLUDED.numero,
             fecha = EXCLUDED.fecha,
             vencimiento = EXCLUDED.vencimiento,
             total_centimos = EXCLUDED.total_centimos,
             -- El pendiente NO se pisa si aquí ya se ha cobrado algo que la ERP
             -- todavía no conoce: se queda el menor de los dos, que es el que
             -- no permite cobrar de más.
             pendiente_centimos = LEAST(cash_external_documents.pendiente_centimos, EXCLUDED.pendiente_centimos),
             estado_erp = EXCLUDED.estado_erp,
             metadata = EXCLUDED.metadata,
             last_sync_at_ms = EXCLUDED.last_sync_at_ms,
             updated_at_ms = EXCLUDED.updated_at_ms`,
          [
            empresaId,
            d.externalSystem,
            d.externalId,
            d.externalReference ?? null,
            d.tipo,
            d.parteTipo,
            d.parteExternalId ?? null,
            d.parteNombre,
            d.numero,
            d.fecha ?? null,
            d.vencimiento ?? null,
            d.totalCentimos,
            d.pendienteCentimos,
            d.moneda,
            d.estadoErp ?? null,
            d.metadata ? JSON.stringify(d.metadata) : null,
            ahora,
          ]
        );
        importados++;
      }

      if (config) {
        await pool.query(
          `UPDATE cash_erp_configs SET last_sync_at_ms = $2, last_status = 'ok', last_error = NULL, updated_at_ms = $2
            WHERE id = $1`,
          [config.id, ahora]
        );
      }

      await registrarAuditoria({
        empresaId,
        userId: req.authCtx!.userId,
        accion: "cash.erp.sync",
        entidad: "cash_external_documents",
        detalle: { importados },
        ip: req.ip,
      });

      res.json({ importados });
    })
  );

  r.post(
    "/erp/retry",
    exigirPermiso("cash.erp.sync"),
    ruta(async (req, res) => {
      const reencolados = await reintentarErrores(req.authCtx!.empresaId);
      const tratados = await procesarOutbox(50);
      res.json({ reencolados, tratados });
    })
  );

  r.get(
    "/erp/config",
    exigirPermiso("cash.erp.configure"),
    ruta(async (req, res) => {
      // Nunca se devuelven credenciales: `ajustes` guarda solo lo no secreto.
      res.json({ config: await configuracionErp(req.authCtx!.empresaId) });
    })
  );

  r.put(
    "/erp/config",
    exigirPermiso("cash.erp.configure"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const connectorKey = String(b.connectorKey ?? "");
      if (!conectoresDisponibles().includes(connectorKey)) {
        throw new ErrorCaja("CONECTOR_DESCONOCIDO", `No existe el conector "${connectorKey}".`, 400);
      }
      const ahora = Date.now();
      const { rows } = await pool.query(
        `INSERT INTO cash_erp_configs
           (empresa_id, centro, connector_key, activo, ajustes, permite_cobro_parcial, created_at_ms, updated_at_ms)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
         ON CONFLICT (empresa_id, centro) DO UPDATE SET
           connector_key = EXCLUDED.connector_key,
           activo = EXCLUDED.activo,
           ajustes = EXCLUDED.ajustes,
           permite_cobro_parcial = EXCLUDED.permite_cobro_parcial,
           updated_at_ms = EXCLUDED.updated_at_ms
         RETURNING *`,
        [
          req.authCtx!.empresaId,
          typeof b.centro === "string" ? b.centro : "",
          connectorKey,
          Boolean(b.activo),
          JSON.stringify(b.ajustes ?? {}),
          b.permiteCobroParcial !== false,
          ahora,
        ]
      );

      await registrarAuditoria({
        empresaId: req.authCtx!.empresaId,
        userId: req.authCtx!.userId,
        accion: "cash.erp.configure",
        entidad: "cash_erp_configs",
        entidadId: String(rows[0].id),
        detalle: { connectorKey, activo: Boolean(b.activo) },
        ip: req.ip,
      });

      res.json({ config: rows[0] });
    })
  );

  return r;
}

export { obtenerSesion };
