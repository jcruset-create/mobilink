/**
 * Motor del Asistente IA. Igual con cualquier proveedor:
 *
 *   mensaje de quien llama
 *     → instrucciones (reglas obligatorias + de la empresa, conocimiento
 *       ESTÁTICO relevante, herramientas activas)
 *     → proveedor (con respaldo si falla) → decisión estructurada
 *     → herramienta (comprobada y registrada) → vuelta al proveedor…
 *     → respuesta (con guardas: nada de precios inventados)
 *     → escalado a una persona si hace falta (con el resumen)
 *
 * El Call Center no depende de esto: si el asistente está apagado, las
 * llamadas siguen funcionando con personas.
 */

import type { z } from "zod";
import { enTx, pool } from "../../shared/db.ts";
import { auditar, type Actor } from "../../shared/audit.ts";
import { leerAjuste } from "../../shared/settings.ts";
import { ErrorSelfStorage, noExiste } from "../../errors.ts";
import { interruptorGlobal } from "../../domain/callcenter.ts";
import {
  construirSistema,
  contienePrecio,
  costeEstimado,
  esquemaDecision,
  RESPUESTA_ESCALADO,
  RESPUESTA_FALLO,
  RESPUESTA_SIN_PRECIO,
  textoEn,
} from "../../domain/asistente.ts";
import { proveedorIA, type AIProvider, type DecisionIA, type MensajeIA } from "../../integrations/ai/index.ts";
import * as llamadas from "../callcenter/service.ts";
import { infoCentro } from "../callcenter/informes.ts";
import { buscar } from "./conocimiento.ts";
import { CATALOGO, catalogoEfectivo, ejecutarHerramienta, type ContextoHerramienta, type ResultadoHerramienta } from "./herramientas.ts";
import type { filtroSesiones, sesionAlta } from "../../schemas.ts";

/** Permisos con los que actúa el asistente cuando no hay una persona detrás (telefonía). */
export const PERMISOS_SISTEMA_IA = ["ss.callcenter.view", "ss.callcenter.create", "ss.callcenter.edit", "ss.callcenter.escalate", "ss.incidents.create"] as const;
const MAX_HERRAMIENTAS_POR_TURNO = 4;

// ── ¿Está activo? ───────────────────────────────────────────────────────────

export type EstadoAsistente = { global: boolean; empresa: boolean; enabled: boolean; provider: string; providerAvailable: boolean; fallbackProvider: string | null; mode: string };

export async function estadoAsistente(empresaId: string): Promise<EstadoAsistente> {
  const global = interruptorGlobal(process.env.SELF_STORAGE_AI_ASSISTANT_ENABLED);
  const [empresa, provider, fallback, mode] = await Promise.all([
    leerAjuste(pool, empresaId, null, "ai_assistant.enabled"),
    leerAjuste(pool, empresaId, null, "ai_assistant.provider"),
    leerAjuste(pool, empresaId, null, "ai_assistant.fallback_provider"),
    leerAjuste(pool, empresaId, null, "ai_assistant.mode"),
  ]);
  return { global, empresa, enabled: global && empresa, provider, providerAvailable: Boolean(proveedorIA(provider)?.disponible()), fallbackProvider: fallback, mode };
}

export async function exigirActivo(empresaId: string): Promise<EstadoAsistente> {
  const e = await estadoAsistente(empresaId);
  if (!e.global) throw new ErrorSelfStorage("ASISTENTE_APAGADO", "El Asistente IA está desactivado en este servidor.", 503);
  if (!e.empresa) throw new ErrorSelfStorage("ASISTENTE_DESACTIVADO", "El Asistente IA no está activado para esta empresa.", 409);
  return e;
}

const actorIA = (empresaId: string, proveedor: string): Actor => ({ empresaId, userId: "", nombre: `Asistente IA (${proveedor})`, tipo: "system", esIA: true });

// ── Sesiones ────────────────────────────────────────────────────────────────

