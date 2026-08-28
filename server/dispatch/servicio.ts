/**
 * Envío de asistencias a otra plataforma, y vuelta.
 *
 * Dos principios que explican casi todo el fichero:
 *
 * 1. **Una solicitud no se pierde nunca.** El despacho se guarda ANTES de
 *    intentar la llamada. Si la red falla, si el destino está caído o si el
 *    proceso se muere a mitad, queda una fila en ERROR con su motivo y se
 *    puede reintentar. Enviar primero y guardar después es cómo se pierden
 *    servicios sin que nadie se entere hasta que llama el cliente.
 *
 * 2. **Dos expedientes, nunca una fila compartida.** Assist conserva el suyo y
 *    Central el suyo; lo único que los ata es el `correlationId` y el mapeo
 *    del despacho. Cada sistema manda en sus estados, sus costes y sus
 *    documentos, que es la razón de ser de la separación.
 */

import crypto from "node:crypto";

import db from "../db.ts";
import { exigirDestinoUtilizable, resolverSecreto } from "./destinosServicio.ts";
import { sanearError } from "./destinos.ts";
import { registrarEvento } from "../eventlog/servicio.ts";
import { tipoDesdeEventoCable } from "../eventlog/tipos.ts";
import {
  esFinal,
  esEvento,
  estadoAssistDesdeEvento,
  estadoEnvioTrasEvento,
  eventoDesdeCentral,
  marcaTemporalDe,
  sePuedeReintentar,
  type Evento,
} from "./estados.ts";
import {
  construirSobre,
  respuestaDeCentral,
  validarParaEnvio,
  type AsistenciaAssist,
} from "./payload.ts";

// Se reexporta para quien ya lo importaba de aquí.
export { validarParaEnvio };

const TIEMPO_MAXIMO_MS = 15_000;

/** Espera entre reintentos: creciente, con techo de una hora. */
const ESPERAS_MS = [30_000, 120_000, 600_000, 1_800_000, 3_600_000];

/**
 * Anotar en el diario no puede tumbar un envío. `registrarEvento` ya traga sus
 * errores; este envoltorio existe para que se lea de un vistazo que aquí NO se
 * espera un resultado y que el flujo sigue pase lo que pase.
 */
async function anotarDiario(a: Parameters<typeof registrarEvento>[0]) {
  await registrarEvento(a).catch(() => false);
}

export class ErrorDespacho extends Error {
  codigo: string;
  estado: number;
  constructor(codigo: string, mensaje: string, estado = 422) {
    super(mensaje);
    this.codigo = codigo;
    this.estado = estado;
  }
}

/* ── Lectura ─────────────────────────────────────────────────────────────── */

/** Destinos que puede usar un taller de Assist. */
export async function listarDestinos(tenantId: string | null) {
  const r = await db.query(
    `SELECT id, uuid, name, kind, "baseUrl", "destinationTenantLabel", "ownerTenantId",
            active, notes, "secretName"
       FROM external_destinations
      WHERE active AND ("ownerTenantId" IS NULL OR "ownerTenantId" = $1)
      ORDER BY name`,
    [tenantId],
  );
  // Se dice SI hay credencial, nunca cuál: el panel necesita avisar de que
  // falta configurarla, y para eso no hace falta enseñarla.
  return Promise.all(
    r.rows.map(async (d: any) => ({
      id: Number(d.id),
      uuid: d.uuid,
      name: d.name,
      kind: d.kind,
      baseUrl: d.baseUrl,
      plataforma: d.destinationTenantLabel ?? null,
      notes: d.notes ?? null,
      credencialConfigurada: Boolean(await resolverSecreto(d.secretName)),
    })),
  );
}

