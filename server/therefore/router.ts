/**
 * API del módulo Therefore: `/api/therefore/*`.
 *
 * Todas las rutas pasan por `authenticate` (sesión unificada de Supabase),
 * `requireModule("therefore")` (licencia vigente) y `cargarPermisos`. El mismo
 * encadenado que usan los demás módulos del SaaS.
 *
 * Aquí sólo se valida **forma** —que el tipo sea uno de los que hay, que el
 * importe sea un número—; las reglas viven en `domain/` y los casos de uso en
 * `service.ts`, para que se puedan probar sin levantar Express ni la base.
 *
 * La empresa sale SIEMPRE de `req.authCtx`, nunca del cuerpo ni de la query:
 * un tenant que se puede mandar es un tenant que se puede falsificar.
 */

import { Router, type Request, type Response } from "express";
import { authenticate, requireModule } from "../core/auth.ts";
import { registrarAuditoria } from "../core/auditoria.ts";
import { guardarConfig, leerConfig } from "./config.ts";
import { consultaErpDe } from "./erp/sinErp.ts";
import {
  ESTADOS_EXPEDIENTE,
  PRIORIDADES,
  TIPOS_ACCION,
  TIPOS_EXPEDIENTE,
  esEstadoExpediente,
  esPrioridad,
  esTipoAccion,
  esTipoExpediente,
  type EstadoActuacion,
} from "./domain/estados.ts";
import { ErrorTherefore } from "./errors.ts";
import { cargarPermisos, exigirPermiso } from "./permissions.ts";
import * as repo from "./repository.ts";
import * as servicio from "./service.ts";

/** Envuelve un manejador para que un fallo no se lleve por delante el proceso. */
function ruta(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof ErrorTherefore) {
        return res
          .status(e.estado)
          .json({ error: e.message, code: e.codigo, ...(e.detalle ? { detalle: e.detalle } : {}) });
      }
      console.error("[Therefore] error no controlado:", e);
      res.status(500).json({ error: "Error interno del módulo Therefore" });
    }
  };
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** `aaaa-mm-dd` o `null`. Nada más: un `10/03/2026` se lee distinto según dónde. */
function fecha(v: unknown): string | null {
  const s = texto(v);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new ErrorTherefore("FECHA_INVALIDA", `Fecha no válida: ${s}. Se espera aaaa-mm-dd.`);
  }
  return s;
}

/**
 * Importe en céntimos, **con signo**.
 *
 * Se exige entero: un `45.63` que llegara aquí se guardaría como 45 céntimos, y
 * eso es un abono de cuarenta y cinco céntimos en lugar de cuarenta y cinco
 * euros. Quien convierte de euros a céntimos es el panel, que tiene pruebas.
 */
function centimos(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v));
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new ErrorTherefore(
      "IMPORTE_INVALIDO",
      "El importe tiene que venir en céntimos enteros (con signo)."
    );
  }
  return n;
}

function booleano(v: unknown): boolean | undefined {
  if (v === undefined || v === "") return undefined;
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase();
  if (s === "true" || s === "1") return true;
  if (s === "false" || s === "0") return false;
  return undefined;
}

function contextoDe(req: Request): servicio.Contexto {
  const ctx = req.authCtx!;
  return { empresaId: ctx.empresaId, userId: ctx.userId, userNombre: ctx.nombre };
}

function leerDatosExpediente(body: Record<string, unknown>): repo.DatosExpediente {
  const tipo = texto(body.tipo);
  if (!esTipoExpediente(tipo)) {
    throw new ErrorTherefore(
      "TIPO_INVALIDO",
      `El tipo debe ser uno de: ${TIPOS_EXPEDIENTE.join(", ")}.`
    );
  }
  return {
    tipo,
    empresaCodigo: texto(body.empresaCodigo),
    empresaNombre: texto(body.empresaNombre),
    proveedorCodigo: texto(body.proveedorCodigo) || null,
    proveedorNombre: texto(body.proveedorNombre) || null,
    cuentaContable: texto(body.cuentaContable) || null,
    facturaNumero: texto(body.facturaNumero) || null,
    facturaFecha: fecha(body.facturaFecha),
    importeCentimos: centimos(body.importeCentimos),
    moneda: texto(body.moneda) || "EUR",
    casoReferencia: texto(body.casoReferencia) || null,
    urgente: Boolean(body.urgente),
    tareaVencida: Boolean(body.tareaVencida),
    observaciones: texto(body.observaciones),
  };
}