type FilaSesion = {
  id: string;
  empresa_id: string;
  call_id: string | null;
  center_id: string | null;
  provider: string;
  model: string | null;
  language: string | null;
  status: "active" | "finished" | "escalated" | "error";
  turns: number;
  input_tokens: number;
  output_tokens: number;
  summary: string | null;
  created_by: string | null;
};

const COLUMNAS_SESION = `s.id, s.call_id AS "callId", s.center_id AS "centerId", ce.name AS "centerName", s.provider, s.model, s.language, s.mode, s.status,
  s.started_at AS "startedAt", s.ended_at AS "endedAt", s.turns, s.input_tokens AS "inputTokens", s.output_tokens AS "outputTokens",
  s.audio_seconds AS "audioSeconds", s.cost_estimate::float8 AS "costEstimate", s.summary, s.error, s.escalated_at AS "escalatedAt",
  s.escalation_reason AS "escalationReason", s.flagged_for_review AS "flaggedForReview", s.flag_reason AS "flagReason",
  s.review_status AS "reviewStatus", s.review_notes AS "reviewNotes", s.reviewed_at AS "reviewedAt", rv.nombre AS "reviewedByName",
  s.created_by AS "createdBy", cb.nombre AS "createdByName", l.phone_e164 AS "callPhone"`;
const FROM_SESION = `FROM self_storage_ai_sessions s
  LEFT JOIN self_storage_centers ce ON ce.id = s.center_id
  LEFT JOIN self_storage_calls l ON l.id = s.call_id
  LEFT JOIN app_usuarios rv ON rv.id = s.reviewed_by
  LEFT JOIN app_usuarios cb ON cb.id = s.created_by`;

export async function obtenerSesion(empresaId: string, id: string) {
  const { rows } = await pool.query(`SELECT ${COLUMNAS_SESION} ${FROM_SESION} WHERE s.empresa_id = $1 AND s.id = $2`, [empresaId, id]);
  if (!rows.length) throw noExiste("La sesión");
  const [{ rows: mensajes }, { rows: herramientas }] = await Promise.all([
    pool.query(`SELECT id, role, content, created_at AS "createdAt" FROM self_storage_ai_messages WHERE session_id = $1 ORDER BY created_at, id`, [id]),
    pool.query(
      `SELECT id, tool, risk, outcome, params, result, error, duration_ms AS "durationMs", created_at AS "createdAt"
         FROM self_storage_ai_tool_calls WHERE empresa_id = $1 AND session_id = $2 ORDER BY created_at`,
      [empresaId, id]
    ),
  ]);
  return { ...rows[0], messages: mensajes, toolCalls: herramientas };
}

export async function listarSesiones(empresaId: string, f: z.infer<typeof filtroSesiones>) {
  const vals: unknown[] = [empresaId];
  const cond = ["s.empresa_id = $1"];
  const add = (sql: string, v: unknown) => {
    vals.push(v);
    cond.push(sql.replace("?", `$${vals.length}`));
  };
  if (f.from) add("s.started_at >= ?::date", f.from);
  if (f.to) add("s.started_at < (?::date + 1)", f.to);
  if (f.status) add("s.status = ?", f.status);
  if (f.provider) add("s.provider = ?", f.provider);
  if (f.language) add("s.language = ?", f.language);
  if (f.callId) add("s.call_id = ?", f.callId);
  if (f.flagged) cond.push("s.flagged_for_review");
  if (f.reviewStatus === "pending") cond.push("s.flagged_for_review AND s.review_status IS NULL");
  else if (f.reviewStatus) add("s.review_status = ?", f.reviewStatus);
  const where = cond.join(" AND ");
  const [{ rows }, { rows: t }] = await Promise.all([
    pool.query(`SELECT ${COLUMNAS_SESION} ${FROM_SESION} WHERE ${where} ORDER BY s.started_at DESC LIMIT ${f.limit} OFFSET ${f.offset}`, vals),
    pool.query(`SELECT count(*)::int AS n FROM self_storage_ai_sessions s WHERE ${where}`, vals),
  ]);
  return { total: t[0].n as number, items: rows };
}

