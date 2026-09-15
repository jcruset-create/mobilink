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
import multer from "multer";
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
import { parsearCorreo } from "./domain/correo/index.ts";
import * as decisionesServicio from "./decisiones.ts";
import * as documentos from "./documentos/servicio.ts";
import * as buzon from "./buzon.ts";
import { CLAVES_BUZON, guardarTextoConfig, leerRemitentes, leerTextoConfig, partirRemitentes } from "./config.ts";
import * as ingesta from "./ingesta.ts";
import { aCorreoEntrante } from "./ingesta.ts";
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

/**
 * Un instante ISO. Se exige que sea una fecha de verdad y no texto libre.
 *
 * La fecha del correo no es un adorno: de ella sale la antigüedad del
 * expediente, y de la antigüedad, la prioridad. Un `"ayer"` que se colara aquí
 * daría un `Invalid Date` que acabaría en la base sin que nadie lo viera hasta
 * que la bandeja ordenara raro.
 */
function instante(v: unknown, campo: string): string {
  const s = texto(v);
  if (!s) throw new ErrorTherefore("FECHA_REQUERIDA", `Falta ${campo}.`);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new ErrorTherefore("FECHA_INVALIDA", `${campo} no es una fecha válida: ${s}.`);
  }
  return d.toISOString();
}

/**
 * Lee el correo que llega por la API.
 *
 * Valida FORMA, no contenido: que la acción sea una de las que hay, que el
 * importe venga en céntimos enteros, que la fecha sea una fecha. Lo que
 * signifique el correo lo decide `ingesta.ts`.
 */
function correoEntranteDe(cuerpo: unknown): ingesta.CorreoEntrante {
  const body = (cuerpo ?? {}) as Record<string, unknown>;
  const tipo = texto(body.tipo) || "INCIDENCIA_ALBARAN";
  if (!esTipoExpediente(tipo)) {
    throw new ErrorTherefore(
      "TIPO_INVALIDO",
      `El tipo debe ser uno de: ${TIPOS_EXPEDIENTE.join(", ")}.`
    );
  }

  const acciones = Array.isArray(body.acciones) ? body.acciones : [];
  const leidas = acciones.map((x, i) => {
    const a = (x ?? {}) as Record<string, unknown>;
    const accion = texto(a.accion).toUpperCase();
    if (!esTipoAccion(accion)) {
      throw new ErrorTherefore(
        "ACCION_INVALIDA",
        `La acción ${i + 1} debe ser una de: ${TIPOS_ACCION.join(", ")}.`
      );
    }
    const confianza = a.confianza === undefined ? undefined : Number(a.confianza);
    return {
      accion,
      accionTexto: texto(a.accionTexto) || null,
      albaran: texto(a.albaran) || null,
      importeCentimos: centimos(a.importeCentimos),
      indicador: texto(a.indicador) || null,
      confianza:
        confianza !== undefined && Number.isFinite(confianza)
          ? Math.min(Math.max(confianza, 0), 1)
          : undefined,
    };
  });

  const adjuntos = (Array.isArray(body.adjuntos) ? body.adjuntos : []).map((x, i) => {
    const a = (x ?? {}) as Record<string, unknown>;
    const hash = texto(a.hash);
    // Sin hash el adjunto no sirve para nada de lo que hace falta: ni cruza
    // documentos entre correos ni evita analizar dos veces el mismo PDF.
    if (!hash) {
      throw new ErrorTherefore("HASH_REQUERIDO", `Al adjunto ${i + 1} le falta el hash.`);
    }
    const tamano = a.tamanoBytes === undefined ? null : Number(a.tamanoBytes);
    return {
      nombre: texto(a.nombre),
      mimeType: texto(a.mimeType),
      tamanoBytes: tamano !== null && Number.isFinite(tamano) ? Math.trunc(tamano) : null,
      hash,
      storagePath: texto(a.storagePath) || null,
    };
  });

  return {
    messageId: texto(body.messageId),
    gmailMessageId: texto(body.gmailMessageId) || null,
    gmailThreadId: texto(body.gmailThreadId) || null,
    inReplyTo: texto(body.inReplyTo) || null,
    fecha: instante(body.fecha, "la fecha del correo"),
    de: texto(body.de),
    para: texto(body.para),
    asunto: texto(body.asunto),
    texto: typeof body.texto === "string" ? body.texto : "",

    tipo,
    empresaCodigo: texto(body.empresaCodigo) || null,
    empresaNombre: texto(body.empresaNombre) || null,
    proveedorCodigo: texto(body.proveedorCodigo) || null,
    proveedorNombre: texto(body.proveedorNombre) || null,
    cuentaContable: texto(body.cuentaContable) || null,
    facturaNumero: texto(body.facturaNumero) || null,
    facturaFecha: fecha(body.facturaFecha),
    importeCentimos: centimos(body.importeCentimos),
    casoReferencia: texto(body.casoReferencia) || null,
    persona: texto(body.persona) || null,

    urgente: booleano(body.urgente) ?? false,
    tareaVencida: booleano(body.tareaVencida) ?? false,
    reclamacion: booleano(body.reclamacion) ?? false,

    acciones: leidas,
    adjuntos,
    albaranesAmbiguos: (Array.isArray(body.albaranesAmbiguos) ? body.albaranesAmbiguos : [])
      .map((x) => texto(x))
      .filter(Boolean),
    parseado: body.parseado ?? null,
  };
}