export async function listarDespachosDeAsistencia(assistanceId: number) {
  const r = await db.query(
    `SELECT d.*, dest.name AS "destinoNombre", dest."destinationTenantLabel" AS "destinoPlataforma"
       FROM external_dispatches d
       JOIN external_destinations dest ON dest.id = d."destinationId"
      WHERE d."sourceSystem" = 'assist' AND d."sourceAssistanceId" = $1
      ORDER BY d.id DESC`,
    [String(assistanceId)],
  );
  const ids = r.rows.map((x: any) => x.id);
  const eventos = ids.length
    ? await db.query(
        `SELECT * FROM external_dispatch_events WHERE "dispatchId" = ANY($1::int[]) ORDER BY id`,
        [ids],
      )
    : { rows: [] as any[] };
  return r.rows.map((d: any) => aApi(d, eventos.rows.filter((e: any) => e.dispatchId === d.id)));
}

function aApi(d: any, eventos: any[] = []) {
  return {
    id: Number(d.id),
    uuid: d.uuid,
    destino: { id: Number(d.destinationId), nombre: d.destinoNombre, plataforma: d.destinoPlataforma ?? null },
    correlationId: d.correlationId,
    referenciaOrigen: d.sourceReference ?? null,
    referenciaDestino: d.externalReference ?? null,
    externalAssistanceId: d.externalAssistanceId ?? null,
    status: d.status,
    ultimoEvento: d.lastEvent ?? null,
    sentAtMs: num(d.sentAtMs),
    receivedAtMs: num(d.receivedAtMs),
    acceptedAtMs: num(d.acceptedAtMs),
    rejectedAtMs: num(d.rejectedAtMs),
    completedAtMs: num(d.completedAtMs),
    lastSyncAtMs: num(d.lastSyncAtMs),
    lastError: d.lastError ?? null,
    retryCount: Number(d.retryCount ?? 0),
    sePuedeReintentar: sePuedeReintentar(d.status),
    eventos: eventos.map((e) => ({
      evento: e.event,
      remoteStatus: e.remoteStatus ?? null,
      direccion: e.direction,
      occurredAtMs: num(e.occurredAtMs),
    })),
  };
}

function num(v: unknown): number | null {
  return v == null ? null : Number(v);
}

/* ── Crear y enviar ──────────────────────────────────────────────────────── */

export type PeticionSubcontrata = {
  assistanceId: number;
  destinationId: number;
  tenantId: string | null;
  referenciaCliente?: string | null;
  limiteAutorizado?: number | null;
  incluirObservaciones?: boolean;
};

/**
 * Crea el despacho y lo intenta enviar.
 *
 * Devuelve siempre el despacho, haya salido o no: que la llamada falle no
 * anula la decisión de subcontratar, solo la retrasa. El panel enseña el
 * error y ofrece reintentar.
 */
