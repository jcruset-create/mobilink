/**
 * Call Center · indicadores, series para los gráficos, información del centro
 * y disponibilidad agregada.
 *
 * Disponibilidad: sale SIEMPRE de los trasteros reales en este momento y sólo
 * dice si hay o no por tipo. Ni precios, ni reservas, ni garantías de futuro:
 * Mobilink informa de disponibilidad; la web confirma precio y contratación.
 */

import { pool } from "../../shared/db.ts";
import { leerAjuste } from "../../shared/settings.ts";
import { noExiste } from "../../errors.ts";
import { RESULTADOS_RESUELTOS } from "../../domain/callcenter.ts";

type Filtro = { from?: string; to?: string; centerId?: string };

function where(empresaId: string, f: Filtro) {
  const vals: unknown[] = [empresaId];
  const cond = ["l.empresa_id = $1"];
  if (f.from) {
    vals.push(f.from);
    cond.push(`l.started_at >= $${vals.length}::date`);
  }
  if (f.to) {
    vals.push(f.to);
    cond.push(`l.started_at < ($${vals.length}::date + 1)`);
  }
  if (f.centerId) {
    vals.push(f.centerId);
    cond.push(`l.center_id = $${vals.length}`);
  }
  return { sql: cond.join(" AND "), vals };
}

