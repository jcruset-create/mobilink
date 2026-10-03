/**
 * Tipos de trastero y trasteros: SQL. Siempre con `empresa_id` en el WHERE.
 */

import { LIVE_CONTRACT_STATUSES } from "../../../../src/modules/self-storage/types/enums.ts";
import type { FilaTrastero, Ocupacion } from "../../domain/vistas.ts";
import { construirSet, type Ejecutor } from "../../shared/db.ts";

// ── Tipos ────────────────────────────────────────────────────────────────────

const COLUMNAS_TIPO = `
  t.id, t.center_id AS "centerId", t.code, t.name, t.width_cm AS "widthCm", t.length_cm AS "lengthCm",
  t.height_cm AS "heightCm", t.nominal_area_m2::float8 AS "nominalAreaM2",
  t.nominal_volume_m3::float8 AS "nominalVolumeM3", t.image_3d_url AS "image3dUrl",
  t.capacity_description AS "capacityDescription", t.capacity_examples AS "capacityExamples",
  t.sort_order AS "sortOrder", t.active,
  (SELECT count(*)::int FROM self_storage_units u WHERE u.unit_type_id = t.id) AS trasteros`;

const COLUMNA_TIPO: Record<string, string> = {
  name: "name",
  widthCm: "width_cm",
  lengthCm: "length_cm",
  heightCm: "height_cm",
  nominalAreaM2: "nominal_area_m2",
  nominalVolumeM3: "nominal_volume_m3",
  image3dUrl: "image_3d_url",
  capacityDescription: "capacity_description",
  capacityExamples: "capacity_examples",
  sortOrder: "sort_order",
  active: "active",
};

export type Tipo = {
  id: string;
  centerId: string | null;
  code: string;
  name: string;
  widthCm: number;
  lengthCm: number;
  heightCm: number;
  nominalAreaM2: number;
  nominalVolumeM3: number;
  image3dUrl: string | null;
  capacityDescription: string | null;
  capacityExamples: string[];
  sortOrder: number;
  active: boolean;
  trasteros: number;
};

/** Tipos comunes de la empresa más, si se pide, los de un centro. */
export async function listarTipos(db: Ejecutor, empresaId: string, centerId: string | null): Promise<Tipo[]> {
  const { rows } = await db.query(
    `SELECT ${COLUMNAS_TIPO} FROM self_storage_unit_types t
      WHERE t.empresa_id = $1 AND (t.center_id IS NULL OR $2::uuid IS NULL OR t.center_id = $2::uuid)
      ORDER BY t.sort_order, t.nominal_area_m2, t.code`,
    [empresaId, centerId]
  );
  return rows;
}

export async function obtenerTipo(db: Ejecutor, empresaId: string, id: string): Promise<Tipo | null> {
  const { rows } = await db.query(`SELECT ${COLUMNAS_TIPO} FROM self_storage_unit_types t WHERE t.empresa_id = $1 AND t.id = $2`, [empresaId, id]);
  return rows[0] ?? null;
}

export async function crearTipo(db: Ejecutor, empresaId: string, d: Record<string, unknown>): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO self_storage_unit_types
       (empresa_id, center_id, code, name, width_cm, length_cm, height_cm, nominal_area_m2, nominal_volume_m3,
        image_3d_url, capacity_description, capacity_examples, sort_order, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [
      empresaId, d.centerId ?? null, d.code, d.name, d.widthCm, d.lengthCm, d.heightCm, d.nominalAreaM2, d.nominalVolumeM3,
      d.image3dUrl ?? null, d.capacityDescription ?? null, d.capacityExamples ?? [], d.sortOrder ?? 0, d.active ?? true,
    ]
  );
  return rows[0].id;
}

export async function actualizarTipo(db: Ejecutor, empresaId: string, id: string, cambios: Record<string, unknown>): Promise<void> {
  const set = construirSet(cambios, COLUMNA_TIPO, 3);
  if (!set.sql) return;
  await db.query(`UPDATE self_storage_unit_types SET ${set.sql} WHERE empresa_id = $1 AND id = $2`, [empresaId, id, ...set.valores]);
}