export async function subcontratarEnCentral(p: PeticionSubcontrata) {
  const a = await cargarAsistencia(p.assistanceId);
  if (!a) throw new ErrorDespacho("not_found", "Asistencia no encontrada", 404);

  /*
   * Puerta única: comprueba dueño, activación y credencial. Un destino sin
   * variable de entorno NO puede enviar aunque se llame a la API a mano — el
   * botón deshabilitado del panel es una comodidad, esto es la garantía.
   */
  const destino = await exigirDestinoUtilizable(p.destinationId, p.tenantId);

  // Validar antes de crear nada: mandar una asistencia sin sitio ni contacto
  // obliga al destino a llamar para preguntar, y eso lo paga el cliente en
  // minutos de espera.
  const fallos = validarParaEnvio(a);
  if (fallos.length) {
    throw new ErrorDespacho("validation_failed", `Faltan datos para subcontratar: ${fallos.join("; ")}`);
  }

  const ya = await db.query(
    `SELECT * FROM external_dispatches
      WHERE "sourceSystem" = 'assist' AND "sourceAssistanceId" = $1 AND "destinationId" = $2`,
    [String(p.assistanceId), p.destinationId],
  );
  if (ya.rows[0] && !sePuedeReintentar(ya.rows[0].status)) {
    throw new ErrorDespacho(
      "already_dispatched",
      `Esta asistencia ya se envió a ${destino.name} (estado ${ya.rows[0].status})`,
      409,
    );
  }

  const now = Date.now();
  // El correlationId se conserva entre reintentos: es lo que hace que el
  // destino reconozca el segundo intento como el mismo servicio.
  const correlationId = ya.rows[0]?.correlationId ?? nuevoCorrelationId(now);

  const empresa = {
    nombre: a.solicitanteEmpresa || a.customerName || "Cliente de Assist",
    cif: null as string | null,
    telefono: a.solicitanteTelefono,
  };
  const sobre = construirSobre(a, {
    correlationId,
    referencia: a.expediente,
    empresaSolicitante: empresa,
    referenciaCliente: p.referenciaCliente ?? null,
    limiteAutorizado: p.limiteAutorizado ?? null,
    incluirObservaciones: p.incluirObservaciones ?? false,
  });

  const ins = await db.query(
    `INSERT INTO external_dispatches
       (uuid, "sourceSystem", "sourceTenantId", "sourceAssistanceId", "sourceReference",
        "destinationId", "destinationSystem", "destinationTenantId", "correlationId",
        status, "payloadSnapshot", "createdAtMs", "updatedAtMs")
     VALUES ($1,'assist',$2,$3,$4,$5,$6,$7,$8,'PENDING',$9,$10,$10)
     ON CONFLICT ("sourceSystem", "sourceTenantId", "sourceAssistanceId", "destinationId")
     DO UPDATE SET "payloadSnapshot" = EXCLUDED."payloadSnapshot",
                   status = 'PENDING', "lastError" = NULL, "updatedAtMs" = EXCLUDED."updatedAtMs"
     RETURNING *`,
    [
      crypto.randomUUID(), p.tenantId, String(p.assistanceId), a.expediente,
      destino.id, destino.kind === "central" ? "central" : "external",
      destino.destinationTenantLabel, correlationId,
      JSON.stringify(sobre), now,
    ],
  );
  let despacho = ins.rows[0];

  await registrarEvento(despacho.id, "REQUESTED", null, "out", now);
  await anotarDiario({
    system: "assist", tenantId: p.tenantId, assistanceId: p.assistanceId,
    correlationId, eventType: "EXTERNAL_DISPATCH_CREATED",
    payload: { destino: destino.name, plataforma: destino.destinationTenantLabel },
    dedupeKey: `disp-creado-${despacho.id}`,
  });
  await db.query(
    `UPDATE roadside_assistances SET "despachoExternoId" = $2 WHERE id = $1`,
    [p.assistanceId, despacho.id],
  );

  despacho = await intentarEnvio(despacho.id);
  return aApi({ ...despacho, destinoNombre: destino.name, destinoPlataforma: destino.destinationTenantLabel });
}

/**
 * Un intento de entrega. No lanza: el resultado se guarda en la fila.
 *
 * Que esto no lance es deliberado — quien subcontrata ya ha tomado la
 * decisión, y convertir un fallo de red en un error de su pantalla le haría
 * pensar que no se ha registrado nada.
 */