export async function dashboard(empresaId: string, f: Filtro) {
  const w = where(empresaId, f);
  const resueltos = `ARRAY[${RESULTADOS_RESUELTOS.map((r) => `'${r}'`).join(",")}]::text[]`;
  const [{ rows: k }, { rows: periodos }, { rows: porDia }, { rows: porMotivo }, { rows: porResultado }, { rows: porIdioma }, { rows: porCentro }, { rows: inc }] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS total,
              round(avg(l.duration_seconds))::int AS "avgDurationSeconds",
              count(*) FILTER (WHERE l.direction = 'incoming')::int AS incoming,
              count(*) FILTER (WHERE l.direction = 'outgoing')::int AS outgoing,
              count(*) FILTER (WHERE l.result_code = ANY(${resueltos}))::int AS resolved,
              count(*) FILTER (WHERE l.escalated_at IS NOT NULL)::int AS escalated,
              count(*) FILTER (WHERE l.handled_by = 'ai')::int AS ai,
              count(*) FILTER (WHERE l.handled_by = 'human')::int AS human,
              count(*) FILTER (WHERE l.handled_by = 'hybrid')::int AS hybrid,
              count(*) FILTER (WHERE l.customer_id IS NOT NULL)::int AS "existingCustomers",
              count(DISTINCT l.phone_e164) FILTER (WHERE l.customer_id IS NULL AND l.phone_e164 IS NOT NULL)::int AS "newInterested",
              count(*) FILTER (WHERE l.result_code IN ('visita_virtual_solicitada','visita_guiada_solicitada'))::int AS "visitRequests",
              count(*) FILTER (WHERE l.reason_code = 'precio_disponibilidad')::int AS "priceQueries",
              count(*) FILTER (WHERE l.reason_code IN ('tamano_trastero','calculadora_espacio'))::int AS "sizeQueries",
              count(*) FILTER (WHERE l.result_code = 'enviado_calculadora')::int AS "sentToCalculator",
              count(*) FILTER (WHERE l.result_code = 'enviado_contratacion')::int AS "sentToContracting",
              count(*) FILTER (WHERE l.follow_up_at IS NOT NULL AND l.follow_up_done_at IS NULL)::int AS "pendingFollowUps"
         FROM self_storage_calls l WHERE ${w.sql}`,
      w.vals
    ),
    // Hoy / semana / mes, siempre respecto a ahora (no dependen del filtro de fechas).
    pool.query(
      `SELECT count(*) FILTER (WHERE l.started_at >= date_trunc('day', now() AT TIME ZONE 'Europe/Madrid') AT TIME ZONE 'Europe/Madrid')::int AS today,
              count(*) FILTER (WHERE l.started_at >= date_trunc('week', now() AT TIME ZONE 'Europe/Madrid') AT TIME ZONE 'Europe/Madrid')::int AS week,
              count(*) FILTER (WHERE l.started_at >= date_trunc('month', now() AT TIME ZONE 'Europe/Madrid') AT TIME ZONE 'Europe/Madrid')::int AS month
         FROM self_storage_calls l WHERE l.empresa_id = $1 ${f.centerId ? "AND l.center_id = $2" : ""}`,
      f.centerId ? [empresaId, f.centerId] : [empresaId]
    ),
    pool.query(
      `SELECT to_char(l.started_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD') AS day, count(*)::int AS calls,
              round(avg(l.duration_seconds))::int AS "avgDurationSeconds",
              count(*) FILTER (WHERE l.result_code = ANY(${resueltos}))::int AS resolved,
              count(*) FILTER (WHERE l.escalated_at IS NOT NULL)::int AS escalated,
              count(*) FILTER (WHERE l.handled_by = 'human')::int AS human,
              count(*) FILTER (WHERE l.handled_by = 'ai')::int AS ai,
              count(*) FILTER (WHERE l.handled_by = 'hybrid')::int AS hybrid
         FROM self_storage_calls l WHERE ${w.sql} GROUP BY 1 ORDER BY 1`,
      w.vals
    ),
    pool.query(
      `SELECT coalesce(l.reason_code, '') AS code, coalesce(c.label, 'Sin motivo') AS label, count(*)::int AS calls
         FROM self_storage_calls l LEFT JOIN self_storage_call_catalog c ON c.empresa_id = l.empresa_id AND c.kind = 'reason' AND c.code = l.reason_code
        WHERE ${w.sql} GROUP BY 1, 2 ORDER BY 3 DESC`,
      w.vals
    ),
    pool.query(
      `SELECT coalesce(l.result_code, '') AS code, coalesce(c.label, 'Sin resultado') AS label, count(*)::int AS calls
         FROM self_storage_calls l LEFT JOIN self_storage_call_catalog c ON c.empresa_id = l.empresa_id AND c.kind = 'result' AND c.code = l.result_code
        WHERE ${w.sql} GROUP BY 1, 2 ORDER BY 3 DESC`,
      w.vals
    ),
    pool.query(`SELECT coalesce(l.language, '') AS code, count(*)::int AS calls FROM self_storage_calls l WHERE ${w.sql} GROUP BY 1 ORDER BY 2 DESC`, w.vals),
    pool.query(
      `SELECT l.center_id AS "centerId", coalesce(ce.name, 'Sin centro') AS label, count(*)::int AS calls
         FROM self_storage_calls l LEFT JOIN self_storage_centers ce ON ce.id = l.center_id
        WHERE ${w.sql} GROUP BY 1, 2 ORDER BY 3 DESC`,
      w.vals
    ),
    pool.query(
      `SELECT count(*) FILTER (WHERE n.status IN ('open','in_progress'))::int AS open,
              count(*) FILTER (WHERE n.status IN ('open','in_progress') AND n.priority = 'urgent')::int AS urgent,
              count(*) FILTER (WHERE n.call_id IS NOT NULL)::int AS "fromCalls"
         FROM self_storage_incidents n
        WHERE n.empresa_id = $1 ${f.centerId ? "AND n.center_id = $2" : ""}`,
      f.centerId ? [empresaId, f.centerId] : [empresaId]
    ),
  ]);
  const t = k[0];
  const pct = (n: number) => (t.total ? Math.round((1000 * n) / t.total) / 10 : 0);
  return {
    kpis: {
      ...periodos[0],
      ...t,
      resolvedPct: pct(t.resolved),
      escalatedPct: pct(t.escalated),
      aiPct: pct(t.ai),
      humanPct: pct(t.human),
      hybridPct: pct(t.hybrid),
      incidentsOpen: inc[0].open,
      incidentsUrgent: inc[0].urgent,
      incidentsFromCalls: inc[0].fromCalls,
    },
    series: { porDia, porMotivo, porResultado, porIdioma, porCentro },
  };
}

/** Lo que el Call Center puede contar de un centro: dirección, contacto, horario y enlaces. */
export async function infoCentro(empresaId: string, centerId: string | null) {
  const { rows } = await pool.query(
    `SELECT id, code, name, address, postal_code AS "postalCode", city, province, phone, email, access_schedule AS "accessSchedule", timezone
       FROM self_storage_centers WHERE empresa_id = $1 AND ($2::uuid IS NULL OR id = $2) AND status = 'active'
      ORDER BY name LIMIT 1`,
    [empresaId, centerId]
  );
  if (!rows.length) throw noExiste("El centro");
  const enlaces = await leerAjuste(pool, empresaId, rows[0].id, "call_center.links");
  return { ...rows[0], links: enlaces };
}

/**
 * ¿Hay trasteros disponibles de cada tipo AHORA? Sólo sí/no por tipo (más
 * medidas nominales para orientar). Sin precio, sin reservar, sin bloquear.
 */
export async function disponibilidad(empresaId: string, centerId: string) {
  const { rows: c } = await pool.query(`SELECT id, name FROM self_storage_centers WHERE empresa_id = $1 AND id = $2`, [empresaId, centerId]);
  if (!c.length) throw noExiste("El centro");
  const { rows } = await pool.query(
    `SELECT t.id AS "unitTypeId", t.name, t.nominal_area_m2::float8 AS "areaM2", t.nominal_volume_m3::float8 AS "volumeM3",
            EXISTS (SELECT 1 FROM self_storage_units u
                     WHERE u.unit_type_id = t.id AND u.center_id = $2 AND u.status = 'available') AS available
       FROM self_storage_unit_types t
      WHERE t.empresa_id = $1 AND t.active AND (t.center_id IS NULL OR t.center_id = $2)
        AND EXISTS (SELECT 1 FROM self_storage_units u WHERE u.unit_type_id = t.id AND u.center_id = $2)
      ORDER BY t.sort_order, t.nominal_area_m2`,
    [empresaId, centerId]
  );
  return {
    centerId,
    centerName: c[0].name,
    checkedAt: new Date().toISOString(),
    types: rows,
    // Lo que se le dice a quien llama: la web confirma precio y contratación.
    notice: "Disponibilidad orientativa en este momento. El precio, la disponibilidad definitiva y la contratación se confirman en la web.",
  };
}