function leerDatosActuacion(body: Record<string, unknown>): repo.DatosActuacion {
  const tipoAccion = texto(body.tipoAccion).toUpperCase();
  if (!esTipoAccion(tipoAccion)) {
    throw new ErrorTherefore(
      "ACCION_INVALIDA",
      `La acción debe ser una de: ${TIPOS_ACCION.join(", ")}.`
    );
  }
  return {
    tipoAccion,
    albaranSolicitado: texto(body.albaranSolicitado) || null,
    importeCentimos: centimos(body.importeCentimos),
    /*
     * Lo que venía junto al albarán y no se sabe qué es («T2»). Se guarda tal
     * cual: inventarle un significado es peor que no tenerlo, porque nadie
     * vuelve a mirar lo que parece entendido.
     */
    indicadorAdicional: texto(body.indicadorAdicional) || null,
    obligatoria: body.obligatoria === undefined ? true : Boolean(body.obligatoria),
    observaciones: texto(body.observaciones),
  };
}

const ESTADOS_ACTUACION_POR_ACCION: Record<string, EstadoActuacion> = {
  iniciar: "EN_PROCESO",
  resolver: "RESUELTA",
  bloquear: "BLOQUEADA",
  descartar: "DESCARTADA",
  reabrir: "PENDIENTE",
};