export async function intentarEnvio(dispatchId: number) {
  const r = await db.query(
    `SELECT d.*, dest."baseUrl", dest."secretName", dest.name AS "destinoNombre"
       FROM external_dispatches d
       JOIN external_destinations dest ON dest.id = d."destinationId"
      WHERE d.id = $1`,
    [dispatchId],
  );
  const d = r.rows[0];
  if (!d) throw new ErrorDespacho("not_found", "Despacho no encontrado", 404);
  if (!sePuedeReintentar(d.status)) return d;

  const now = Date.now();
  await db.query(
    `UPDATE external_dispatches
        SET status = 'SENDING', "lastAttemptAtMs" = $2, "retryCount" = "retryCount" + 1,
            "updatedAtMs" = $2
      WHERE id = $1`,
    [dispatchId, now],
  );

  const clave = await resolverSecreto(d.secretName);
  if (!clave) {
    return marcarError(
      dispatchId,
      `No hay credencial configurada para «${d.destinoNombre}». Define la variable de entorno del secreto ${d.secretName}.`,
    );
  }

  try {
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), TIEMPO_MAXIMO_MS);
    let res: Response;
    try {
      res = await fetch(`${String(d.baseUrl).replace(/\/+$/, "")}/api/connect/v1/assistances`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${clave}`,
          // La misma clave en cada reintento: es lo que impide el expediente
          // duplicado al otro lado.
          "Idempotency-Key": d.correlationId,
        },
        body: String(d.payloadSnapshot ?? "{}"),
        signal: controlador.signal,
      });
    } finally {
      clearTimeout(temporizador);
    }

    const cuerpo = await res.json().catch(() => null);
    if (!res.ok) {
      const motivo = cuerpo?.error?.message ?? `El destino respondió ${res.status}`;
      return marcarError(dispatchId, motivo, cuerpo);
    }

    const datos = respuestaDeCentral(cuerpo);
    const cuando = Date.now();
    await db.query(
      `UPDATE external_dispatches
          SET status = 'SENT', "sentAtMs" = COALESCE("sentAtMs", $2), "lastSyncAtMs" = $2,
              "externalAssistanceId" = $3, "externalReference" = $4,
              "responseSnapshot" = $5, "lastError" = NULL, "updatedAtMs" = $2
        WHERE id = $1`,
      [dispatchId, cuando, datos.externalAssistanceId, datos.externalReference,
       JSON.stringify(cuerpo).slice(0, 8000)],
    );
    if (datos.externalReference) {
      await db.query(
        `UPDATE roadside_assistances SET "expedienteDestino" = $2 WHERE id = $1`,
        [Number(d.sourceAssistanceId), datos.externalReference],
      );
    }

    await anotarDiario({
      system: "assist", tenantId: d.sourceTenantId, assistanceId: d.sourceAssistanceId,
      correlationId: d.correlationId, eventType: "EXTERNAL_DISPATCH_SENT",
      occurredAtMs: cuando,
      payload: { destino: d.destinoNombre, expedienteDestino: datos.externalReference },
      dedupeKey: `disp-enviado-${dispatchId}`,
    });

    // El destino ya la tiene: eso ES un evento, aunque todavía no haya dicho
    // si la acepta.
    await aplicarEvento(dispatchId, "RECEIVED", datos.status, cuando);

    return (await db.query(`SELECT * FROM external_dispatches WHERE id = $1`, [dispatchId])).rows[0];
  } catch (e: any) {
    const motivo =
      e?.name === "AbortError"
        ? `El destino no respondió en ${TIEMPO_MAXIMO_MS / 1000} s`
        : (e?.message ?? "Error de red");
    return marcarError(dispatchId, motivo);
  }
}

async function marcarError(dispatchId: number, motivo: string, cuerpo?: unknown) {
  const now = Date.now();
  await db.query(
    `UPDATE external_dispatches
        SET status = 'ERROR', "lastError" = $2, "responseSnapshot" = COALESCE($3, "responseSnapshot"),
            "updatedAtMs" = $4
      WHERE id = $1`,
    [dispatchId, sanearError(motivo).slice(0, 1000),
     cuerpo != null ? JSON.stringify(cuerpo).slice(0, 8000) : null, now],
  );
  console.error(`[Dispatch] envío ${dispatchId} falló: ${motivo}`);
  const fila = (await db.query(`SELECT * FROM external_dispatches WHERE id = $1`, [dispatchId])).rows[0];
  await anotarDiario({
    system: "assist", tenantId: fila?.sourceTenantId, assistanceId: fila?.sourceAssistanceId,
    correlationId: fila?.correlationId, eventType: "SYNC_FAILED",
    occurredAtMs: now,
    payload: { motivo: sanearError(motivo), intento: Number(fila?.retryCount ?? 0) },
    // Un intento fallido por intento: sin el número, dos fallos seguidos se
    // deduplicarían en uno y no se vería que lleva días sin salir.
    dedupeKey: `disp-fallo-${dispatchId}-${fila?.retryCount ?? 0}`,
  });
  return fila;
}

/**
 * Reintenta los envíos en ERROR cuya espera ya ha vencido.
 *
 * La espera crece con cada intento: un destino caído no mejora porque se le
 * llame cada diez segundos, y machacarlo retrasa su recuperación.
 */
export async function reintentarPendientes(limite = 10): Promise<number> {
  const now = Date.now();
  const r = await db.query(
    `SELECT id, "retryCount", "lastAttemptAtMs" FROM external_dispatches
      WHERE status IN ('ERROR','PENDING')
      ORDER BY "lastAttemptAtMs" NULLS FIRST
      LIMIT $1`,
    [limite],
  );
  let hechos = 0;
  for (const d of r.rows) {
    const intentos = Number(d.retryCount ?? 0);
    if (intentos >= ESPERAS_MS.length + 3) continue;   // se deja de insistir solo
    const espera = ESPERAS_MS[Math.min(intentos, ESPERAS_MS.length - 1)];
    if (d.lastAttemptAtMs != null && now - Number(d.lastAttemptAtMs) < espera) continue;
    await intentarEnvio(Number(d.id));
    hechos++;
  }
  return hechos;
}

/* ── Vuelta: eventos del destino ─────────────────────────────────────────── */

/**
 * Aplica a Assist lo que cuenta el destino.
 *
 * Solo mueve el estado de la asistencia si la capa de traducción dice que ese
 * evento tiene equivalente. Lo demás se guarda en el historial del envío: el
 * destino tiene estados que a Assist no le dicen nada, y forzarlos aquí
 * pintaría en la pantalla del operario cosas que no puede interpretar.
 */
export async function aplicarEvento(
  dispatchId: number,
  evento: Evento,
  estadoRemoto: string | null,
  cuandoMs = Date.now(),
) {
  const r = await db.query(`SELECT * FROM external_dispatches WHERE id = $1`, [dispatchId]);
  const d = r.rows[0];
  if (!d) return null;

  const nuevoEstado = estadoEnvioTrasEvento(d.status, evento);
  const marca = marcaTemporalDe(evento);

  const sets = [`"lastEvent" = $2`, `"lastSyncAtMs" = $3`, `"updatedAtMs" = $3`];
  const params: unknown[] = [dispatchId, evento, cuandoMs];
  if (nuevoEstado) {
    params.push(nuevoEstado);
    sets.push(`status = $${params.length}`);
  }
  if (marca) sets.push(`"${marca}" = COALESCE("${marca}", $3)`);
  await db.query(`UPDATE external_dispatches SET ${sets.join(", ")} WHERE id = $1`, params);

  await registrarEvento(dispatchId, evento, estadoRemoto, "in", cuandoMs);

  /*
   * Y al diario, traducido al vocabulario interno. La clave de deduplicación
   * lleva el tipo pero NO la hora: un webhook se entrega al menos una vez, y
   * el mismo hecho reenviado no puede pintar dos líneas en la timeline.
   */
  const tipo = tipoDesdeEventoCable(evento);
  if (tipo) {
    await anotarDiario({
      system: "assist", tenantId: d.sourceTenantId, assistanceId: d.sourceAssistanceId,
      correlationId: d.correlationId, eventType: tipo,
      originSystem: d.destinationSystem, occurredAtMs: cuandoMs,
      actorType: "partner",
      payload: { remoteStatus: estadoRemoto },
      dedupeKey: `disp-${dispatchId}-${tipo}`,
    });
  }
  // Si venía de un fallo y ahora sí ha entrado algo, la integración se ha
  // recuperado: hace falta para poder cerrar el aviso en la bandeja.
  if (d.status === "ERROR") {
    await anotarDiario({
      system: "assist", tenantId: d.sourceTenantId, assistanceId: d.sourceAssistanceId,
      correlationId: d.correlationId, eventType: "SYNC_RECOVERED",
      occurredAtMs: cuandoMs, dedupeKey: `disp-recuperado-${dispatchId}-${cuandoMs}`,
    });
  }

  const estadoAssist = estadoAssistDesdeEvento(evento);
  if (estadoAssist && d.sourceSystem === "assist") {
    /*
     * No se pisa una asistencia ya cerrada. Un webhook que llega tarde no
     * puede reabrir algo que en Assist ya se dio por finalizado o cancelado.
     */
    await db.query(
      `UPDATE roadside_assistances
          SET status = $2, "updatedAtMs" = $3
        WHERE id = $1 AND status NOT IN ('finalizada','cancelada')`,
      [Number(d.sourceAssistanceId), estadoAssist, cuandoMs],
    );
  }
  return (await db.query(`SELECT * FROM external_dispatches WHERE id = $1`, [dispatchId])).rows[0];
}

/** Traduce un aviso de Central (`assistance.<status>`) y lo aplica. */
export async function aplicarAvisoDeCentral(
  correlationId: string,
  tipoEvento: string,
  datos: Record<string, unknown>,
): Promise<{ aplicado: boolean; motivo?: string }> {
  const r = await db.query(
    `SELECT id, status FROM external_dispatches WHERE "correlationId" = $1 ORDER BY id DESC LIMIT 1`,
    [correlationId],
  );
  const d = r.rows[0];
  if (!d) return { aplicado: false, motivo: "correlation_id desconocido" };
  if (esFinal(d.status)) return { aplicado: false, motivo: "el envío ya estaba cerrado" };

  const estadoRemoto = String(tipoEvento).startsWith("assistance.")
    ? String(tipoEvento).slice("assistance.".length)
    : String(datos?.status ?? "");
  const evento = eventoDesdeCentral(estadoRemoto);
  if (!evento) return { aplicado: false, motivo: `estado remoto sin equivalente: ${estadoRemoto}` };

  await aplicarEvento(Number(d.id), evento, estadoRemoto);
  return { aplicado: true };
}

async function registrarEvento(
  dispatchId: number,
  evento: string,
  estadoRemoto: string | null,
  direccion: "in" | "out",
  cuandoMs: number,
) {
  if (!esEvento(evento)) return;
  await db.query(
    `INSERT INTO external_dispatch_events
       ("dispatchId", event, "remoteStatus", direction, "occurredAtMs")
     VALUES ($1,$2,$3,$4,$5)`,
    [dispatchId, evento, estadoRemoto, direccion, cuandoMs],
  );
}

/* ── Auxiliares ──────────────────────────────────────────────────────────── */

export function nuevoCorrelationId(atMs = Date.now()): string {
  const d = new Date(atMs);
  const fecha = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `COR-${fecha}-${crypto.randomBytes(4).toString("hex")}`;
}

async function cargarAsistencia(id: number): Promise<(AsistenciaAssist & { expediente: string | null }) | null> {
  const r = await db.query(
    `SELECT id, plate, "vehicleDescription", address, latitude, longitude, "googleMapsUrl",
            "customerName", "customerPhone", "conductorNombre",
            "solicitanteEmpresa", "solicitanteNombre", "solicitanteTelefono", "solicitanteAutorizacion",
            "descripcionAveria", "trabajosARealizar", priority, status, notes, "createdAtMs",
            "expedienteCentral"
       FROM roadside_assistances WHERE id = $1`,
    [id],
  );
  const a = r.rows[0];
  if (!a) return null;
  return {
    ...a,
    id: Number(a.id),
    latitude: a.latitude == null ? null : Number(a.latitude),
    longitude: a.longitude == null ? null : Number(a.longitude),
    // Assist no numera expedientes propios todavía: se manda su id con
    // prefijo, que es estable y sirve para hablar por teléfono.
    expediente: `AST-${a.id}`,
  };
}
