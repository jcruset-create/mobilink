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
import * as buzon from "./buzon.ts";
import * as ingesta from "./ingesta.ts";
import { CLAVES, asumirExpedicionCompleta, avisoWhatsAppActivado, guardarTextoConfig, leerTextoConfig } from "./config.ts";
import { contentSidAviso } from "./avisos.ts";
import { cuerpoPlantilla } from "./domain/aviso.ts";
import { hayCredencialesTwilio } from "../core/twilio.ts";
import { hashDeFichero, leerDocumento } from "./storage.ts";
import { leerDescripcion } from "./domain/articulos.ts";

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
      const [proveedores, centros, contadores, correosEnRevision] = await Promise.all([
        repo.listarProveedores(ctx.empresaId),
        repo.listarCentros(ctx.empresaId),
        repo.contarBandeja(ctx.empresaId, req.recepcionesCentroId ?? null),
        repo.contarCorreosEnRevision(ctx.empresaId),
      ]);
      res.json({
        rol: req.recepcionesRol ?? null,
        permisos: req.recepcionesPermisos ?? [],
        centroId: req.recepcionesCentroId ?? null,
        usuario: { id: ctx.userId, nombre: ctx.userNombre },
        proveedores,
        centros,
        contadores: { ...contadores, correosEnRevision },
        buzonConfigurado: buzon.configBuzon()?.empresaId === ctx.empresaId,
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
      // El mismo nombre que enseña la ficha: el artículo mapeado si lo hay, y
      // si no, la descripción del proveedor puesta en bonito.
      const albaranes = filas.map((a) => ({
        ...a,
        articulos: a.articulos.map((l) => ({ ...l, articuloLeido: l.productoTexto ?? leerDescripcion(l.descripcionProveedor).bonito })),
      }));
      res.json({ albaranes, contadores });
    })
  );

  /* ── Operarios del muelle ──────────────────────────────────────────────── */

  // El desplegable de quién recibe. Sale filtrado por el centro del usuario
  // (o el que pida quien no tiene centro fijo) y nunca lleva el PIN encima.
  r.get(
    "/operarios",
    exigirPermiso("recepciones.view"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const gestiona = (req.recepcionesPermisos ?? []).includes("recepciones.operarios.manage");
      res.json({
        operarios: await repo.listarOperarios(ctx.empresaId, {
          // `centroDe` ya decide: el centro del usuario si lo tiene fijo (y
          // entonces no se puede saltar), y si no, el que pida por query.
          centroId: centroDe(req),
          // Quien los gestiona ve también las bajas, para poder reactivarlas.
          soloActivos: !gestiona || texto(req.query.soloActivos) === "1",
        }),
      });
    })
  );

  r.post(
    "/operarios",
    exigirPermiso("recepciones.operarios.manage"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const b = (req.body ?? {}) as Record<string, unknown>;
      const operario = await servicio.crearOperario(ctx, { nombre: texto(b.nombre), centroId: texto(b.centroId) || null, pin: texto(b.pin) });
      void registrarAuditoria({ empresaId: ctx.empresaId, userId: ctx.userId, accion: "recepciones.operario.crear", entidad: "rcp_operarios", entidadId: operario.id, ip: req.ip });
      res.status(201).json({ operario });
    })
  );

  r.patch(
    "/operarios/:id",
    exigirPermiso("recepciones.operarios.manage"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const b = (req.body ?? {}) as Record<string, unknown>;
      const operario = await servicio.actualizarOperario(ctx, String(req.params.id), {
        nombre: b.nombre === undefined ? undefined : texto(b.nombre),
        centroId: b.centroId === undefined ? undefined : texto(b.centroId) || null,
        activo: typeof b.activo === "boolean" ? b.activo : undefined,
        pin: b.pin === undefined ? undefined : texto(b.pin),
      });
      // Nunca se apunta el PIN en la auditoría, sólo que se cambió.
      void registrarAuditoria({
        empresaId: ctx.empresaId,
        userId: ctx.userId,
        accion: "recepciones.operario.actualizar",
        entidad: "rcp_operarios",
        entidadId: operario.id,
        detalle: { cambiaPin: b.pin !== undefined, activo: operario.activo },
        ip: req.ip,
      });
      res.json({ operario });
    })
  );

  /**
   * Relee los PDF ya guardados para rellenar la observación y el teléfono
   * donde falten. Es para los albaranes que entraron antes de que el módulo
   * supiera leer esa parte del papel: volver a adjuntar el PDF no vale porque
   * el original no se sobrescribe.
   */
  r.post(
    "/albaranes/observaciones/releer",
    exigirPermiso("recepciones.albaran.create"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const b = (req.body ?? {}) as Record<string, unknown>;
      const resultado = await servicio.releerObservaciones(ctx, Number(b.limite) || 200);
      void registrarAuditoria({
        empresaId: ctx.empresaId,
        userId: ctx.userId,
        accion: "recepciones.albaranes.releer_observaciones",
        entidad: "rcp_albaranes",
        detalle: { revisados: resultado.revisados, completados: resultado.completados, errores: resultado.errores },
        ip: req.ip,
      });
      res.json(resultado);
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
      const proveedor = await servicio.actualizarProveedor(ctx, String(req.params.id), {
        codigo: b.codigo === undefined ? undefined : texto(b.codigo),
        nombre: b.nombre === undefined ? undefined : texto(b.nombre),
        nif: b.nif === undefined ? undefined : texto(b.nif) || null,
        remitentesCorreo: Array.isArray(b.remitentesCorreo) ? b.remitentesCorreo.map(String) : undefined,
        activo: typeof b.activo === "boolean" ? b.activo : undefined,
      });
      void registrarAuditoria({ empresaId: ctx.empresaId, userId: ctx.userId, accion: "recepciones.proveedor.actualizar", entidad: "rcp_proveedores", entidadId: proveedor.id, ip: req.ip });
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
      const filas = await repo.listarPedidos(ctx.empresaId, {
        estado: texto(req.query.estado) || undefined,
        centroId: centroDe(req),
        proveedorId: texto(req.query.proveedorId) || undefined,
        texto: texto(req.query.q) || undefined,
      });
      // El mismo nombre bonito que la bandeja y la ficha.
      const pedidos = filas.map((p) => ({
        ...p,
        articulos: p.articulos.map((l) => ({ ...l, articuloLeido: l.productoTexto ?? leerDescripcion(l.descripcionProveedor).bonito })),
      }));
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
        operarioId: texto(b.operarioId) || null,
        pin: texto(b.pin) || null,
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
      const documento = await servicio.adjuntarOriginal(contextoDe(req), String(req.params.id), fichero.buffer, "SUBIDA_MANUAL");
      res.status(201).json({ documento });
    })
  );

  /** Descarga (o reintenta) el PDF original desde el enlace del correo del proveedor. */
  r.post(
    "/albaranes/:id/original/descargar",
    exigirPermiso("recepciones.albaran.create"),
    ruta(async (req, res) => {
      const documento = await servicio.descargarOriginal(contextoDe(req), String(req.params.id), texto((req.body ?? {}).enlace) || null);
      res.status(201).json({ documento });
    })
  );

  /* ── El correo del proveedor ───────────────────────────────────────────── */

  /** Estado del buzón, sus últimas pasadas y cuántos correos esperan revisión. */
  r.get(
    "/correo/buzon",
    exigirPermiso("recepciones.view"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const cfg = buzon.configBuzon();
      const remitentes = await repo.remitentesAdmitidos(ctx.empresaId);
      res.json({
        // Lo que NO se manda nunca es la contraseña ni el servidor: la
        // pantalla dice si está configurado, no cómo.
        configurado: cfg !== null && cfg.empresaId === ctx.empresaId,
        usuario: cfg && cfg.empresaId === ctx.empresaId ? cfg.user : null,
        cadaMinutos: cfg?.minutos ?? null,
        activadoEl: await leerTextoConfig(ctx.empresaId, CLAVES.buzonActivadoEl),
        remitentes: remitentes.map((x) => x.remitente),
        asumirExpedicionCompleta: await asumirExpedicionCompleta(ctx.empresaId),
        enRevision: await repo.contarCorreosEnRevision(ctx.empresaId),
        pasadas: await repo.ultimasPasadas(ctx.empresaId),
      });
    })
  );

  r.put(
    "/correo/config",
    exigirPermiso("recepciones.correo.importar"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const b = (req.body ?? {}) as Record<string, unknown>;
      if (typeof b.asumirExpedicionCompleta === "boolean") {
        await guardarTextoConfig(ctx.empresaId, CLAVES.asumirExpedicionCompleta, b.asumirExpedicionCompleta ? "1" : "0");
      }
      void registrarAuditoria({ empresaId: ctx.empresaId, userId: ctx.userId, accion: "recepciones.correo.config", entidad: "rcp_config", detalle: b, ip: req.ip });
      res.json({ asumirExpedicionCompleta: await asumirExpedicionCompleta(ctx.empresaId) });
    })
  );

  /** El botón «Revisar buzón»: una pasada ahora, sin esperar al temporizador. */
  r.post(
    "/correo/buzon/revisar",
    exigirPermiso("recepciones.correo.importar"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const cfg = buzon.configBuzon();
      if (!cfg || cfg.empresaId !== ctx.empresaId) throw new ErrorRecepciones("BUZON_APAGADO", "El buzón no está configurado para esta empresa.", 409);
      const r = await buzon.revisarBuzon({ origen: "manual" });
      void registrarAuditoria({ empresaId: ctx.empresaId, userId: ctx.userId, accion: "recepciones.buzon.revisar", entidad: "rcp_buzon_pasadas", detalle: r, ip: req.ip });
      if ("error" in r) throw new ErrorRecepciones("BUZON_ERROR", r.error, 502);
      res.json(r);
    })
  );

  /** La carga del histórico: lo anterior a la activación, a propósito y con fecha. */
  r.post(
    "/correo/buzon/historico",
    exigirPermiso("recepciones.correo.importar"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const cfg = buzon.configBuzon();
      if (!cfg || cfg.empresaId !== ctx.empresaId) throw new ErrorRecepciones("BUZON_APAGADO", "El buzón no está configurado para esta empresa.", 409);
      const desde = new Date(texto((req.body ?? {}).desde));
      if (Number.isNaN(desde.getTime())) throw new ErrorRecepciones("FECHA_INVALIDA", "Indica desde qué fecha cargar.");
      const r = await buzon.revisarBuzon({ historico: { desde } });
      void registrarAuditoria({ empresaId: ctx.empresaId, userId: ctx.userId, accion: "recepciones.buzon.historico", entidad: "rcp_buzon_pasadas", detalle: { desde, ...r }, ip: req.ip });
      if ("error" in r) throw new ErrorRecepciones("BUZON_ERROR", r.error, 502);
      res.json(r);
    })
  );

  /** Un correo importado a mano como .eml: la misma puerta que el buzón. */
  r.post(
    "/correo/eml",
    exigirPermiso("recepciones.correo.importar"),
    (req, res, next) =>
      subidaPdf.single("archivo")(req, res, (e) => {
        if (e) return res.status(400).json({ error: "No se ha podido leer el fichero (máx. 15 MB).", code: "FICHERO_INVALIDO" });
        next();
      }),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const f = req.file;
      if (!f?.buffer?.length) throw new ErrorRecepciones("SIN_FICHERO", "Falta el fichero .eml (campo «archivo»).");
      const d = await buzon.importarEml(ctx.empresaId, f.buffer);
      void registrarAuditoria({ empresaId: ctx.empresaId, userId: ctx.userId, accion: "recepciones.correo.importar_eml", entidad: "rcp_correos", detalle: d, ip: req.ip });
      res.status(d.resultado === "error" ? 422 : 200).json(d);
    })
  );

  r.get(
    "/correo",
    exigirPermiso("recepciones.view"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      res.json({ correos: await repo.listarCorreos(ctx.empresaId, { resultado: texto(req.query.resultado) || undefined, tipo: texto(req.query.tipo) || undefined }) });
    })
  );

  r.get(
    "/correo/:id",
    exigirPermiso("recepciones.view"),
    ruta(async (req, res) => {
      const correo = await repo.correoPorId(contextoDe(req).empresaId, String(req.params.id));
      if (!correo) throw new ErrorRecepciones("CORREO_NO_ENCONTRADO", "Correo no encontrado.", 404);
      res.json({ correo });
    })
  );

  /** Vuelve a pasar un correo por la ingesta (tras crear el pedido a mano, por ejemplo). */
  r.post(
    "/correo/:id/reprocesar",
    exigirPermiso("recepciones.correo.importar"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const correoId = String(req.params.id);
      // Si el correo no tiene su adjunto guardado —los que entraron antes de
      // que se guardaran no lo tienen—, se va a buscar el original al buzón.
      // Sin esto, «Reprocesar» vuelve a mirar un cuerpo vacío en los correos
      // que traen los datos en el PDF, y no hay forma de arreglarlos desde
      // aquí. No lanza: si el buzón no está, se reprocesa con lo que haya.
      const correo = await repo.correoPorId(ctx.empresaId, correoId);
      const guardados = correo ? await repo.adjuntosDeCorreo(ctx.empresaId, correoId) : [];
      const delBuzon = correo && guardados.length === 0 ? await buzon.adjuntosDelOriginal(ctx.empresaId, correo.messageId) : [];
      const r = await ingesta.reprocesar({ empresaId: ctx.empresaId }, correoId, delBuzon);
      void registrarAuditoria({ empresaId: ctx.empresaId, userId: ctx.userId, accion: "recepciones.correo.reprocesar", entidad: "rcp_correos", entidadId: r.correoId, detalle: r, ip: req.ip });
      res.json(r);
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

  /* ── Avisos por WhatsApp ───────────────────────────────────────────────── */

  /**
   * El estado del aviso y los últimos que se han intentado. Los omitidos y los
   * fallidos se enseñan igual que los enviados: «a mí no me llegó» se contesta
   * aquí, y la mitad de las veces la respuesta es que el albarán no traía móvil.
   */
  r.get(
    "/avisos",
    exigirPermiso("recepciones.view"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const [activado, empresaNombre, avisos] = await Promise.all([
        avisoWhatsAppActivado(ctx.empresaId),
        repo.nombreEmpresa(ctx.empresaId),
        repo.listarAvisos(ctx.empresaId),
      ]);
      res.json({
        activado,
        // Ni el SID ni las credenciales salen de aquí: sólo si están puestos.
        credenciales: hayCredencialesTwilio(),
        plantilla: contentSidAviso() !== "",
        // El cuerpo que hay que dar de alta en Twilio, para copiarlo de aquí:
        // transcribirlo a mano es la forma de que el mensaje real diga otra cosa.
        cuerpoPlantilla: cuerpoPlantilla(empresaNombre ?? "Recepciones"),
        avisos,
      });
    })
  );

  /** El interruptor. Queda en auditoría: esto empieza a escribir a gente. */
  r.put(
    "/avisos/config",
    exigirPermiso("recepciones.avisos.manage"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const b = (req.body ?? {}) as Record<string, unknown>;
      if (typeof b.activado !== "boolean") throw new ErrorRecepciones("ACTIVADO_INVALIDO", "Indica si el aviso queda encendido o apagado.");
      await guardarTextoConfig(ctx.empresaId, CLAVES.avisoWhatsApp, b.activado ? "1" : "0");
      void registrarAuditoria({ empresaId: ctx.empresaId, userId: ctx.userId, accion: "recepciones.avisos.config", entidad: "rcp_config", detalle: { activado: b.activado }, ip: req.ip });
      res.json({ activado: await avisoWhatsAppActivado(ctx.empresaId) });
    })
  );

  return r;
}
