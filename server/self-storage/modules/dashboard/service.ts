/**
 * Dashboard de ocupación (fase 1) y de cobros (fase 2).
 *
 * Ocupación por trasteros y por m², sobre el total y sobre lo ALQUILABLE (sin
 * los que están en mantenimiento o bloqueados: no se pueden alquilar y
 * hundirían el porcentaje sin que haya nada que vender). Accesos y puertas
 * llegan en la fase 3; aquí van a null para que el panel diga «disponible en
 * la fase N» en vez de enseñar un cero que parece un dato. Las cifras de
 * cobros sólo las recibe quien puede ver la facturación.
 */

import type { Actor } from "../../shared/audit.ts";
import { pool } from "../../shared/db.ts";
import { noExiste } from "../../errors.ts";
import { redondear2 } from "../../domain/pricing.ts";
import * as repoCentros from "../centros/repository.ts";

type Recuento = { total: number; available: number; reserved: number; occupied: number; maintenance: number; blocked: number; areaTotal: number; areaOcupada: number; areaAlquilable: number };

function porcentaje(parte: number, total: number): number | null {
  return total > 0 ? redondear2((parte / total) * 100) : null;
}

function indicadores(r: Recuento) {
  const alquilables = r.total - r.maintenance - r.blocked;
  return {
    ...r,
    rentable: alquilables,
    occupancyPct: porcentaje(r.occupied, r.total),
    occupancyRentablePct: porcentaje(r.occupied, alquilables),
    areaOccupancyPct: porcentaje(r.areaOcupada, r.areaTotal),
  };
}

const SQL_RECUENTO = `
  count(u.id)::int AS total,
  count(*) FILTER (WHERE u.status = 'available')::int AS available,
  count(*) FILTER (WHERE u.status = 'reserved')::int AS reserved,
  count(*) FILTER (WHERE u.status = 'occupied')::int AS occupied,
  count(*) FILTER (WHERE u.status = 'maintenance')::int AS maintenance,
  count(*) FILTER (WHERE u.status = 'blocked')::int AS blocked,
  coalesce(sum(u.area_m2), 0)::float8 AS "areaTotal",
  coalesce(sum(u.area_m2) FILTER (WHERE u.status = 'occupied'), 0)::float8 AS "areaOcupada",
  coalesce(sum(u.area_m2) FILTER (WHERE u.status NOT IN ('maintenance','blocked')), 0)::float8 AS "areaAlquilable"`;

/** Facturado este mes (neto de rectificativas), pendiente de cobro y vencido. */
async function cobros(empresaId: string, centerId: string | null) {
  const { rows } = await pool.query(
    `SELECT coalesce(sum(i.total) FILTER (WHERE i.status <> 'draft' AND i.issue_date >= date_trunc('month', (now() AT TIME ZONE 'Europe/Madrid'))::date), 0)::float8 AS "monthlyInvoiced",
            coalesce(sum(i.total) FILTER (WHERE i.status IN ('pending','overdue')), 0)::float8 AS "pendingCollection",
            coalesce(sum(i.total) FILTER (WHERE i.status = 'overdue'), 0)::float8 AS overdue,
            (SELECT count(*)::int FROM self_storage_dunning_cases d
               LEFT JOIN self_storage_contracts kd ON kd.id = d.contract_id
              WHERE d.empresa_id = $1 AND d.status = 'open' ${centerId ? "AND kd.center_id = $2" : ""}) AS "openDunning"
       FROM self_storage_invoices i
       LEFT JOIN self_storage_contracts k ON k.id = i.contract_id
      WHERE i.empresa_id = $1 ${centerId ? "AND k.center_id = $2" : ""}`,
    centerId ? [empresaId, centerId] : [empresaId]
  );
  return rows[0] as { monthlyInvoiced: number; pendingCollection: number; overdue: number; openDunning: number };
}

export async function dashboard(actor: Actor, centerId: string | null, verCobros = false) {
  if (centerId && !(await repoCentros.obtenerCentro(pool, actor.empresaId, centerId))) throw noExiste("El centro");
  const filtro = centerId ? "AND u.center_id = $2" : "";
  const vals = centerId ? [actor.empresaId, centerId] : [actor.empresaId];

  const [total, zonas, centros, clientes, facturacion] = await Promise.all([
    pool.query(`SELECT ${SQL_RECUENTO} FROM self_storage_units u WHERE u.empresa_id = $1 ${filtro}`, vals),
    pool.query(
      `SELECT z.id, z.code, z.name, ce.name AS "centerName", ${SQL_RECUENTO}
         FROM self_storage_zones z
         JOIN self_storage_centers ce ON ce.id = z.center_id
         LEFT JOIN self_storage_units u ON u.zone_id = z.id
        WHERE z.empresa_id = $1 ${centerId ? "AND z.center_id = $2" : ""}
        GROUP BY z.id, z.code, z.name, ce.name, z.sort_order
        ORDER BY ce.name, z.sort_order, z.code`,
      vals
    ),
    pool.query(
      `SELECT ce.id, ce.code, ce.name, ${SQL_RECUENTO}
         FROM self_storage_centers ce
         LEFT JOIN self_storage_units u ON u.center_id = ce.id
        WHERE ce.empresa_id = $1 ${centerId ? "AND ce.id = $2" : ""}
        GROUP BY ce.id, ce.code, ce.name ORDER BY ce.name`,
      vals
    ),
    pool.query(
      `SELECT count(*) FILTER (WHERE status = 'active')::int AS active,
              count(*) FILTER (WHERE status = 'blocked')::int AS blocked,
              count(*)::int AS total
         FROM self_storage_customers WHERE empresa_id = $1`,
      [actor.empresaId]
    ),
    verCobros ? cobros(actor.empresaId, centerId) : Promise.resolve(null),
  ]);

  return {
    centerId,
    units: indicadores(total.rows[0]),
    byCenter: centros.rows.map((r) => ({ id: r.id, code: r.code, name: r.name, ...indicadores(r) })),
    byZone: zonas.rows.map((r) => ({ id: r.id, code: r.code, name: r.name, centerName: r.centerName, ...indicadores(r) })),
    customers: clientes.rows[0],
    // null = no lo puede ver (o todavía no existe), no «cero».
    billing: facturacion
      ? { ...facturacion, phase: 2, visible: true }
      : { monthlyInvoiced: null, pendingCollection: null, overdue: null, openDunning: null, phase: 2, visible: false },
    access: { today: null, doors: null, phase: 3 },
  };
}