// ── Trasteros ────────────────────────────────────────────────────────────────

const SELECT_TRASTERO = `
  SELECT u.id, u.center_id, u.zone_id, z.code AS zone_code, z.name AS zone_name,
         u.unit_type_id, t.code AS type_code, t.name AS type_name, t.image_3d_url AS type_image_3d_url,
         t.capacity_description AS type_capacity_description, t.capacity_examples AS type_capacity_examples,
         u.code, u.name, u.width_cm, u.length_cm, u.height_cm, u.area_m2, u.volume_m3,
         u.monthly_price, u.tax_rate, u.monthly_price_gross, u.deposit_amount,
         u.status, u.status_reason, u.image_3d_url, u.floor_plan_shape_id, u.public_visible, u.notes
    FROM self_storage_units u
    JOIN self_storage_zones z ON z.id = u.zone_id
    LEFT JOIN self_storage_unit_types t ON t.id = u.unit_type_id`;

function aFila(r: Record<string, unknown>): FilaTrastero {
  return {
    ...(r as unknown as FilaTrastero),
    area_m2: Number(r.area_m2),
    volume_m3: Number(r.volume_m3),
    monthly_price: Number(r.monthly_price),
    tax_rate: Number(r.tax_rate),
    monthly_price_gross: Number(r.monthly_price_gross),
    deposit_amount: Number(r.deposit_amount),
  };
}

export type FiltroTrasteros = { centerId?: string; zoneId?: string; unitTypeId?: string; status?: string; q?: string };

export async function listarTrasteros(db: Ejecutor, empresaId: string, f: FiltroTrasteros): Promise<FilaTrastero[]> {
  const cond = ["u.empresa_id = $1"];
  const vals: unknown[] = [empresaId];
  const add = (sql: string, v: unknown) => {
    vals.push(v);
    cond.push(sql.replaceAll("?", `$${vals.length}`));
  };
  if (f.centerId) add("u.center_id = ?", f.centerId);
  if (f.zoneId) add("u.zone_id = ?", f.zoneId);
  if (f.unitTypeId) add("u.unit_type_id = ?", f.unitTypeId);
  if (f.status) add("u.status = ?", f.status);
  if (f.q) add("(u.code ILIKE ? OR coalesce(u.name, '') ILIKE ?)", `%${f.q}%`);
  const { rows } = await db.query(
    `${SELECT_TRASTERO} WHERE ${cond.join(" AND ")}
      ORDER BY z.sort_order, z.code, length(u.code), u.code`,
    vals
  );
  return rows.map(aFila);
}

export async function obtenerTrastero(db: Ejecutor, empresaId: string, id: string, bloquear = false): Promise<FilaTrastero | null> {
  const { rows } = await db.query(
    `${SELECT_TRASTERO} WHERE u.empresa_id = $1 AND u.id = $2 ${bloquear ? "FOR UPDATE OF u" : ""}`,
    [empresaId, id]
  );
  return rows[0] ? aFila(rows[0]) : null;
}

