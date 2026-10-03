/**
 * Abrir una puerta (app del cliente, persona autorizada, enlace temporal o
 * administración). Un solo camino para todos:
 *
 *   identidad (sesión o token, NUNCA el cuerpo) → límite de frecuencia
 *   → evaluateAccess → registrar el intento (y consumir un uso si es un
 *   temporal, en la misma transacción) → COMMIT → activar la salida
 *   → completar el resultado en el evento.
 *
 * Con el dispositivo marcado offline se le pregunta antes (latido rápido):
 * ni se abre «a ciegas» ni se deja a nadie fuera por un estado antiguo.
 * Si la salida falla o no contesta, el evento lo dice y la respuesta también:
 * no hay «abierto» sin confirmación del equipo (sin falsos positivos).
 */

import { enTx, pool } from "../../shared/db.ts";
import { auditar } from "../../shared/audit.ts";
import { leerAjuste } from "../../shared/settings.ts";
import { ErrorSelfStorage, noExiste } from "../../errors.ts";
import { evaluateAccess } from "../../domain/accesos.ts";
import { adapterDe, conTiempo, type ResultadoSalida } from "../../integrations/access-devices/index.ts";
import { cargarActor, cargarPuerta, type IdentidadEvento, type Quien } from "./contexto.ts";
import { registrarComunicacion } from "./sincronizacion.ts";
import type { AccessMethod, AccessReason } from "../../../../src/modules/self-storage/types/enums.ts";

export type PeticionApertura = {
  empresaId: string;
  quien: Quien;
  doorId: string;
  method: AccessMethod;
  ip: string | null;
  userAgent: string | null;
  /** Motivo (opcional) de una apertura administrativa. */
  adminReason?: string | null;
};

export type ResultadoApertura = {
  eventId: string;
  opened: boolean;
  decision: "granted" | "denied";
  reason: AccessReason;
  executionStatus: "not_attempted" | "succeeded" | "failed" | "timeout";
  message: string;
};

const TIEMPO_SALIDA_MS = 12_000;
const POR_IP_MINUTO = 30;

/** Columna del evento que identifica al actor, para contar sus intentos. */
function columnaActor(q: Quien): { col: string; val: string } {
  switch (q.tipo) {
    case "customer":
      return { col: "customer_id = $2 AND contract_member_id IS NULL AND temporary_access_id IS NULL", val: q.customerId };
    case "member":
      return { col: "contract_member_id = $2", val: q.memberId };
    case "temporary":
      return { col: "temporary_access_id = $2", val: q.temporaryAccessId };
    case "staff":
      return { col: "staff_user_id = $2", val: q.userId };
  }
}

async function limiteSuperado(empresaId: string, q: Quien, ip: string | null): Promise<boolean> {
  const porMinuto = await leerAjuste(pool, empresaId, null, "access.rate_limit_per_minute");
  const a = columnaActor(q);
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM self_storage_access_events
      WHERE empresa_id = $1 AND ${a.col} AND requested_at > now() - interval '1 minute'`,
    [empresaId, a.val]
  );
  if (rows[0].n >= porMinuto) return true;
  if (ip) {
    const { rows: r2 } = await pool.query(
      `SELECT count(*)::int AS n FROM self_storage_access_events WHERE ip = $1 AND requested_at > now() - interval '1 minute'`,
      [ip]
    );
    if (r2[0].n >= POR_IP_MINUTO) return true;
  }
  return false;
}

const MENSAJE: Partial<Record<AccessReason, string>> = {
  GRANTED: "Puerta abierta.",
  RATE_LIMITED: "Demasiados intentos seguidos. Espera un minuto.",
  DEVICE_OFFLINE: "La puerta no tiene conexión ahora mismo. Llama al centro.",
};

async function insertarEvento(
  c: { query: typeof pool.query },
  p: PeticionApertura,
  puerta: { centerId: string; deviceId: string | null; deviceOutputId: string | null } | null,
  id: IdentidadEvento | null,
  contractId: string | null,
  decision: "granted" | "denied",
  reason: AccessReason
): Promise<string> {
  const { rows } = await c.query(
    `INSERT INTO self_storage_access_events
       (empresa_id, center_id, door_id, device_id, device_output_id, contract_id, customer_id, contract_member_id, temporary_access_id,
        staff_user_id, actor_type, actor_name, method, decision, reason, execution_status, admin_reason, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
    [
      p.empresaId,
      puerta?.centerId ?? null,
      p.doorId,
      puerta?.deviceId ?? null,
      puerta?.deviceOutputId ?? null,
      contractId ?? id?.contractId ?? null,
      id?.customerId ?? null,
      id?.contractMemberId ?? null,
      id?.temporaryAccessId ?? null,
      id?.staffUserId ?? null,
      id?.actorType ?? (p.quien.tipo === "staff" ? "staff" : p.quien.tipo === "temporary" ? "guest" : p.quien.tipo),
      id?.actorName ?? null,
      p.method,
      decision,
      reason,
      decision === "granted" ? "pending" : "not_attempted",
      p.adminReason ?? null,
      p.ip,
      p.userAgent?.slice(0, 300) ?? null,
    ]
  );
  return rows[0].id;
}