/** Elige el proveedor: el configurado si está disponible; si no, el de respaldo. */
async function elegirProveedor(empresaId: string): Promise<AIProvider> {
  const e = await estadoAsistente(empresaId);
  const principal = proveedorIA(e.provider);
  if (principal?.disponible()) return principal;
  const respaldo = e.fallbackProvider ? proveedorIA(e.fallbackProvider) : null;
  if (respaldo?.disponible()) return respaldo;
  throw new ErrorSelfStorage("PROVEEDOR_NO_DISPONIBLE", `El proveedor de IA «${e.provider}» no está disponible (¿falta su clave en el servidor?) y no hay respaldo.`, 409);
}

export async function iniciarSesion(staff: Actor, d: z.infer<typeof sesionAlta>) {
  await exigirActivo(staff.empresaId);
  const prov = await elegirProveedor(staff.empresaId);
  const ia = actorIA(staff.empresaId, prov.nombre);
  let callId = d.callId ?? null;
  let centerId = d.centerId ?? null;
  if (callId) {
    await llamadas.exigirActivo(staff.empresaId);
    const l = await llamadas.obtenerLlamada(staff.empresaId, callId);
    if (l.status === "closed") throw new ErrorSelfStorage("LLAMADA_CERRADA", "La llamada está cerrada.", 409);
    centerId = centerId ?? l.centerId;
  } else if (d.simulateCall) {
    // Consola: una llamada simulada atendida por la IA (queda en el Call Center).
    await llamadas.exigirActivo(staff.empresaId);
    const l = await llamadas.crearLlamada(ia, { phone: d.simulateCall.phone ?? null, callerName: d.simulateCall.callerName ?? null, centerId, direction: "incoming", handledBy: "ai", language: d.language ?? null, answered: true });
    callId = l.id;
    centerId = centerId ?? l.centerId;
  }
  if (!centerId) centerId = await infoCentro(staff.empresaId, null).then((c) => c.id, () => null);
  const id = await enTx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO self_storage_ai_sessions (empresa_id, call_id, center_id, provider, model, language, mode, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [staff.empresaId, callId, centerId, prov.nombre, prov.modelo(), d.language ?? null, callId ? "call" : "console", staff.userId || null]
    );
    const sid = rows[0].id as string;
    if (callId) {
      // Una llamada de una persona con la IA ayudando pasa a ser híbrida.
      await c.query(`UPDATE self_storage_calls SET handled_by = CASE WHEN handled_by = 'human' THEN 'hybrid' ELSE handled_by END WHERE id = $1`, [callId]);
      await llamadas.evento(c, ia, callId, "ai_session_started", { sessionId: sid, provider: prov.nombre });
    }
    await auditar(c, staff, { action: "ai_session.started", entityType: "ai_session", entityId: sid, after: { provider: prov.nombre, model: prov.modelo(), callId } });
    return sid;
  });
  return obtenerSesion(staff.empresaId, id);
}

async function sesionViva(empresaId: string, id: string): Promise<FilaSesion> {
  const { rows } = await pool.query(`SELECT * FROM self_storage_ai_sessions WHERE empresa_id = $1 AND id = $2`, [empresaId, id]);
  if (!rows.length) throw noExiste("La sesión");
  if (rows[0].status !== "active") throw new ErrorSelfStorage("SESION_TERMINADA", "La sesión ya no está activa.", 409);
  return rows[0];
}

const guardarMensaje = (empresaId: string, sessionId: string, role: "user" | "assistant" | "tool", content: string) =>
  pool.query(`INSERT INTO self_storage_ai_messages (empresa_id, session_id, role, content) VALUES ($1,$2,$3,$4)`, [empresaId, sessionId, role, content.slice(0, 20000)]);

