/**
 * Call Center · ciclo de vida de la llamada.
 *
 *   alta (iniciada / en curso) → resultado → cerrada | seguimiento | escalada
 *
 * Cada paso deja su evento en `self_storage_call_events` (la cronología que ve
 * el operador y la pantalla de Logs) y su rastro en la auditoría, en la MISMA
 * transacción. Da igual quién atienda: persona, IA o las dos (`handled_by`);
 * aquí no hay nada de proveedores de IA ni de telefonía.
 */

import type { z } from "zod";
import type { PoolClient } from "pg";
import { enTx, pool, type Ejecutor } from "../../shared/db.ts";
import { auditar, type Actor } from "../../shared/audit.ts";
import { leerAjuste } from "../../shared/settings.ts";
import { ErrorSelfStorage, noExiste } from "../../errors.ts";
import {
  duracionSegundos,
  efectoDeResultado,
  estadoTrasResultado,
  interruptorGlobal,
  prioridadMaxima,
  puedePasar,
} from "../../domain/callcenter.ts";
import { asegurarCatalogo, entradaActiva } from "./catalogo.ts";
import { clientesPorTelefono, telefonoONulo } from "./identificacion.ts";
import type { filtroLlamadas, llamadaAlta, llamadaCambio, llamadaEscalado, llamadaResultado, llamadaSeguimiento } from "../../schemas.ts";
import type { CallStatus, Priority } from "../../../../src/modules/self-storage/types/enums.ts";

// ── ¿Está activo? ───────────────────────────────────────────────────────────

export type EstadoCallCenter = { global: boolean; empresa: boolean; enabled: boolean };

/** Interruptor global (entorno) Y activación de la empresa (ajuste). */
export async function estadoCallCenter(empresaId: string): Promise<EstadoCallCenter> {
  const global = interruptorGlobal(process.env.SELF_STORAGE_CALL_CENTER_ENABLED);
  const empresa = await leerAjuste(pool, empresaId, null, "call_center.enabled");
  return { global, empresa, enabled: global && empresa };
}

export async function exigirActivo(empresaId: string): Promise<void> {
  const e = await estadoCallCenter(empresaId);
  if (!e.global) throw new ErrorSelfStorage("CALL_CENTER_APAGADO", "El Call Center está desactivado en este servidor.", 503);
  if (!e.empresa) throw new ErrorSelfStorage("CALL_CENTER_DESACTIVADO", "El Call Center no está activado para esta empresa (Configuración del Call Center).", 409);
}

// ── Lectura ─────────────────────────────────────────────────────────────────

const SELECT_LLAMADA = `
  SELECT l.id, l.center_id AS "centerId", ce.name AS "centerName", l.customer_id AS "customerId",
         CASE WHEN cu.customer_type = 'company' THEN cu.company_name ELSE btrim(coalesce(cu.first_name,'') || ' ' || coalesce(cu.last_name,'')) END AS "customerName",
         l.contract_id AS "contractId", k.contract_number AS "contractNumber", l.lead_id AS "leadId",
         l.phone_e164 AS phone, l.phone_raw AS "phoneRaw", l.caller_name AS "callerName", l.direction, l.channel,
         l.handled_by AS "handledBy", l.operator_user_id AS "operatorUserId", op.nombre AS "operatorName",
         l.telephony_provider AS "telephonyProvider", l.external_call_id AS "externalCallId", l.language,
         l.started_at AS "startedAt", l.answered_at AS "answeredAt", l.ended_at AS "endedAt", l.duration_seconds AS "durationSeconds",
         l.reason_code AS "reasonCode", rz.label AS "reasonLabel", l.result_code AS "resultCode", rs.label AS "resultLabel",
         l.status, l.priority, l.requires_human AS "requiresHuman", l.summary, l.notes,
         l.escalated_at AS "escalatedAt", l.escalation_reason AS "escalationReason",
         l.follow_up_at AS "followUpAt", l.follow_up_done_at AS "followUpDoneAt", l.created_at AS "createdAt", l.updated_at AS "updatedAt"
    FROM self_storage_calls l
    LEFT JOIN self_storage_centers ce ON ce.id = l.center_id
    LEFT JOIN self_storage_customers cu ON cu.id = l.customer_id
    LEFT JOIN self_storage_contracts k ON k.id = l.contract_id
    LEFT JOIN app_usuarios op ON op.id = l.operator_user_id
    LEFT JOIN self_storage_call_catalog rz ON rz.empresa_id = l.empresa_id AND rz.kind = 'reason' AND rz.code = l.reason_code
    LEFT JOIN self_storage_call_catalog rs ON rs.empresa_id = l.empresa_id AND rs.kind = 'result' AND rs.code = l.result_code`;