export async function abrirPuerta(p: PeticionApertura): Promise<ResultadoApertura> {
  // 0. La puerta tiene que ser de la empresa (si no, «no existe»).
  let puerta = await cargarPuerta(pool, p.empresaId, p.doorId);

  // 1. Límite de frecuencia (por persona y por IP), registrado también.
  if (await limiteSuperado(p.empresaId, p.quien, p.ip)) {
    const ident = await cargarActor(pool, p.empresaId, p.quien, puerta).catch(() => null);
    const eventId = await insertarEvento(pool, p, puerta, ident?.identidad ?? null, null, "denied", "RATE_LIMITED");
    throw new ErrorSelfStorage("RATE_LIMITED", MENSAJE.RATE_LIMITED!, 429, { eventId });
  }

  // 2. Dispositivo marcado offline: se le pregunta ahora antes de decidir.
  if (puerta.dispositivo && puerta.salida?.dispositivo.status === "offline") {
    const d = puerta.dispositivo;
    const e = await conTiempo(adapterDe(d).getStatus(d), 4_000).catch(() => ({ online: false, latencyMs: 0 }));
    if (e.online) {
      await registrarComunicacion(d.id, true, null);
      puerta = await cargarPuerta(pool, p.empresaId, p.doorId);
    }
  }

  // 3. Decidir y registrar el intento (y consumir el uso del temporal) en una transacción.
  const decidido = await enTx(async (c) => {
    const cargado = await cargarActor(c, p.empresaId, p.quien, puerta, p.quien.tipo === "temporary");
    if (!cargado) throw noExiste("La persona");
    const ev = evaluateAccess(puerta, cargado.actor, new Date(), p.method);
    const eventId = await insertarEvento(c, p, puerta, cargado.identidad, ev.contractId, ev.granted ? "granted" : "denied", ev.reason);
    if (ev.granted && p.quien.tipo === "temporary") {
      await c.query(`UPDATE self_storage_temporary_accesses SET uses_count = uses_count + 1 WHERE id = $1`, [p.quien.temporaryAccessId]);
    }
    if (p.method === "admin") {
      await auditar(c, { empresaId: p.empresaId, userId: cargado.identidad.staffUserId ?? "", nombre: cargado.identidad.actorName, ip: p.ip, tipo: "staff" }, {
        action: "door.opened_by_admin",
        entityType: "door",
        entityId: p.doorId,
        after: { eventId, reason: p.adminReason ?? null, decision: ev.granted ? "granted" : "denied", motivo: ev.reason },
      });
    }
    return { ev, eventId };
  });

  if (!decidido.ev.granted) {
    return { eventId: decidido.eventId, opened: false, decision: "denied", reason: decidido.ev.reason, executionStatus: "not_attempted", message: MENSAJE[decidido.ev.reason] ?? "Acceso denegado." };
  }

  // 4. Hablar con el dispositivo FUERA de la transacción.
  const d = puerta.dispositivo!;
  let r: ResultadoSalida;
  try {
    r = await conTiempo(adapterDe(d).activateOutput(d, { outputNumber: puerta.outputNumber!, pulseDurationMs: puerta.pulseDurationMs!, outputType: puerta.outputType! }), TIEMPO_SALIDA_MS);
  } catch (e) {
    r = { ok: false, latencyMs: TIEMPO_SALIDA_MS, code: "TIMEOUT", message: e instanceof Error ? e.message : "Sin respuesta" };
  }
  const estado = r.ok ? "succeeded" : r.code === "TIMEOUT" ? "timeout" : "failed";
  // Respuesta saneada: código y tiempos, nunca tokens ni credenciales.
  const respuesta = { ok: r.ok, code: r.code ?? null, httpStatus: r.httpStatus ?? null, message: r.message?.slice(0, 200) ?? null };
  await pool.query(
    `UPDATE self_storage_access_events SET execution_status = $2, executed_at = now(), latency_ms = $3, device_response = $4 WHERE id = $1`,
    [decidido.eventId, estado, Math.round(r.latencyMs), JSON.stringify(respuesta)]
  );
  if (r.ok) await registrarComunicacion(d.id, true, null);
  else if (r.code === "OFFLINE" || r.code === "TIMEOUT") await registrarComunicacion(d.id, false, `${r.code}: ${r.message ?? ""}`);
  else await pool.query(`UPDATE self_storage_devices SET last_error = $2, last_error_at = now() WHERE id = $1`, [d.id, `${r.code}: ${r.message ?? ""}`.slice(0, 500)]);
  // Un temporal no pierde su uso si la puerta no llegó a abrirse.
  if (!r.ok && p.quien.tipo === "temporary") {
    await pool.query(`UPDATE self_storage_temporary_accesses SET uses_count = greatest(uses_count - 1, 0) WHERE id = $1`, [p.quien.temporaryAccessId]);
  }
  return {
    eventId: decidido.eventId,
    opened: r.ok,
    decision: "granted",
    reason: "GRANTED",
    executionStatus: estado,
    message: r.ok ? MENSAJE.GRANTED! : estado === "timeout" || r.code === "OFFLINE" ? MENSAJE.DEVICE_OFFLINE! : "La puerta no ha respondido a la orden de apertura. Llama al centro.",
  };
}