async function marcar(sessionId: string, motivo: string) {
  await pool.query(
    `UPDATE self_storage_ai_sessions SET flagged_for_review = true,
            flag_reason = CASE WHEN flag_reason IS NULL THEN $2 WHEN position($2 in flag_reason) > 0 THEN flag_reason ELSE flag_reason || ', ' || $2 END
      WHERE id = $1`,
    [sessionId, motivo]
  );
}

export type RespuestaTurno = {
  reply: string;
  action: DecisionIA["accion"] | "error";
  language: string;
  tools: { tool: string; outcome: ResultadoHerramienta["estado"]; error?: string }[];
  session: Awaited<ReturnType<typeof obtenerSesion>>;
};

/** Un turno: quien llama dice algo, el asistente decide (con herramientas) y contesta. */
export async function mensaje(staff: Actor, permisos: readonly string[], sessionId: string, texto: string): Promise<RespuestaTurno> {
  await exigirActivo(staff.empresaId);
  const s = await sesionViva(staff.empresaId, sessionId);
  const empresaId = staff.empresaId;
  const [maxTurnos, idiomas, extra, escaladoHumano, guardarResumen, fallbackNombre] = await Promise.all([
    leerAjuste(pool, empresaId, null, "ai_assistant.max_turns"),
    leerAjuste(pool, empresaId, null, "ai_assistant.languages"),
    leerAjuste(pool, empresaId, null, "ai_assistant.extra_rules"),
    leerAjuste(pool, empresaId, null, "ai_assistant.human_escalation"),
    leerAjuste(pool, empresaId, null, "ai_assistant.store_summary"),
    leerAjuste(pool, empresaId, null, "ai_assistant.fallback_provider"),
  ]);
  const enlaces = await leerAjuste(pool, empresaId, s.center_id, "call_center.links");
  let idioma = s.language ?? idiomas[0] ?? "es";
  const herramientasUsadas: RespuestaTurno["tools"] = [];

  if (s.turns >= maxTurnos) {
    await guardarMensaje(empresaId, sessionId, "user", texto);
    return cerrarTurno(staff, s, { accion: "escalar", idioma, respuesta: "", herramienta: "", parametros_json: "{}", motivo_escalado: "Límite de turnos de la sesión", resumen: s.summary ?? "" }, herramientasUsadas, { escaladoHumano, guardarResumen, web: enlaces.web, tokensE: 0, tokensS: 0, modelo: s.model });
  }

  await guardarMensaje(empresaId, sessionId, "user", texto);
  const centro = s.center_id ? await infoCentro(empresaId, s.center_id).catch(() => null) : null;
  const catalogo = (await catalogoEfectivo(empresaId)).filter((h) => h.active);
  let callId = s.call_id;
  const ctx: ContextoHerramienta = {
    empresaId,
    sessionId,
    callId,
    centerId: s.center_id,
    idioma,
    actorIA: actorIA(empresaId, s.provider),
    staffUserId: staff.userId || null,
    permisos,
    adoptarLlamada: async (id) => {
      callId = id;
      ctx.callId = id;
      await pool.query(`UPDATE self_storage_ai_sessions SET call_id = $2, mode = 'call' WHERE id = $1`, [sessionId, id]);
    },
  };

  let proveedor: AIProvider | null = proveedorIA(s.provider);
  let tokensE = 0;
  let tokensS = 0;
  let modelo = s.model;
  let decision: DecisionIA | null = null;

  for (let vuelta = 0; vuelta <= MAX_HERRAMIENTAS_POR_TURNO; vuelta++) {
    const { rows: hist } = await pool.query(`SELECT role, content FROM self_storage_ai_messages WHERE session_id = $1 AND role <> 'system' ORDER BY created_at, id`, [sessionId]);
    const mensajes: MensajeIA[] = hist.map((m) => ({ rol: m.role, texto: m.content }));
    const consulta = [...mensajes].reverse().find((m) => m.rol === "user")?.texto ?? texto;
    const conocimiento = await buscar(empresaId, s.center_id, idioma, consulta, 6);
    const sistema = construirSistema({
      marca: enlaces.brandName,
      web: enlaces.web,
      calculadora: enlaces.calculator,
      contratacion: enlaces.contracting,
      visitaVirtual: enlaces.virtualVisit,
      centro: centro ? { name: centro.name, city: centro.city } : null,
      idiomas,
      reglasExtra: extra,
      conocimiento,
      herramientas: catalogo.map((h) => ({ nombre: h.nombre, descripcion: h.descripcion, parametros: h.parametros, riesgo: h.riesgo })),
      escaladoHumano,
    });

    // Proveedor, y si falla, el de respaldo (una vez).
    let r = proveedor && proveedor.disponible() ? await proveedor.decidir({ sistema, mensajes, operacion: "self_storage.asistente" }) : null;
    if (!r?.ok) {
      const respaldo = fallbackNombre && fallbackNombre !== proveedor?.nombre ? proveedorIA(fallbackNombre) : null;
      if (respaldo?.disponible()) {
        await marcar(sessionId, "respaldo_proveedor");
        await pool.query(`UPDATE self_storage_ai_sessions SET error = $2 WHERE id = $1`, [sessionId, `Proveedor ${proveedor?.nombre ?? s.provider} sin respuesta: ${r?.error ?? "no disponible"}`.slice(0, 500)]);
        proveedor = respaldo;
        r = await respaldo.decidir({ sistema, mensajes, operacion: "self_storage.asistente" });
      }
    }
    if (!r?.ok) {
      await marcar(sessionId, "error_proveedor");
      await pool.query(`UPDATE self_storage_ai_sessions SET error = $2 WHERE id = $1`, [sessionId, `Proveedor sin respuesta: ${r?.error ?? "no disponible"}`.slice(0, 500)]);
      decision = { accion: "escalar", idioma, respuesta: "", herramienta: "", parametros_json: "{}", motivo_escalado: "Proveedor de IA no disponible", resumen: s.summary ?? "" };
      break;
    }
    tokensE += r.tokensEntrada ?? 0;
    tokensS += r.tokensSalida ?? 0;
    modelo = r.modelo;
    const v = esquemaDecision.safeParse(r.decision);
    if (!v.success) {
      await marcar(sessionId, "decision_no_valida");
      decision = { accion: "escalar", idioma, respuesta: "", herramienta: "", parametros_json: "{}", motivo_escalado: "Respuesta del proveedor no válida", resumen: s.summary ?? "" };
      break;
    }
    decision = { ...v.data, idioma: v.data.idioma ?? idioma };
    if (idiomas.includes(decision.idioma)) idioma = decision.idioma;
    ctx.idioma = idioma;
    if (decision.accion !== "herramienta") break;
    if (vuelta === MAX_HERRAMIENTAS_POR_TURNO) {
      await marcar(sessionId, "demasiadas_herramientas");
      decision = { ...decision, accion: "escalar", motivo_escalado: "Demasiadas consultas en un turno" };
      break;
    }
    let parametros: unknown;
    try {
      parametros = JSON.parse(decision.parametros_json || "{}");
    } catch {
      parametros = { __invalido: decision.parametros_json.slice(0, 200) };
    }
    const res = await ejecutarHerramienta(ctx, decision.herramienta, parametros);
    herramientasUsadas.push({ tool: decision.herramienta, outcome: res.estado, error: res.error });
    if (res.estado !== "success") await marcar(sessionId, res.estado === "blocked" ? "herramienta_bloqueada" : "herramienta_fallida");
    if (res.estado === "success" && decision.herramienta === "obtener_base_conocimiento" && !(res.resultado as { items?: unknown[] })?.items?.length) {
      await marcar(sessionId, "consulta_no_resuelta");
    }
    await guardarMensaje(empresaId, sessionId, "tool", JSON.stringify(res));
  }

  const sFresca = { ...s, call_id: callId, language: idioma };
  return cerrarTurno(staff, sFresca, decision!, herramientasUsadas, { escaladoHumano, guardarResumen, web: enlaces.web, tokensE, tokensS, modelo });
}