export async function obtenerLlamada(empresaId: string, id: string) {
  const { rows } = await pool.query(`${SELECT_LLAMADA} WHERE l.empresa_id = $1 AND l.id = $2`, [empresaId, id]);
  if (!rows.length) throw noExiste("La llamada");
  const [{ rows: eventos }, { rows: incidencias }, { rows: t }] = await Promise.all([
    pool.query(
      `SELECT id, occurred_at AS "occurredAt", actor_type AS "actorType", actor_name AS "actorName", event_type AS "eventType", data
         FROM self_storage_call_events WHERE empresa_id = $1 AND call_id = $2 ORDER BY occurred_at, id`,
      [empresaId, id]
    ),
    pool.query(
      `SELECT id, incident_type AS "incidentType", priority, status, title, created_at AS "createdAt"
         FROM self_storage_incidents WHERE empresa_id = $1 AND call_id = $2 ORDER BY created_at`,
      [empresaId, id]
    ),
    pool.query(`SELECT transcript FROM self_storage_calls WHERE id = $1`, [id]),
  ]);
  return { ...rows[0], transcript: t[0]?.transcript ?? null, events: eventos, incidents: incidencias };
}

function filtrosSql(empresaId: string, f: Partial<z.infer<typeof filtroLlamadas>>) {
  const vals: unknown[] = [empresaId];
  const cond = ["l.empresa_id = $1"];
  const add = (sql: string, v: unknown) => {
    vals.push(v);
    cond.push(sql.replace("?", `$${vals.length}`));
  };
  if (f.from) add("l.started_at >= ?::date", f.from);
  if (f.to) add("l.started_at < (?::date + 1)", f.to);
  if (f.centerId) add("l.center_id = ?", f.centerId);
  if (f.customerId) add("l.customer_id = ?", f.customerId);
  if (f.phone) {
    const e = telefonoONulo(f.phone);
    if (e) add("l.phone_e164 = ?", e);
    else add("l.phone_raw ILIKE '%' || ? || '%'", f.phone.replace(/[%_]/g, ""));
  }
  if (f.language) add("l.language = ?", f.language);
  if (f.reasonCode) add("l.reason_code = ?", f.reasonCode);
  if (f.resultCode) add("l.result_code = ?", f.resultCode);
  if (f.status) add("l.status = ?", f.status);
  if (f.priority) add("l.priority = ?", f.priority);
  if (f.handledBy) add("l.handled_by = ?", f.handledBy);
  if (f.direction) add("l.direction = ?", f.direction);
  if (f.operatorUserId) add("l.operator_user_id = ?", f.operatorUserId);
  if (f.telephonyProvider) add("l.telephony_provider = ?", f.telephonyProvider);
  if (f.pendingFollowUp) cond.push("l.follow_up_at IS NOT NULL AND l.follow_up_done_at IS NULL");
  if (f.interested) cond.push("l.customer_id IS NULL");
  return { where: cond.join(" AND "), vals };
}

export async function listarLlamadas(empresaId: string, f: z.infer<typeof filtroLlamadas>) {
  const { where, vals } = filtrosSql(empresaId, f);
  const [{ rows }, { rows: total }] = await Promise.all([
    pool.query(`${SELECT_LLAMADA} WHERE ${where} ORDER BY l.started_at DESC LIMIT ${f.limit} OFFSET ${f.offset}`, vals),
    pool.query(`SELECT count(*)::int AS n FROM self_storage_calls l WHERE ${where}`, vals),
  ]);
  return { total: total[0].n as number, items: rows };
}

