/**
 * Dashboard del Asistente IA y logs (herramientas y errores de proveedor).
 */

import { pool } from "../../shared/db.ts";

export async function dashboardIA(empresaId: string, f: { from?: string; to?: string }) {
  const vals: unknown[] = [empresaId];
  const cond = ["s.empresa_id = $1"];
  if (f.from) {
    vals.push(f.from);
    cond.push(`s.started_at >= $${vals.length}::date`);
  }
  if (f.to) {
    vals.push(f.to);
    cond.push(`s.started_at < ($${vals.length}::date + 1)`);
  }
  const w = cond.join(" AND ");
  const tw = w.replaceAll("s.", "x.");
  const [{ rows: k }, { rows: herramientas }, { rows: porIdioma }, { rows: porProveedor }, { rows: noResueltas }] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS sessions,
              count(*) FILTER (WHERE s.status = 'finished')::int AS finished,
              count(*) FILTER (WHERE s.status = 'escalated')::int AS escalated,
              count(*) FILTER (WHERE s.status = 'error' OR s.error IS NOT NULL)::int AS errors,
              count(*) FILTER (WHERE s.status = 'active')::int AS active,
              round(avg(extract(epoch FROM (s.ended_at - s.started_at))) FILTER (WHERE s.ended_at IS NOT NULL))::int AS "avgDurationSeconds",
              coalesce(sum(s.input_tokens), 0)::int AS "inputTokens",
              coalesce(sum(s.output_tokens), 0)::int AS "outputTokens",
              sum(s.cost_estimate)::float8 AS "costEstimate",
              count(*) FILTER (WHERE s.flagged_for_review)::int AS flagged,
              count(*) FILTER (WHERE s.flagged_for_review AND s.review_status IS NULL)::int AS "pendingReview",
              count(*) FILTER (WHERE s.review_status = 'correct')::int AS "reviewCorrect",
              count(*) FILTER (WHERE s.review_status = 'partial')::int AS "reviewPartial",
              count(*) FILTER (WHERE s.review_status = 'incorrect')::int AS "reviewIncorrect"
         FROM self_storage_ai_sessions s WHERE ${w}`,
      vals
    ),
    pool.query(
      `SELECT t.tool, count(*)::int AS calls,
              count(*) FILTER (WHERE t.outcome = 'success')::int AS success,
              count(*) FILTER (WHERE t.outcome = 'error')::int AS errors,
              count(*) FILTER (WHERE t.outcome = 'blocked')::int AS blocked
         FROM self_storage_ai_tool_calls t JOIN self_storage_ai_sessions x ON x.id = t.session_id
        WHERE ${tw} GROUP BY t.tool ORDER BY calls DESC`,
      vals
    ),
    pool.query(`SELECT coalesce(s.language, '') AS code, count(*)::int AS sessions FROM self_storage_ai_sessions s WHERE ${w} GROUP BY 1 ORDER BY 2 DESC`, vals),
    pool.query(`SELECT s.provider, coalesce(s.model, '') AS model, count(*)::int AS sessions FROM self_storage_ai_sessions s WHERE ${w} GROUP BY 1, 2 ORDER BY 3 DESC`, vals),
    pool.query(
      `SELECT count(*)::int AS n FROM self_storage_ai_sessions s WHERE ${w} AND s.flag_reason LIKE '%consulta_no_resuelta%'`,
      vals
    ),
  ]);
  const t = k[0];
  const terminadas = t.finished + t.escalated;
  return {
    kpis: { ...t, resolutionPct: terminadas ? Math.round((1000 * t.finished) / terminadas) / 10 : 0, unresolvedQueries: noResueltas[0].n },
    herramientas,
    porIdioma,
    porProveedor,
  };
}

export async function logsHerramientas(empresaId: string, f: { outcome?: string; tool?: string; sessionId?: string; limit: number }) {
  const vals: unknown[] = [empresaId];
  const cond = ["t.empresa_id = $1"];
  const add = (sql: string, v: unknown) => {
    vals.push(v);
    cond.push(sql.replace("?", `$${vals.length}`));
  };
  if (f.outcome) add("t.outcome = ?", f.outcome);
  if (f.tool) add("t.tool = ?", f.tool);
  if (f.sessionId) add("t.session_id = ?", f.sessionId);
  const { rows } = await pool.query(
    `SELECT t.id, t.session_id AS "sessionId", t.call_id AS "callId", t.tool, t.risk, t.actor_type AS "actorType", t.outcome, t.error,
            t.params, t.result, t.duration_ms AS "durationMs", t.created_at AS "createdAt", s.provider
       FROM self_storage_ai_tool_calls t JOIN self_storage_ai_sessions s ON s.id = t.session_id
      WHERE ${cond.join(" AND ")} ORDER BY t.created_at DESC LIMIT ${f.limit}`,
    vals
  );
  return rows;
}