/**
 * Del resultado del parser a lo que la ingesta sabe tratar.
 *
 * Las dos formas guardan lo mismo, y por eso la ruta de texto y la de campos
 * acaban en el mismo sitio: la deduplicación, la idempotencia y las decisiones
 * no saben —ni tienen por qué— si el correo lo leyó una máquina o lo tecleó
 * una persona.
 */
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


  /* ── Correo ────────────────────────────────────────────────────────────── */

  /**
   * Mete un correo en la cola de trabajo.
   *
   * Recibe CAMPOS, no el .eml: quién lo manda, de qué factura habla, qué
   * albaranes cita y qué hay que hacer con cada uno. El parser que saca eso del
   * cuerpo llegará con los correos reales; hasta entonces esta boca permite que
   * la deduplicación, la idempotencia y los cambios de instrucción estén
   * probados y en uso.
   *
   * Contesta 200 siempre que el correo quede colocado, incluido el caso de que
   * ya estuviera: repetir un correo no es un error del cliente, es la situación
   * normal cuando el buzón se relee.
   */
  r.post(
    "/correos",
    exigirPermiso("therefore.correo.importar"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const resultado = await ingesta.procesarCorreo(ctx, correoEntranteDe(req.body));

      // El duplicado no se audita: no ha cambiado nada, y una auditoría por
      // cada relectura del buzón enterraría las entradas que sí importan.
      if (!resultado.duplicado) {
        await registrarAuditoria({
          empresaId: ctx.empresaId,
          userId: ctx.userId,
          accion: "therefore.correo.importar",
          entidad: "thf_notificaciones",
          entidadId: resultado.notificacionId,
          detalle: {
            resultado: resultado.resultado,
            expediente: resultado.expedienteNumero,
            actuaciones: resultado.actuacionesCreadas,
          },
          ip: req.ip,
        });
      }
      res.json(resultado);
    })
  );

  /**
   * Mete un correo TAL Y COMO LLEGA: asunto y cuerpo, y el parser hace el resto.
   *
   * Es la boca que usará el buzón. La otra —`POST /correos`— sigue existiendo y
   * recibe campos ya interpretados: sirve para reprocesar algo que el parser
   * leyó mal sin tener que arreglar el parser a las tres de la tarde.
   *
   * Lo que el parser entendió se guarda entero junto al correo. Cuando alguien
   * pregunte por qué existe esta actuación, la respuesta está ahí, con la
   * confianza de cada campo y los avisos de lo que quedó dudoso.
   */
  r.post(
    "/correos/texto",
    exigirPermiso("therefore.correo.importar"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const body = (req.body ?? {}) as Record<string, unknown>;

      const asunto = texto(body.asunto);
      const cuerpo = typeof body.texto === "string" ? body.texto : "";
      if (!cuerpo.trim()) {
        throw new ErrorTherefore(
          "TEXTO_REQUERIDO",
          "El correo llega sin cuerpo. El texto original es la única prueba de qué se pidió."
        );
      }

      const leido = parsearCorreo(asunto, cuerpo);
      const entrada = aCorreoEntrante(leido, {
        messageId: texto(body.messageId),
        gmailMessageId: texto(body.gmailMessageId) || null,
        gmailThreadId: texto(body.gmailThreadId) || null,
        inReplyTo: texto(body.inReplyTo) || null,
        fecha: instante(body.fecha, "la fecha del correo"),
        de: texto(body.de),
        para: texto(body.para),
        asunto,
        texto: cuerpo,
      });

      const resultado = await ingesta.procesarCorreo(ctx, entrada);
      if (!resultado.duplicado) {
        await registrarAuditoria({
          empresaId: ctx.empresaId,
          userId: ctx.userId,
          accion: "therefore.correo.importar",
          entidad: "thf_notificaciones",
          entidadId: resultado.notificacionId,
          detalle: {
            resultado: resultado.resultado,
            expediente: resultado.expedienteNumero,
            actuaciones: resultado.actuacionesCreadas,
            confianza: leido.confianza,
          },
          ip: req.ip,
        });
      }
      res.json({ ...resultado, parseado: leido });
    })
  );

  r.get(
    "/expedientes/:id/notificaciones",
    exigirPermiso("therefore.view"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const id = String(req.params.id);
      // Por el expediente y no por la notificación directamente: así la
      // comprobación de empresa la hace la misma consulta que ya la hacía.
      const expediente = await repo.obtenerExpediente(ctx.empresaId, id);
      if (!expediente) {
        throw new ErrorTherefore("NO_ENCONTRADO", "No se encuentra el expediente.", 404);
      }
      const [notificaciones, adjuntos] = await Promise.all([
        repo.listarNotificaciones(ctx.empresaId, id),
        repo.adjuntosDeExpediente(ctx.empresaId, id),
      ]);
      res.json({ notificaciones, adjuntos });
    })
  );

  /* ── Decisiones ────────────────────────────────────────────────────────── */

  r.get(
    "/decisiones",
    exigirPermiso("therefore.view"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const estado = texto(req.query.estado).toUpperCase();
      const decisiones = await repo.listarDecisiones(ctx.empresaId, {
        estado: estado === "DECIDIDA" ? "DECIDIDA" : estado === "" ? undefined : "PENDIENTE",
        expedienteId: texto(req.query.expedienteId) || undefined,
      });
      res.json({ decisiones, respuestas: decisionesServicio.RESPUESTAS });
    })
  );

  r.post(
    "/decisiones/:id",
    exigirPermiso("therefore.decision.resolve"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const resultado = await decisionesServicio.resolver(ctx, String(req.params.id), {
        decision: texto(body.decision).toUpperCase(),
        expedienteId: texto(body.expedienteId) || null,
        motivo: texto(body.motivo) || null,
      });
      await registrarAuditoria({
        empresaId: ctx.empresaId,
        userId: ctx.userId,
        accion: "therefore.decision.resolver",
        entidad: "thf_decisiones",
        entidadId: resultado.decision.id,
        detalle: {
          tipo: resultado.decision.tipo,
          decision: resultado.decision.decision,
          expediente: resultado.expedienteNumero,
        },
        ip: req.ip,
      });
      res.json(resultado);
    })
  );

  /* ── Análisis de documentos ────────────────────────────────────────────── */

  /*
   * El límite de tamaño va aquí y no en el análisis porque hay que rechazar
   * ANTES de leer el fichero entero en memoria: un PDF de 200 MB no puede
   * llegar a `leerDocumento` para que allí se decida que era demasiado grande.
   */
  const subidaDocumento = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  });

  r.post(
    "/expedientes/:id/documentos",
    exigirPermiso("therefore.actuacion.manage"),
    subidaDocumento.single("archivo"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const f = (req as Request & { file?: Express.Multer.File }).file;
      if (!f) {
        return res.status(400).json({ error: "Falta el fichero.", code: "SIN_FICHERO" });
      }
      const salida = await documentos.adjuntarDocumento(ctx, String(req.params.id), {
        nombre: f.originalname,
        mimeType: f.mimetype,
        contenido: f.buffer,
      });
      await registrarAuditoria({
        empresaId: ctx.empresaId,
        userId: ctx.userId,
        accion: "therefore.documento.adjuntar",
        entidad: "thf_adjuntos",
        entidadId: salida.adjuntoId,
        // El hash recortado basta para cruzarlo; el contenido no se registra.
        detalle: { expedienteId: String(req.params.id), hash: salida.hash.slice(0, 12) },
        ip: req.ip,
      });
      res.status(201).json(salida);
    })
  );

  r.get(
    "/expedientes/:id/analisis",
    exigirPermiso("therefore.view"),
    ruta(async (req, res) => {
      res.json(await documentos.analisisDe(contextoDe(req), String(req.params.id)));
    })
  );

  r.post(
    "/actuaciones/:id/reanalizar",
    exigirPermiso("therefore.actuacion.manage"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const fila = await documentos.reanalizar(ctx, String(req.params.id));
      await registrarAuditoria({
        empresaId: ctx.empresaId,
        userId: ctx.userId,
        accion: "therefore.albaran.reanalizar",
        entidad: "thf_albaranes_analizados",
        entidadId: fila.id,
        detalle: { actuacionId: String(req.params.id), albaran: fila.numeroSolicitado },
        ip: req.ip,
      });
      res.status(202).json(fila);
    })
  );

  /*
   * El PDF va por enlace firmado y con caducidad, no por una ruta del servidor.
   * Un albarán lleva los precios de compra y la escala de descuentos de un
   * proveedor: una URL permanente reenviada por ahí las publica para siempre.
   */
  r.get(
    "/albaranes/:id/documento",
    exigirPermiso("therefore.view"),
    ruta(async (req, res) => {
      res.json({ url: await documentos.enlaceDelDocumento(contextoDe(req), String(req.params.id)) });
    })
  );

  /* ── El buzón ──────────────────────────────────────────────────────────── */

  /** Estado del buzón y sus últimas pasadas. Sólo quien puede configurarlo. */
  r.get(
    "/buzon",
    exigirPermiso("therefore.config.edit"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const cfg = buzon.configBuzon();
      res.json({
        // Sin credenciales no hay nada que enseñar salvo que está apagado. Lo
        // que NO se manda nunca es la contraseña ni el servidor: la pantalla
        // dice si está configurado, no cómo.
        configurado: cfg !== null && cfg.empresaId === ctx.empresaId,
        usuario: cfg && cfg.empresaId === ctx.empresaId ? cfg.user : null,
        cadaMinutos: cfg?.minutos ?? null,
        activadoEl: await leerTextoConfig(ctx.empresaId, CLAVES_BUZON.activadoEl),
        remitentes: await leerRemitentes(ctx.empresaId),
        pasadas: await buzon.ultimasPasadas(ctx.empresaId),
      });
    })
  );

  r.put(
    "/buzon/remitentes",
    exigirPermiso("therefore.config.edit"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const lista = partirRemitentes(texto((req.body ?? {}).remitentes));
      await guardarTextoConfig(ctx.empresaId, CLAVES_BUZON.remitentes, lista.join(","));
      await registrarAuditoria({
        empresaId: ctx.empresaId,
        userId: ctx.userId,
        accion: "therefore.buzon.remitentes",
        entidad: "thf_config",
        detalle: { remitentes: lista },
        ip: req.ip,
      });
      res.json({ remitentes: lista });
    })
  );

  /** El botón «Revisar buzón»: una pasada ahora, sin esperar al temporizador. */
  r.post(
    "/buzon/revisar",
    exigirPermiso("therefore.config.edit"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const cfg = buzon.configBuzon();
      if (!cfg || cfg.empresaId !== ctx.empresaId) {
        throw new ErrorTherefore("BUZON_APAGADO", "El buzón no está configurado para esta empresa.", 409);
      }
      const r = await buzon.revisarBuzon({ origen: "manual" });
      await registrarAuditoria({
        empresaId: ctx.empresaId,
        userId: ctx.userId,
        accion: "therefore.buzon.revisar",
        entidad: "thf_buzon_pasadas",
        detalle: "error" in r ? { error: r.error } : { correos: r.correos, procesados: r.procesados, errores: r.errores },
        ip: req.ip,
      });
      if ("error" in r) throw new ErrorTherefore("BUZON_ERROR", r.error, 502);
      res.json(r);
    })
  );

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
      const body = (req.body ?? {}) as {
        pesos?: unknown;
        umbrales?: unknown;
        dedupe?: unknown;
        albaran?: unknown;
      };
      const config = await guardarConfig(ctx.empresaId, {
        pesos: (body.pesos ?? undefined) as never,
        umbrales: (body.umbrales ?? undefined) as never,
        dedupe: (body.dedupe ?? undefined) as never,
        albaran: (body.albaran ?? undefined) as never,
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