/** CSV (separado por «;», como lo abre Excel en España) con los mismos filtros que la lista. */
export async function exportarLlamadasCsv(empresaId: string, f: z.infer<typeof filtroLlamadas>): Promise<string> {
  const { where, vals } = filtrosSql(empresaId, f);
  const { rows } = await pool.query(`${SELECT_LLAMADA} WHERE ${where} ORDER BY l.started_at DESC LIMIT 10000`, vals);
  const cols: [string, string][] = [
    ["startedAt", "Inicio"],
    ["endedAt", "Fin"],
    ["durationSeconds", "Duración (s)"],
    ["direction", "Sentido"],
    ["handledBy", "Atendida por"],
    ["operatorName", "Operador"],
    ["phone", "Teléfono"],
    ["callerName", "Nombre"],
    ["customerName", "Cliente"],
    ["centerName", "Centro"],
    ["language", "Idioma"],
    ["reasonLabel", "Motivo"],
    ["resultLabel", "Resultado"],
    ["status", "Estado"],
    ["priority", "Prioridad"],
    ["summary", "Resumen"],
  ];
  const celda = (v: unknown) => {
    const s = v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
    // Ni saltos de línea ni fórmulas inyectadas al abrirlo en una hoja de cálculo.
    const limpio = s.replace(/\r?\n/g, " ").replace(/^[=+\-@\t]/, "'$&");
    return /[;"]/.test(limpio) ? `"${limpio.replace(/"/g, '""')}"` : limpio;
  };
  return ["﻿" + cols.map((c) => c[1]).join(";"), ...rows.map((r) => cols.map(([k]) => celda(r[k])).join(";"))].join("\r\n");
}

/** Logs: la cronología de todas las llamadas, la más reciente primero. */
export async function eventos(empresaId: string, f: { callId?: string; eventType?: string; limit: number }) {
  const vals: unknown[] = [empresaId];
  const cond = ["e.empresa_id = $1"];
  if (f.callId) {
    vals.push(f.callId);
    cond.push(`e.call_id = $${vals.length}`);
  }
  if (f.eventType) {
    vals.push(f.eventType);
    cond.push(`e.event_type = $${vals.length}`);
  }
  const { rows } = await pool.query(
    `SELECT e.id, e.call_id AS "callId", e.occurred_at AS "occurredAt", e.actor_type AS "actorType", e.actor_name AS "actorName",
            e.event_type AS "eventType", e.data, l.phone_e164 AS phone, l.center_id AS "centerId", l.customer_id AS "customerId"
       FROM self_storage_call_events e JOIN self_storage_calls l ON l.id = e.call_id
      WHERE ${cond.join(" AND ")} ORDER BY e.occurred_at DESC LIMIT ${f.limit}`,
    vals
  );
  return rows;
}

// ── Escritura ───────────────────────────────────────────────────────────────

type FilaLlamada = {
  id: string;
  status: CallStatus;
  priority: Priority;
  customer_id: string | null;
  center_id: string | null;
  started_at: Date;
  answered_at: Date | null;
  ended_at: Date | null;
  escalated_at: Date | null;
  follow_up_at: Date | null;
  follow_up_done_at: Date | null;
};

export async function evento(c: Ejecutor, actor: Actor, callId: string, tipo: string, data: Record<string, unknown> = {}): Promise<void> {
  await c.query(
    `INSERT INTO self_storage_call_events (empresa_id, call_id, actor_type, actor_id, actor_name, event_type, data) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [actor.empresaId, callId, actor.esIA ? "ai" : actor.tipo === "system" ? "system" : "staff", actor.userId || null, actor.nombre || null, tipo, JSON.stringify(data)]
  );
}

async function bloquear(c: PoolClient, empresaId: string, id: string): Promise<FilaLlamada> {
  const { rows } = await c.query(`SELECT * FROM self_storage_calls WHERE empresa_id = $1 AND id = $2 FOR UPDATE`, [empresaId, id]);
  if (!rows.length) throw noExiste("La llamada");
  return rows[0];
}

function pasar(l: FilaLlamada, a: CallStatus) {
  if (!puedePasar(l.status, a)) throw new ErrorSelfStorage("LLAMADA_CERRADA", l.status === "closed" ? "La llamada está cerrada. Si vuelve a llamar, registra una llamada nueva." : "Ese cambio de estado no es posible.", 409);
}

/** Centro por defecto: el pedido, el del ajuste (si es de la empresa) o el único activo. */
async function centroPorDefecto(c: Ejecutor, empresaId: string, pedido: string | null | undefined): Promise<string | null> {
  if (pedido) return pedido;
  const ajuste = await leerAjuste(c, empresaId, null, "call_center.default_center_id");
  const { rows } = await c.query(`SELECT id FROM self_storage_centers WHERE empresa_id = $1 AND status = 'active' ORDER BY (id = $2) DESC, name LIMIT 2`, [empresaId, ajuste]);
  if (ajuste && rows[0]?.id === ajuste) return ajuste;
  return rows.length === 1 ? rows[0].id : null;
}

/** `origen`: llamada que llega por un proveedor de telefonía (idempotente por su id). */
export async function crearLlamada(actor: Actor, d: z.infer<typeof llamadaAlta>, origen?: { telephonyProvider: string; externalCallId: string }) {
  await asegurarCatalogo(actor.empresaId);
  const id = await enTx(async (c) => {
    const phone = telefonoONulo(d.phone);
    let prioridad: Priority = d.priority ?? "normal";
    if (d.reasonCode) prioridad = prioridadMaxima(prioridad, (await entradaActiva(c, actor.empresaId, "reason", d.reasonCode)).defaultPriority);
    // Un único cliente con ese número: se vincula. Varios: lo elige el operador. Ninguno: interesado.
    const coinciden = phone ? await clientesPorTelefono(actor.empresaId, phone) : [];
    const customerId = coinciden.length === 1 ? coinciden[0].customerId : null;
    const centerId = await centroPorDefecto(c, actor.empresaId, d.centerId);
    const { rows } = await c.query(
      `INSERT INTO self_storage_calls (empresa_id, center_id, customer_id, phone_e164, phone_raw, caller_name, direction, handled_by,
                                       operator_user_id, language, reason_code, priority, notes, status, answered_at, created_by,
                                       telephony_provider, external_call_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
      [
        actor.empresaId,
        centerId,
        customerId,
        phone,
        d.phone?.trim() || null,
        d.callerName ?? null,
        d.direction,
        d.handledBy,
        d.handledBy === "ai" ? null : actor.userId || null,
        d.language ?? null,
        d.reasonCode ?? null,
        prioridad,
        d.notes ?? null,
        d.answered ? "in_progress" : "started",
        d.answered ? new Date() : null,
        actor.userId || null,
        origen?.telephonyProvider ?? null,
        origen?.externalCallId ?? null,
      ]
    );
    const id = rows[0].id as string;
    await evento(c, actor, id, "created", { direction: d.direction, handledBy: d.handledBy, customerLinked: Boolean(customerId), matches: coinciden.length });
    if (d.answered) await evento(c, actor, id, "answered");
    await auditar(c, actor, { action: "call.created", entityType: "call", entityId: id, after: { centerId, customerId, direction: d.direction, handledBy: d.handledBy, reasonCode: d.reasonCode ?? null } });
    return id;
  });
  return obtenerLlamada(actor.empresaId, id);
}

export async function contestar(actor: Actor, id: string) {
  await enTx(async (c) => {
    const l = await bloquear(c, actor.empresaId, id);
    if (l.answered_at) return;
    pasar(l, "in_progress");
    await c.query(`UPDATE self_storage_calls SET answered_at = now(), status = 'in_progress', operator_user_id = coalesce(operator_user_id, $2) WHERE id = $1`, [id, actor.userId || null]);
    await evento(c, actor, id, "answered");
  });
  return obtenerLlamada(actor.empresaId, id);
}

export async function actualizarLlamada(actor: Actor, id: string, d: z.infer<typeof llamadaCambio>) {
  await enTx(async (c) => {
    const l = await bloquear(c, actor.empresaId, id);
    if (l.status === "closed") pasar(l, "in_progress");
    const sets: string[] = [];
    const vals: unknown[] = [id];
    const cambios: Record<string, unknown> = {};
    const set = (col: string, v: unknown, clave: string, registrar = true) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
      if (registrar) cambios[clave] = v;
    };
    if (d.callerName !== undefined) set("caller_name", d.callerName, "callerName");
    if (d.centerId !== undefined) set("center_id", d.centerId, "centerId");
    if (d.language !== undefined) set("language", d.language, "language");
    if (d.summary !== undefined) set("summary", d.summary, "summary", false);
    if (d.notes !== undefined) set("notes", d.notes, "notes", false);
    let prioridad = d.priority ?? l.priority;
    if (d.reasonCode !== undefined) {
      if (d.reasonCode) prioridad = prioridadMaxima(prioridad, (await entradaActiva(c, actor.empresaId, "reason", d.reasonCode)).defaultPriority);
      set("reason_code", d.reasonCode, "reasonCode");
    }
    if (prioridad !== l.priority) set("priority", prioridad, "priority");
    // Cliente y contrato: el contrato tiene que ser de ese cliente (y los dos de la empresa: FK compuesta).
    const cliente = d.customerId !== undefined ? d.customerId : l.customer_id;
    if (d.customerId !== undefined) set("customer_id", d.customerId, "customerId");
    if (d.contractId !== undefined || d.customerId !== undefined) {
      const contrato = d.contractId !== undefined ? d.contractId : null;
      if (contrato) {
        const { rows } = await c.query(`SELECT 1 FROM self_storage_contracts WHERE empresa_id = $1 AND id = $2 AND customer_id = $3`, [actor.empresaId, contrato, cliente]);
        if (!rows.length) throw new ErrorSelfStorage("CONTRATO_DE_OTRO_CLIENTE", "El contrato no es de ese cliente.", 422);
      }
      set("contract_id", contrato, "contractId");
    }
    if (d.transcript !== undefined) {
      // Transcripción: sólo si la empresa lo tiene activado (por defecto, no).
      if (d.transcript && !(await leerAjuste(c, actor.empresaId, null, "call_center.store_transcripts"))) {
        throw new ErrorSelfStorage("TRANSCRIPCION_DESACTIVADA", "Guardar transcripciones está desactivado para esta empresa.", 409);
      }
      set("transcript", d.transcript, "transcript", false);
    }
    if (!sets.length) return;
    await c.query(`UPDATE self_storage_calls SET ${sets.join(", ")} WHERE id = $1`, vals);
    const textos = [d.summary !== undefined && "summary", d.notes !== undefined && "notes", d.transcript !== undefined && "transcript"].filter(Boolean);
    await evento(c, actor, id, d.customerId !== undefined && d.customerId ? "customer_linked" : "updated", { ...cambios, ...(textos.length ? { texts: textos } : {}) });
    // La auditoría guarda QUÉ cambió, no el contenido de la conversación.
    await auditar(c, actor, { action: "call.updated", entityType: "call", entityId: id, after: { ...cambios, ...(textos.length ? { texts: textos } : {}) } });
  });
  return obtenerLlamada(actor.empresaId, id);
}

/** Termina la conversación (si no lo estaba): fin y duración. */
async function terminar(c: Ejecutor, l: FilaLlamada) {
  if (l.ended_at) return;
  const fin = new Date();
  await c.query(`UPDATE self_storage_calls SET ended_at = $2, duration_seconds = $3 WHERE id = $1`, [l.id, fin, duracionSegundos(l.started_at, l.answered_at, fin)]);
}

const MANANA = () => new Date(Date.now() + 24 * 3600_000);

export async function registrarResultado(actor: Actor, id: string, d: z.infer<typeof llamadaResultado>) {
  await enTx(async (c) => {
    const l = await bloquear(c, actor.empresaId, id);
    const r = await entradaActiva(c, actor.empresaId, "result", d.resultCode);
    const estado = estadoTrasResultado(r.code);
    pasar(l, estado);
    await terminar(c, l);
    const efecto = efectoDeResultado(r.code);
    const seguimiento = efecto === "follow_up" ? (d.followUpAt ? new Date(d.followUpAt) : (l.follow_up_at ?? MANANA())) : l.follow_up_at;
    await c.query(
      `UPDATE self_storage_calls
          SET result_code = $2, status = $3, summary = coalesce($4, summary), notes = coalesce($5, notes),
              follow_up_at = $6,
              escalated_at = CASE WHEN $7 THEN coalesce(escalated_at, now()) ELSE escalated_at END,
              escalation_reason = CASE WHEN $7 THEN coalesce(escalation_reason, $8) ELSE escalation_reason END,
              requires_human = requires_human OR $7
        WHERE id = $1`,
      [id, r.code, estado, d.summary ?? null, d.notes ?? null, seguimiento, efecto === "escalate", r.label]
    );
    await evento(c, actor, id, "result_set", { resultCode: r.code, status: estado, ...(efecto === "follow_up" ? { followUpAt: seguimiento } : {}) });
    await auditar(c, actor, { action: "call.result_set", entityType: "call", entityId: id, before: { status: l.status }, after: { resultCode: r.code, status: estado } });
  });
  return obtenerLlamada(actor.empresaId, id);
}

/** Escalar a la empresa: pide un humano, guarda el motivo y el resumen para quien la recoja. */
export async function escalar(actor: Actor, id: string, d: z.infer<typeof llamadaEscalado>) {
  await enTx(async (c) => {
    const l = await bloquear(c, actor.empresaId, id);
    pasar(l, "escalated");
    const prioridad = prioridadMaxima(l.priority, d.priority ?? "high");
    await c.query(
      `UPDATE self_storage_calls
          SET status = 'escalated', requires_human = true, escalated_at = now(), escalation_reason = $2,
              summary = coalesce($3, summary), priority = $4
        WHERE id = $1`,
      [id, d.reason, d.summary ?? null, prioridad]
    );
    await evento(c, actor, id, "escalated", { reason: d.reason, priority: prioridad });
    await auditar(c, actor, { action: "call.escalated", entityType: "call", entityId: id, before: { status: l.status }, after: { status: "escalated", reason: d.reason, priority: prioridad } });
  });
  return obtenerLlamada(actor.empresaId, id);
}

export async function seguimiento(actor: Actor, id: string, d: z.infer<typeof llamadaSeguimiento>) {
  await enTx(async (c) => {
    const l = await bloquear(c, actor.empresaId, id);
    if (d.done) {
      if (!l.follow_up_at || l.follow_up_done_at) throw new ErrorSelfStorage("SIN_SEGUIMIENTO", "La llamada no tiene un seguimiento pendiente.", 409);
      await c.query(`UPDATE self_storage_calls SET follow_up_done_at = now(), status = 'closed', notes = coalesce($2, notes) WHERE id = $1`, [id, d.notes ?? null]);
      await evento(c, actor, id, "follow_up_done", {});
      await auditar(c, actor, { action: "call.follow_up_done", entityType: "call", entityId: id, before: { status: l.status }, after: { status: "closed" } });
      return;
    }
    pasar(l, "follow_up");
    const cuando = d.followUpAt ? new Date(d.followUpAt) : MANANA();
    await terminar(c, l);
    await c.query(`UPDATE self_storage_calls SET follow_up_at = $2, follow_up_done_at = NULL, status = 'follow_up', notes = coalesce($3, notes) WHERE id = $1`, [id, cuando, d.notes ?? null]);
    await evento(c, actor, id, "follow_up_scheduled", { followUpAt: cuando });
    await auditar(c, actor, { action: "call.follow_up_scheduled", entityType: "call", entityId: id, after: { followUpAt: cuando } });
  });
  return obtenerLlamada(actor.empresaId, id);
}

export async function finalizar(actor: Actor, id: string) {
  await enTx(async (c) => {
    const l = await bloquear(c, actor.empresaId, id);
    if (l.ended_at) return;
    await terminar(c, l);
    if (l.status === "started" || l.status === "in_progress") await c.query(`UPDATE self_storage_calls SET status = 'finished' WHERE id = $1`, [id]);
    await evento(c, actor, id, "finished");
  });
  return obtenerLlamada(actor.empresaId, id);
}

export async function cerrar(actor: Actor, id: string) {
  await enTx(async (c) => {
    const l = await bloquear(c, actor.empresaId, id);
    if (l.status === "closed") return;
    pasar(l, "closed");
    await terminar(c, l);
    await c.query(`UPDATE self_storage_calls SET status = 'closed' WHERE id = $1`, [id]);
    await evento(c, actor, id, "closed");
    await auditar(c, actor, { action: "call.closed", entityType: "call", entityId: id, before: { status: l.status }, after: { status: "closed" } });
  });
  return obtenerLlamada(actor.empresaId, id);
}

/** Operadores: quién ha atendido y cuánto (personas; la IA aparece como «IA»). */
export async function operadores(empresaId: string, f: { from?: string; to?: string }) {
  const { where, vals } = filtrosSql(empresaId, f);
  const { rows } = await pool.query(
    `SELECT l.operator_user_id AS "operatorUserId",
            CASE WHEN l.operator_user_id IS NULL THEN NULL ELSE coalesce(op.nombre, 'Usuario') END AS "operatorName",
            l.handled_by AS "handledBy", count(*)::int AS calls,
            round(avg(l.duration_seconds))::int AS "avgDurationSeconds",
            count(*) FILTER (WHERE l.status = 'escalated' OR l.escalated_at IS NOT NULL)::int AS escalated,
            count(*) FILTER (WHERE l.status = 'closed')::int AS closed,
            max(l.started_at) AS "lastCallAt"
       FROM self_storage_calls l LEFT JOIN app_usuarios op ON op.id = l.operator_user_id
      WHERE ${where}
      GROUP BY l.operator_user_id, op.nombre, l.handled_by
      ORDER BY calls DESC`,
    vals
  );
  return rows;
}