async function cerrarTurno(
  staff: Actor,
  s: FilaSesion,
  decision: DecisionIA,
  herramientas: RespuestaTurno["tools"],
  o: { escaladoHumano: boolean; guardarResumen: boolean; web: string | null; tokensE: number; tokensS: number; modelo: string | null }
): Promise<RespuestaTurno> {
  const empresaId = staff.empresaId;
  const idioma = decision.idioma || s.language || "es";
  let respuesta = decision.respuesta.trim();
  let accion: RespuestaTurno["action"] = decision.accion;

  // Guarda: un importe con moneda no puede salir de la cabeza del modelo.
  if (respuesta && contienePrecio(respuesta)) {
    respuesta = textoEn(RESPUESTA_SIN_PRECIO, idioma)(o.web);
    await marcar(s.id, "posible_precio_inventado");
  }
  if (accion === "escalar") {
    if (o.escaladoHumano) {
      respuesta = respuesta || textoEn(RESPUESTA_ESCALADO, idioma);
    } else {
      // Sin paso a persona: se remite a la web y se marca para revisión.
      respuesta = textoEn(RESPUESTA_FALLO, idioma)(o.web);
      await marcar(s.id, "sin_escalado_humano");
      accion = "responder";
    }
  }
  if (!respuesta) respuesta = textoEn(RESPUESTA_FALLO, idioma)(o.web);
  await guardarMensaje(empresaId, s.id, "assistant", respuesta);

  const coste = costeEstimado(o.tokensE, o.tokensS, numeroEnv("SELF_STORAGE_AI_PRICE_INPUT_PER_MTOK"), numeroEnv("SELF_STORAGE_AI_PRICE_OUTPUT_PER_MTOK"));
  await pool.query(
    `UPDATE self_storage_ai_sessions
        SET turns = turns + 1, input_tokens = input_tokens + $2, output_tokens = output_tokens + $3, language = $4,
            model = coalesce($5, model), summary = CASE WHEN $6 THEN coalesce(nullif($7, ''), summary) ELSE summary END,
            cost_estimate = CASE WHEN $8::numeric IS NULL THEN cost_estimate ELSE coalesce(cost_estimate, 0) + $8::numeric END
      WHERE id = $1`,
    [s.id, o.tokensE, o.tokensS, idioma, o.modelo, o.guardarResumen, decision.resumen?.trim() ?? "", coste]
  );
  if (s.call_id) await pool.query(`UPDATE self_storage_calls SET language = coalesce(language, $2) WHERE id = $1`, [s.call_id, idioma]);

  if (accion === "escalar") await escalarSesion(staff, s.id, decision.motivo_escalado || "Escalado por el asistente", decision.resumen);
  if (accion === "finalizar") await finalizarSesion(staff, s.id);
  return { reply: respuesta, action: accion, language: idioma, tools: herramientas, session: await obtenerSesion(empresaId, s.id) };
}