/** Contrato vivo y cliente de cada trastero (uno como mucho, lo garantiza la base). */
export async function ocupaciones(db: Ejecutor, empresaId: string, unitIds: string[]): Promise<Map<string, Ocupacion>> {
  if (!unitIds.length) return new Map();
  const { rows } = await db.query(
    `SELECT c.storage_unit_id, c.id AS contract_id, c.contract_number, c.status AS contract_status,
            to_char(c.start_date, 'YYYY-MM-DD') AS start_date, to_char(c.end_date, 'YYYY-MM-DD') AS end_date,
            cu.id AS customer_id, cu.customer_type, cu.first_name, cu.last_name, cu.company_name,
            c.monthly_price::float8 AS contract_monthly_price, c.monthly_price_gross::float8 AS contract_monthly_price_gross,
            CASE WHEN EXISTS (SELECT 1 FROM self_storage_dunning_cases d WHERE d.contract_id = c.id AND d.status = 'open') THEN 'overdue'
                 WHEN EXISTS (SELECT 1 FROM self_storage_invoices i WHERE i.contract_id = c.id AND i.status IN ('pending','overdue')) THEN 'pending'
                 ELSE 'up_to_date' END AS payment_status
       FROM self_storage_contracts c
       JOIN self_storage_customers cu ON cu.id = c.customer_id AND cu.empresa_id = c.empresa_id
      WHERE c.empresa_id = $1 AND c.storage_unit_id = ANY($2::uuid[]) AND c.status = ANY($3::self_storage_contract_status[])`,
    [empresaId, unitIds, LIVE_CONTRACT_STATUSES]
  );
  return new Map(rows.map((r) => [r.storage_unit_id as string, r as Ocupacion]));
}

/** ¿Tiene contrato vivo o reserva activa SIN caducar? (con el trastero ya bloqueado) */
export async function compromisos(db: Ejecutor, unitId: string): Promise<{ contratoVivo: boolean; reservaActiva: boolean }> {
  const { rows } = await db.query(
    `SELECT
       EXISTS (SELECT 1 FROM self_storage_contracts WHERE storage_unit_id = $1 AND status = ANY($2::self_storage_contract_status[])) AS contrato,
       EXISTS (SELECT 1 FROM self_storage_reservations WHERE storage_unit_id = $1 AND status = 'active' AND expires_at > now()) AS reserva`,
    [unitId, LIVE_CONTRACT_STATUSES]
  );
  return { contratoVivo: rows[0].contrato, reservaActiva: rows[0].reserva };
}

export type ValoresTrastero = {
  zone_id: string;
  unit_type_id: string | null;
  code: string;
  name: string | null;
  width_cm: number;
  length_cm: number;
  height_cm: number;
  area_m2: number;
  volume_m3: number;
  monthly_price: number;
  tax_rate: number;
  monthly_price_gross: number;
  deposit_amount: number;
  image_3d_url: string | null;
  floor_plan_shape_id: string | null;
  public_visible: boolean;
  notes: string | null;
};

const COLUMNAS_ESCRIBIBLES = [
  "zone_id", "unit_type_id", "code", "name", "width_cm", "length_cm", "height_cm", "area_m2", "volume_m3",
  "monthly_price", "tax_rate", "monthly_price_gross", "deposit_amount", "image_3d_url", "floor_plan_shape_id",
  "public_visible", "notes",
] as const;

export async function crearTrastero(db: Ejecutor, empresaId: string, centerId: string, v: ValoresTrastero): Promise<string> {
  const cols = ["empresa_id", "center_id", ...COLUMNAS_ESCRIBIBLES];
  const vals = [empresaId, centerId, ...COLUMNAS_ESCRIBIBLES.map((k) => v[k])];
  const { rows } = await db.query(
    `INSERT INTO self_storage_units (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
    vals
  );
  return rows[0].id;
}

export async function actualizarTrastero(db: Ejecutor, empresaId: string, id: string, v: Partial<ValoresTrastero>): Promise<void> {
  const mapa = Object.fromEntries(COLUMNAS_ESCRIBIBLES.map((k) => [k, k]));
  const set = construirSet(v as Record<string, unknown>, mapa, 3);
  if (!set.sql) return;
  await db.query(`UPDATE self_storage_units SET ${set.sql} WHERE empresa_id = $1 AND id = $2`, [empresaId, id, ...set.valores]);
}

export async function fijarEstado(db: Ejecutor, empresaId: string, id: string, estado: string, motivo: string | null): Promise<void> {
  await db.query(
    `UPDATE self_storage_units SET status = $3, status_reason = $4 WHERE empresa_id = $1 AND id = $2`,
    [empresaId, id, estado, motivo]
  );
}