export function createThereforeRouter(): Router {
  const r = Router();
  // El cuerpo ya viene parseado: `server/index.ts` monta `express.json` para
  // toda la aplicación antes de llegar aquí. Poner otro en este router sería
  // un no-op que además anunciaría un límite que no se aplica.
  r.use(authenticate, requireModule("therefore"), cargarPermisos);

  /** Lo que la pantalla necesita al abrir: rol, permisos y vocabularios. */
  r.get(
    "/bootstrap",
    exigirPermiso("therefore.view"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      res.json({
        rol: req.thereforeRol ?? null,
        permisos: req.thereforePermisos ?? [],
        contadores: await repo.contarPestanas(ctx.empresaId),
        /*
         * Los vocabularios los manda el servidor para que el panel no tenga una
         * copia que se quede vieja: añadir una acción nueva no puede obligar a
         * desplegar el frontend para poder filtrarla.
         */
        vocabulario: {
          tipos: TIPOS_EXPEDIENTE,
          estados: ESTADOS_EXPEDIENTE,
          prioridades: PRIORIDADES,
          acciones: TIPOS_ACCION,
        },
        // Para que el detalle no ofrezca una consulta que nadie va a contestar.
        erp: { disponible: consultaErpDe().disponible() },
      });
    })
  );

  /* ── Bandeja ───────────────────────────────────────────────────────────── */

  r.get(
    "/expedientes",
    exigirPermiso("therefore.view"),
    ruta(async (req, res) => {
      const q = req.query;
      const filtro: repo.FiltroExpedientes = {
        pestana: (texto(q.pestana) || undefined) as repo.FiltroExpedientes["pestana"],
        estado: texto(q.estado) || undefined,
        prioridad: texto(q.prioridad) || undefined,
        empresaCodigo: texto(q.empresa) || undefined,
        proveedor: texto(q.proveedor) || undefined,
        accion: texto(q.accion) || undefined,
        asignado: texto(q.usuario) || undefined,
        reclamado: booleano(q.reclamado),
        urgente: booleano(q.urgente),
        requiereRevision: booleano(q.revision),
        desde: texto(q.desde) || undefined,
        hasta: texto(q.hasta) || undefined,
        texto: texto(q.texto) || undefined,
        orden: (texto(q.orden) || undefined) as repo.FiltroExpedientes["orden"],
        limite: Number(q.limite) || undefined,
        desplazamiento: Number(q.desplazamiento) || undefined,
      };
      res.json(await servicio.bandeja(contextoDe(req), filtro));
    })
  );

  /* ── Expedientes ───────────────────────────────────────────────────────── */

  r.post(
    "/expedientes",
    exigirPermiso("therefore.expediente.create"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const datos = leerDatosExpediente(req.body ?? {});
      const ficha = await servicio.crearExpediente(ctx, datos);
      await registrarAuditoria({
        empresaId: ctx.empresaId,
        userId: ctx.userId,
        accion: "therefore.expediente.crear",
        entidad: "thf_expedientes",
        entidadId: ficha.expediente.id,
        detalle: { numero: ficha.expediente.numero, tipo: ficha.expediente.tipo },
        ip: req.ip,
      });
      res.status(201).json(ficha);
    })
  );

  r.get(
    "/expedientes/:id",
    exigirPermiso("therefore.view"),
    ruta(async (req, res) => {
      res.json(await servicio.fichaDe(contextoDe(req), String(req.params.id)));
    })
  );

  r.patch(
    "/expedientes/:id",
    exigirPermiso("therefore.expediente.edit"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const cambios: servicio.CambiosFicha = {};

      if ("asignadoUsuarioId" in body) {
        cambios.asignadoUsuarioId = texto(body.asignadoUsuarioId) || null;
      }
      if ("prioridadManual" in body) {
        const p = texto(body.prioridadManual);
        // Vacío = devolver el expediente al cálculo automático, que es distinto
        // de no mandar el campo (eso deja la prioridad manual como estuviera).
        if (!p) {
          cambios.prioridadManual = null;
        } else if (!esPrioridad(p)) {
          throw new ErrorTherefore(
            "PRIORIDAD_INVALIDA",
            `La prioridad debe ser una de: ${PRIORIDADES.join(", ")}.`
          );
        } else {
          cambios.prioridadManual = p;
        }
      }
      if ("observaciones" in body) cambios.observaciones = texto(body.observaciones);

      const ficha = await servicio.editarExpediente(ctx, String(req.params.id), cambios);
      await registrarAuditoria({
        empresaId: ctx.empresaId,
        userId: ctx.userId,
        accion: "therefore.expediente.editar",
        entidad: "thf_expedientes",
        entidadId: ficha.expediente.id,
        detalle: cambios,
        ip: req.ip,
      });
      res.json(ficha);
    })
  );

  r.post(
    "/expedientes/:id/estado",
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const estado = texto(body.estado).toUpperCase();
      if (!esEstadoExpediente(estado)) {
        throw new ErrorTherefore(
          "ESTADO_INVALIDO",
          `El estado debe ser uno de: ${ESTADOS_EXPEDIENTE.join(", ")}.`
        );
      }

      /*
       * Reabrir pide su propio permiso, y por eso la comprobación va aquí
       * dentro y no en un `exigirPermiso` de la ruta: hasta no saber de qué
       * estado viene el expediente no se sabe si esto es reabrir o no.
       */
      const actual = await repo.obtenerExpediente(ctx.empresaId, String(req.params.id));
      if (!actual) {
        throw new ErrorTherefore("EXPEDIENTE_NO_ENCONTRADO", "Expediente no encontrado.", 404);
      }
      const reabre =
        (actual.estado === "RESUELTO" || actual.estado === "CERRADO") && estado === "PENDIENTE";
      const permiso = reabre ? "therefore.expediente.reopen" : "therefore.actuacion.manage";
      if (!req.thereforePermisos?.includes(permiso)) {
        return res.status(403).json({
          error: reabre
            ? "No tienes permiso para reabrir expedientes."
            : "No tienes permiso para cambiar el estado de un expediente.",
          code: "PERMISO_DENEGADO",
          permiso,
        });
      }

      const ficha = await servicio.cambiarEstado(
        ctx,
        String(req.params.id),
        estado,
        texto(body.motivo)
      );
      await registrarAuditoria({
        empresaId: ctx.empresaId,
        userId: ctx.userId,
        accion: reabre ? "therefore.expediente.reabrir" : "therefore.expediente.estado",
        entidad: "thf_expedientes",
        entidadId: ficha.expediente.id,
        detalle: { de: actual.estado, a: estado, motivo: texto(body.motivo) || null },
        ip: req.ip,
      });
      res.json(ficha);
    })
  );

  /* ── Actuaciones ───────────────────────────────────────────────────────── */

  r.post(
    "/expedientes/:id/actuaciones",
    exigirPermiso("therefore.actuacion.manage"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const datos = leerDatosActuacion((req.body ?? {}) as Record<string, unknown>);
      const { ficha, actuacion, nueva } = await servicio.anadirActuacion(
        ctx,
        String(req.params.id),
        datos
      );
      if (nueva) {
        await registrarAuditoria({
          empresaId: ctx.empresaId,
          userId: ctx.userId,
          accion: "therefore.actuacion.anadir",
          entidad: "thf_actuaciones",
          entidadId: actuacion.id,
          detalle: { accion: actuacion.tipoAccion, albaran: actuacion.albaranSolicitado },
          ip: req.ip,
        });
      }
      // 200 y no 201 cuando ya existía: no se ha creado nada.
      res.status(nueva ? 201 : 200).json({ ...ficha, actuacion, nueva });
    })
  );

  /*
   * Una ruta por verbo en vez de un `PATCH` con el estado dentro.
   *
   * Es deliberado: «resolver» y «descartar» son dos cosas muy distintas para
   * quien las hace, y un endpoint que las acepta las dos según un campo del
   * cuerpo es el que acaba descartando trabajo por una errata.
   */
  for (const [verbo, estado] of Object.entries(ESTADOS_ACTUACION_POR_ACCION)) {
    r.post(
      `/actuaciones/:id/${verbo}`,
      exigirPermiso("therefore.actuacion.manage"),
      ruta(async (req, res) => {
        const ctx = contextoDe(req);
        const body = (req.body ?? {}) as Record<string, unknown>;
        const ficha = await servicio.moverActuacion(ctx, String(req.params.id), estado, {
          resultado: "resultado" in body ? texto(body.resultado) || null : undefined,
          erpReferencia: "erpReferencia" in body ? texto(body.erpReferencia) || null : undefined,
          motivo: texto(body.motivo),
        });
        await registrarAuditoria({
          empresaId: ctx.empresaId,
          userId: ctx.userId,
          accion: `therefore.actuacion.${verbo}`,
          entidad: "thf_actuaciones",
          entidadId: String(req.params.id),
          detalle: { estado, motivo: texto(body.motivo) || null },
          ip: req.ip,
        });
        res.json(ficha);
      })
    );
  }

  /* ── Configuración ─────────────────────────────────────────────────────── */

  r.get(
    "/config",
    exigirPermiso("therefore.config.edit"),
    ruta(async (req, res) => {
      res.json(await leerConfig(contextoDe(req).empresaId));
    })
  );

  r.put(
    "/config",
    exigirPermiso("therefore.config.edit"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const body = (req.body ?? {}) as { pesos?: unknown; umbrales?: unknown };
      const config = await guardarConfig(ctx.empresaId, {
        pesos: (body.pesos ?? undefined) as never,
        umbrales: (body.umbrales ?? undefined) as never,
      });
      await registrarAuditoria({
        empresaId: ctx.empresaId,
        userId: ctx.userId,
        accion: "therefore.config.guardar",
        entidad: "thf_config",
        detalle: config,
        ip: req.ip,
      });
      res.json(config);
    })
  );

  return r;
}