const numeroEnv = (k: string): number | null => {
  const v = Number(process.env[k]);
  return process.env[k] && Number.isFinite(v) && v >= 0 ? v : null;
};

/**
 * IA → persona. Se guarda el motivo y el resumen; la llamada (si la hay) pasa
 * a «escalada» con `requires_human`, es híbrida y la persona que la recoja ve
 * el resumen de lo hablado.
 */
export async function escalarSesion(quien: Actor, sessionId: string, motivo: string, resumen?: string | null) {
  const { rows } = await pool.query(
    `UPDATE self_storage_ai_sessions
        SET status = 'escalated', escalated_at = now(), ended_at = coalesce(ended_at, now()), escalation_reason = $3,
            summary = coalesce(nullif($4, ''), summary), flagged_for_review = true,
            flag_reason = CASE WHEN flag_reason IS NULL THEN 'escalado' WHEN position('escalado' in flag_reason) > 0 THEN flag_reason ELSE flag_reason || ', escalado' END
      WHERE empresa_id = $1 AND id = $2 AND status = 'active' RETURNING call_id, provider, summary`,
    [quien.empresaId, sessionId, motivo.slice(0, 500), resumen?.trim() ?? ""]
  );
  if (!rows.length) return;
  const { call_id: callId, provider, summary } = rows[0];
  const ia = actorIA(quien.empresaId, provider);
  if (callId) {
    await pool.query(`UPDATE self_storage_calls SET handled_by = 'hybrid' WHERE id = $1`, [callId]);
    await llamadas.escalar(ia, callId, { reason: `Asistente IA: ${motivo}`.slice(0, 500), summary: summary ?? null }).catch(() => undefined);
  }
  await auditar(pool, quien.userId ? quien : ia, { action: "ai_session.escalated", entityType: "ai_session", entityId: sessionId, after: { reason: motivo, callId } });
  await borrarMensajesSiNoSeGuardan(quien.empresaId, sessionId);
}

