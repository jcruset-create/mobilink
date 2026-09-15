/**
 * API del módulo Recepciones: `/api/recepciones/*`.
 *
 * Todas las rutas pasan por `authenticate` (sesión unificada de Supabase),
 * `requireModule("recepciones")` (licencia vigente) y `cargarPermisos`. El
 * mismo encadenado que Therefore, Cash y Tacógrafos.
 *
 * Aquí sólo se valida FORMA; las reglas viven en `domain/` y los casos de uso
 * en `service.ts`. La empresa sale SIEMPRE de `req.authCtx`, nunca del cuerpo.
 *
 * El centro del usuario (`req.recepcionesCentroId`) filtra la bandeja: un
 * operario con centro asignado ve sólo lo de su centro; sin centro ve toda la
 * empresa y puede filtrar por el que quiera.
 */

import { Router, type Request, type Response } from "express";
import multer from "multer";
import { authenticate, requireModule } from "../core/auth.ts";
import { registrarAuditoria } from "../core/auditoria.ts";
import {
  ESTADOS_ALBARAN,
  ESTADOS_INCIDENCIA,
  ESTADOS_PEDIDO,
  ETIQUETA_ESTADO_ALBARAN,
  ETIQUETA_ESTADO_PEDIDO,
  ETIQUETA_TIPO_INCIDENCIA,
  RESULTADOS_RECEPCION,
  TIPOS_INCIDENCIA,
} from "./domain/estados.ts";
import { ErrorRecepciones } from "./errors.ts";
import { cargarPermisos, exigirPermiso } from "./permissions.ts";
import * as repo from "./repository.ts";
import * as servicio from "./service.ts";
import { guardarDocumento, hashDeFichero, leerDocumento, rutaDocumento } from "./storage.ts";
import { limpio } from "./documentos/generar.ts";

/** Envuelve un manejador para que un fallo no se lleve por delante el proceso. */
function ruta(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof ErrorRecepciones) {
        return res
          .status(e.estado)
          .json({ error: e.message, code: e.codigo, ...(e.detalle ? { detalle: e.detalle } : {}) });
      }
      console.error("[Recepciones] error no controlado:", e);
      res.status(500).json({ error: "Error interno del módulo Recepciones" });
    }
  };
}

function contextoDe(req: Request): servicio.Contexto {
  const ctx = req.authCtx!;
  return { empresaId: ctx.empresaId, userId: ctx.userId, userNombre: ctx.nombre, ip: req.ip };
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * El centro que se aplica a una consulta: el del usuario si lo tiene (no se
 * puede saltar), o el que pida por query si no lo tiene.
 */
function centroDe(req: Request): string | null {
  if (req.recepcionesCentroId) return req.recepcionesCentroId;
  const q = texto(req.query.centroId);
  return q || null;
}

/** Un PDF de hasta 15 MB. */
const subidaPdf = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

export function createRecepcionesRouter(): Router {
  const r = Router();
  r.use(authenticate, requireModule("recepciones"), cargarPermisos);

  /* ── Bootstrap ─────────────────────────────────────────────────────────── */

  r.get(
    "/bootstrap",
    exigirPermiso("recepciones.view"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const [proveedores, centros, contadores] = await Promise.all([
        repo.listarProveedores(ctx.empresaId),
        repo.listarCentros(ctx.empresaId),
        repo.contarBandeja(ctx.empresaId, req.recepcionesCentroId ?? null),
      ]);
      res.json({
        rol: req.recepcionesRol ?? null,
        permisos: req.recepcionesPermisos ?? [],
        centroId: req.recepcionesCentroId ?? null,
        usuario: { id: ctx.userId, nombre: ctx.userNombre },
        proveedores,
        centros,
        contadores,
        // Los vocabularios los manda el servidor para que el panel no tenga
        // una copia que se quede vieja.
        vocabulario: {
          estadosPedido: ESTADOS_PEDIDO,
          estadosAlbaran: ESTADOS_ALBARAN,
          estadosIncidencia: ESTADOS_INCIDENCIA,
          tiposIncidencia: TIPOS_INCIDENCIA,
          resultados: RESULTADOS_RECEPCION,
          etiquetas: {
            estadoPedido: ETIQUETA_ESTADO_PEDIDO,
            estadoAlbaran: ETIQUETA_ESTADO_ALBARAN,
            tipoIncidencia: ETIQUETA_TIPO_INCIDENCIA,
          },
        },
      });
    })
  );

  /* ── Bandeja ───────────────────────────────────────────────────────────── */

  r.get(
    "/bandeja",
    exigirPermiso("recepciones.view"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const pestana = texto(req.query.pestana);
      const filas = await repo.listarAlbaranes(ctx.empresaId, {
        pestana: pestana === "recibidos" ? "recibidos" : pestana === "todos" ? "" : "pendientes",
        estado: texto(req.query.estado) || undefined,
        centroId: centroDe(req),
        proveedorId: texto(req.query.proveedorId) || undefined,
        texto: texto(req.query.q) || undefined,
      });
      const contadores = await repo.contarBandeja(ctx.empresaId, req.recepcionesCentroId ?? null);
      res.json({ albaranes: filas, contadores });
    })
  );

  /* ── Proveedores y mapeo ───────────────────────────────────────────────── */

  r.get(
    "/proveedores",
    exigirPermiso("recepciones.view"),
    ruta(async (req, res) => {
      res.json({ proveedores: await repo.listarProveedores(contextoDe(req).empresaId) });
    })
  );

  r.post(
    "/proveedores",
    exigirPermiso("recepciones.proveedores.manage"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const b = (req.body ?? {}) as Record<string, unknown>;
      const proveedor = await servicio.crearProveedor(ctx, {
        codigo: texto(b.codigo),
        nombre: texto(b.nombre),
        nif: texto(b.nif) || null,
        remitentesCorreo: Array.isArray(b.remitentesCorreo) ? b.remitentesCorreo.map(String) : [],
      });
      void registrarAuditoria({ empresaId: ctx.empresaId, userId: ctx.userId, accion: "recepciones.proveedor.crear", entidad: "rcp_proveedores", entidadId: proveedor.id, ip: req.ip });
      res.status(201).json({ proveedor });
    })
  );

  r.patch(
    "/proveedores/:id",
    exigirPermiso("recepciones.proveedores.manage"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const b = (req.body ?? {}) as Record<string, unknown>;
      const proveedor = await repo.actualizarProveedor(ctx.empresaId, String(req.params.id), {
        nombre: texto(b.nombre) || undefined,
        nif: b.nif === undefined ? undefined : texto(b.nif) || null,
        remitentesCorreo: Array.isArray(b.remitentesCorreo) ? b.remitentesCorreo.map(String) : undefined,
        activo: typeof b.activo === "boolean" ? b.activo : undefined,
      });
      if (!proveedor) throw new ErrorRecepciones("PROVEEDOR_NO_ENCONTRADO", "Proveedor no encontrado.", 404);
      res.json({ proveedor });
    })
  );

  r.get(
    "/mapeo",
    exigirPermiso("recepciones.view"),
    ruta(async (req, res) => {
      res.json({ mapeos: await repo.listarMapeos(contextoDe(req).empresaId, texto(req.query.proveedorId) || undefined) });
    })
  );

  r.post(
    "/mapeo",
    exigirPermiso("recepciones.recibir"),
    ruta(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const mapeo = await servicio.confirmarMapeo(contextoDe(req), {
        proveedorId: texto(b.proveedorId),
        descripcionProveedor: texto(b.descripcionProveedor),
        referenciaProveedor: texto(b.referenciaProveedor) || null,
        productoId: texto(b.productoId) || null,
        productoTexto: texto(b.productoTexto) || null,
        ean: texto(b.ean) || null,
      });
      res.status(201).json({ mapeo });
    })
  );

  /* ── Pedidos ───────────────────────────────────────────────────────────── */

  r.get(
    "/pedidos",
    exigirPermiso("recepciones.view"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const pedidos = await repo.listarPedidos(ctx.empresaId, {
        estado: texto(req.query.estado) || undefined,
        centroId: centroDe(req),
        proveedorId: texto(req.query.proveedorId) || undefined,
        texto: texto(req.query.q) || undefined,
      });
      res.json({ pedidos });
    })
  );

  r.post(
    "/pedidos",
    exigirPermiso("recepciones.pedido.create"),
    ruta(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const lineas = Array.isArray(b.lineas) ? (b.lineas as Record<string, unknown>[]) : [];
      const ficha = await servicio.crearPedido(contextoDe(req), {
        proveedorId: texto(b.proveedorId),
        numeroProveedor: texto(b.numeroProveedor),
        fechaPedido: texto(b.fechaPedido) || null,
        usuarioPedido: texto(b.usuarioPedido) || null,
        centroId: texto(b.centroId) || null,
        centroNombre: texto(b.centroNombre) || null,
        almacenOrigen: texto(b.almacenOrigen) || null,
        transportista: texto(b.transportista) || null,
        observaciones: texto(b.observaciones) || null,
        lineas: lineas.map((l) => ({
          referenciaProveedor: texto(l.referenciaProveedor) || null,
          descripcionProveedor: texto(l.descripcionProveedor),
          cantidadPedida: l.cantidadPedida as number | string,
          precioUnitarioCentimos: l.precioUnitarioCentimos == null || l.precioUnitarioCentimos === "" ? null : Number(l.precioUnitarioCentimos),
        })),
      });
      res.status(201).json(ficha);
    })
  );

  r.get(
    "/pedidos/:id",
    exigirPermiso("recepciones.view"),
    ruta(async (req, res) => {
      const ficha = await servicio.fichaPedido(contextoDe(req), String(req.params.id));
      if (!ficha) throw new ErrorRecepciones("PEDIDO_NO_ENCONTRADO", "Pedido no encontrado.", 404);
      res.json(ficha);
    })
  );

  r.post(
    "/pedidos/:id/cancelar",
    exigirPermiso("recepciones.pedido.create"),
    ruta(async (req, res) => {
      const pedido = await servicio.cancelarPedido(contextoDe(req), String(req.params.id), texto((req.body ?? {}).motivo));
      res.json({ pedido });
    })
  );

  r.post(
    "/pedidos/:id/albaranes",
    exigirPermiso("recepciones.albaran.create"),
    ruta(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const lineas = Array.isArray(b.lineas) ? (b.lineas as Record<string, unknown>[]) : [];
      const ficha = await servicio.crearAlbaran(contextoDe(req), String(req.params.id), {
        numeroProveedor: texto(b.numeroProveedor),
        fechaExpedicion: texto(b.fechaExpedicion) || null,
        transportista: texto(b.transportista) || null,
        observaciones: texto(b.observaciones) || null,
        lineas: lineas.map((l) => ({
          pedidoLineaId: texto(l.pedidoLineaId) || null,
          descripcionProveedor: texto(l.descripcionProveedor) || null,
          referenciaProveedor: texto(l.referenciaProveedor) || null,
          cantidadExpedida: l.cantidadExpedida as number | string,
        })),
      });
      res.status(201).json(ficha);
    })
  );

  /* ── Albaranes ─────────────────────────────────────────────────────────── */

  r.get(
    "/albaranes/:id",
    exigirPermiso("recepciones.view"),
    ruta(async (req, res) => {
      const ficha = await servicio.fichaAlbaran(contextoDe(req), String(req.params.id));
      if (!ficha) throw new ErrorRecepciones("ALBARAN_NO_ENCONTRADO", "Albarán no encontrado.", 404);
      res.json(ficha);
    })
  );

  /** El cierre. Ver `service.cerrarRecepcion` para la transacción y el cerrojo. */
  r.post(
    "/albaranes/:id/recepcion",
    exigirPermiso("recepciones.recibir"),
    ruta(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const lineas = Array.isArray(b.lineas) ? (b.lineas as Record<string, unknown>[]) : [];
      const clave = texto(req.headers["idempotency-key"]) || texto(b.idempotencyKey) || null;
      const resultado = await servicio.cerrarRecepcion(contextoDe(req), String(req.params.id), {
        resultado: texto(b.resultado) as "OK" | "CON_INCIDENCIA",
        observaciones: texto(b.observaciones) || null,
        idempotencyKey: clave,
        lineas: lineas.map((l) => {
          const inc = (l.incidencia ?? null) as Record<string, unknown> | null;
          return {
            albaranLineaId: texto(l.albaranLineaId),
            cantidadRecibida: l.cantidadRecibida as number | string,
            incidencia: inc && texto(inc.tipo) ? { tipo: texto(inc.tipo), observaciones: texto(inc.observaciones) || null } : null,
          };
        }),
      });
      res.status(resultado.repetida ? 200 : 201).json(resultado);
    })
  );

  r.post(
    "/albaranes/:id/cerrar",
    exigirPermiso("recepciones.incidencia.manage"),
    ruta(async (req, res) => {
      const albaran = await servicio.cerrarAlbaranConDiferencia(contextoDe(req), String(req.params.id), texto((req.body ?? {}).motivo));
      res.json({ albaran });
    })
  );

  /**
   * El PDF original del proveedor. Se guarda byte a byte, por hash, y sólo
   * uno por albarán: subir otro es un 409, no una sustitución.
   */
  r.post(
    "/albaranes/:id/original",
    exigirPermiso("recepciones.albaran.create"),
    (req, res, next) =>
      subidaPdf.single("documento")(req, res, (e) => {
        if (e) return res.status(400).json({ error: "No se ha podido leer el fichero (máx. 15 MB).", code: "FICHERO_INVALIDO" });
        next();
      }),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const fichero = req.file;
      if (!fichero) throw new ErrorRecepciones("FICHERO_REQUERIDO", "Falta el PDF del albarán (campo «documento»).");
      const esPdf = fichero.mimetype === "application/pdf" || fichero.buffer.subarray(0, 5).toString() === "%PDF-";
      if (!esPdf) throw new ErrorRecepciones("NO_ES_PDF", "El albarán original tiene que ser un PDF.");
      const albaran = await repo.albaranPorId(ctx.empresaId, String(req.params.id));
      if (!albaran) throw new ErrorRecepciones("ALBARAN_NO_ENCONTRADO", "Albarán no encontrado.", 404);
      if (await repo.originalDeAlbaran(ctx.empresaId, albaran.id)) {
        throw new ErrorRecepciones("ORIGINAL_YA_EXISTE", "Este albarán ya tiene su original. No se sobrescribe.", 409);
      }
      const hash = hashDeFichero(fichero.buffer);
      const ruta = rutaDocumento(ctx.empresaId, hash);
      await guardarDocumento(ruta, fichero.buffer);
      const documento = await repo.crearDocumento(ctx.empresaId, {
        tipo: "ALBARAN_ORIGINAL",
        albaranId: albaran.id,
        recepcionId: null,
        nombreFichero: `${albaran.proveedorCodigo}_${limpio(albaran.numeroProveedor)}_ORIGINAL.pdf`,
        storagePath: ruta,
        hashSha256: hash,
        tamanoBytes: fichero.buffer.length,
        mime: "application/pdf",
        origen: "SUBIDA_MANUAL",
        generadoDesdeHash: null,
        subidoPor: ctx.userId,
        subidoNombre: ctx.userNombre,
      });
      await repo.anotarEvento(ctx.empresaId, {
        pedidoId: albaran.pedidoId,
        albaranId: albaran.id,
        tipo: "ORIGINAL_ADJUNTADO",
        usuarioId: ctx.userId,
        usuarioNombre: ctx.userNombre,
        datos: { documentoId: documento.id, hash },
        descripcion: `PDF original del albarán ${albaran.numeroProveedor} adjuntado (${documento.nombreFichero}).`,
      });
      res.status(201).json({ documento });
    })
  );

  /* ── Recepciones ───────────────────────────────────────────────────────── */

  r.get(
    "/recepciones/:id",
    exigirPermiso("recepciones.view"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const recepcion = await repo.recepcionPorId(ctx.empresaId, String(req.params.id));
      if (!recepcion) throw new ErrorRecepciones("RECEPCION_NO_ENCONTRADA", "Recepción no encontrada.", 404);
      const [albaran, lineas, incidencias, documentos, rectificaciones] = await Promise.all([
        repo.albaranPorId(ctx.empresaId, recepcion.albaranId),
        repo.lineasDeRecepcion(ctx.empresaId, recepcion.id),
        repo.listarIncidencias(ctx.empresaId, { recepcionId: recepcion.id }),
        repo.documentosDeRecepcion(ctx.empresaId, recepcion.id),
        repo.rectificacionesDeRecepcion(ctx.empresaId, recepcion.id),
      ]);
      res.json({ recepcion, albaran, lineas, incidencias, documentos, rectificaciones });
    })
  );

  r.post(
    "/recepciones/:id/rectificar",
    exigirPermiso("recepciones.rectificar"),
    ruta(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const lineas = Array.isArray(b.lineas) ? (b.lineas as Record<string, unknown>[]) : [];
      const rectificacion = await servicio.rectificarRecepcion(contextoDe(req), String(req.params.id), {
        motivo: texto(b.motivo),
        lineas: lineas.map((l) => ({ recepcionLineaId: texto(l.recepcionLineaId), cantidadRecibida: l.cantidadRecibida as number | string })),
      });
      res.status(201).json({ rectificacion });
    })
  );

  r.post(
    "/recepciones/:id/documento/regenerar",
    exigirPermiso("recepciones.rectificar"),
    ruta(async (req, res) => {
      res.json({ recepcion: await servicio.regenerarDocumento(contextoDe(req), String(req.params.id)) });
    })
  );

  /* ── Documentos ────────────────────────────────────────────────────────── */

  /**
   * El contenido del PDF, en línea. Se sirve por aquí y no por enlace firmado
   * para que el panel lo pueda abrir en un iframe con la sesión y lanzar
   * `window.print()` sobre él; un enlace al bucket no llevaría la cabecera.
   */
  r.get(
    "/documentos/:id/contenido",
    exigirPermiso("recepciones.view"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const documento = await repo.documentoPorId(ctx.empresaId, String(req.params.id));
      if (!documento) throw new ErrorRecepciones("DOCUMENTO_NO_ENCONTRADO", "Documento no encontrado.", 404);
      const contenido = await leerDocumento(documento.storagePath);
      if (!contenido) throw new ErrorRecepciones("DOCUMENTO_ILEGIBLE", "El documento no está disponible en el almacenamiento.", 404);
      res.setHeader("Content-Type", documento.mime);
      res.setHeader("Content-Disposition", `inline; filename="${documento.nombreFichero}"`);
      res.setHeader("X-Documento-Sha256", documento.hashSha256);
      res.end(contenido);
    })
  );

  /** Comprueba que lo guardado sigue siendo lo que se generó. */
  r.get(
    "/documentos/:id/verificar",
    exigirPermiso("recepciones.view"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const documento = await repo.documentoPorId(ctx.empresaId, String(req.params.id));
      if (!documento) throw new ErrorRecepciones("DOCUMENTO_NO_ENCONTRADO", "Documento no encontrado.", 404);
      const contenido = await leerDocumento(documento.storagePath);
      const hashActual = contenido ? hashDeFichero(contenido) : null;
      res.json({ documento, hashActual, integro: hashActual === documento.hashSha256 });
    })
  );

  /* ── Incidencias ───────────────────────────────────────────────────────── */

  r.get(
    "/incidencias",
    exigirPermiso("recepciones.view"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const incidencias = await repo.listarIncidencias(ctx.empresaId, {
        estado: texto(req.query.estado) || "abiertas",
        centroId: centroDe(req),
        proveedorId: texto(req.query.proveedorId) || undefined,
      });
      res.json({ incidencias });
    })
  );

  r.post(
    "/incidencias/:id/estado",
    exigirPermiso("recepciones.incidencia.manage"),
    ruta(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const incidencia = await servicio.cambiarEstadoIncidencia(contextoDe(req), String(req.params.id), {
        estado: texto(b.estado),
        resolucion: texto(b.resolucion) || null,
      });
      res.json({ incidencia });
    })
  );

  return r;
}