export async function finalizarSesion(quien: Actor, sessionId: string) {
  const { rows } = await pool.query(
    `UPDATE self_storage_ai_sessions SET status = 'finished', ended_at = now() WHERE empresa_id = $1 AND id = $2 AND status = 'active' RETURNING call_id, provider, summary`,
    [quien.empresaId, sessionId]
  );
  if (!rows.length) return obtenerSesion(quien.empresaId, sessionId);
  const { call_id: callId, provider, summary } = rows[0];
  if (callId) {
    const ia = actorIA(quien.empresaId, provider);
    const guardarResumen = await leerAjuste(pool, quien.empresaId, null, "ai_assistant.store_summary");
    await llamadas.evento(pool, ia, callId, "ai_session_finished", { sessionId });
    if (guardarResumen && summary) await pool.query(`UPDATE self_storage_calls SET summary = coalesce(summary, $2) WHERE id = $1`, [callId, summary]);
  }
  await borrarMensajesSiNoSeGuardan(quien.empresaId, sessionId);
  return obtenerSesion(quien.empresaId, sessionId);
}

/** Protección de datos: sin «guardar transcripciones», la conversación no sobrevive a la sesión. */
async function borrarMensajesSiNoSeGuardan(empresaId: string, sessionId: string) {
  if (await leerAjuste(pool, empresaId, null, "ai_assistant.store_transcripts")) return;
  await pool.query(`DELETE FROM self_storage_ai_messages WHERE empresa_id = $1 AND session_id = $2`, [empresaId, sessionId]);
}

export async function revisarSesion(actor: Actor, sessionId: string, d: { reviewStatus: "correct" | "partial" | "incorrect"; notes?: string | null }) {
  const { rows } = await pool.query(
    `UPDATE self_storage_ai_sessions SET review_status = $3, review_notes = $4, reviewed_by = $5, reviewed_at = now()
      WHERE empresa_id = $1 AND id = $2 RETURNING id`,
    [actor.empresaId, sessionId, d.reviewStatus, d.notes ?? null, actor.userId || null]
  );
  if (!rows.length) throw noExiste("La sesión");
  await auditar(pool, actor, { action: "ai_session.reviewed", entityType: "ai_session", entityId: sessionId, after: d });
  return obtenerSesion(actor.empresaId, sessionId);
}

/** Para la documentación y las pruebas: nombres de herramientas por riesgo. */
export const herramientasPorRiesgo = (riesgo: string) => CATALOGO.filter((h) => h.riesgo === riesgo).map((h) => h.nombre);
