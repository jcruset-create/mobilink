/**
 * Centros y zonas: SQL. Toda consulta lleva `empresa_id` en el WHERE: el id
 * nunca viaja solo (ARCHITECTURE.md §3).
 */

import { construirSet, type Ejecutor } from "../../shared/db.ts";

const COLUMNAS_CENTRO = `
  c.id, c.code, c.name, c.address, c.postal_code AS "postalCode", c.city, c.province, c.country,
  c.timezone, c.phone, c.email, c.public_visible AS "publicVisible", c.status,
  c.created_at AS "createdAt", c.updated_at AS "updatedAt"`;

const COLUMNAS_ZONA = `
  z.id, z.center_id AS "centerId", z.code, z.name, z.floor, z.sort_order AS "sortOrder", z.status,
  z.created_at AS "createdAt", z.updated_at AS "updatedAt"`;

export type Centro = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  country: string;
  timezone: string;
  phone: string | null;
  email: string | null;
  publicVisible: boolean;
  status: "active" | "inactive";
};

export type Zona = {
  id: string;
  centerId: string;
  code: string;
  name: string;
  floor: string | null;
  sortOrder: number;
  status: "active" | "inactive";
};

/** camelCase de la API → columna. Sólo los campos editables. */
const COLUMNA_CENTRO: Record<string, string> = {
  name: "name",
  address: "address",
  postalCode: "postal_code",
  city: "city",
  province: "province",
  country: "country",
  timezone: "timezone",
  phone: "phone",
  email: "email",
  publicVisible: "public_visible",
  status: "status",
};

const COLUMNA_ZONA: Record<string, string> = { name: "name", floor: "floor", sortOrder: "sort_order", status: "status" };

export async function listarCentros(db: Ejecutor, empresaId: string): Promise<(Centro & { zonas: number; trasteros: number })[]> {
  const { rows } = await db.query(
    `SELECT ${COLUMNAS_CENTRO},
            (SELECT count(*)::int FROM self_storage_zones z WHERE z.center_id = c.id) AS zonas,
            (SELECT count(*)::int FROM self_storage_units u WHERE u.center_id = c.id) AS trasteros
       FROM self_storage_centers c
      WHERE c.empresa_id = $1
      ORDER BY c.status, c.name`,
    [empresaId]
  );
  return rows;
}

export async function obtenerCentro(db: Ejecutor, empresaId: string, id: string, bloquear = false): Promise<Centro | null> {
  const { rows } = await db.query(
    `SELECT ${COLUMNAS_CENTRO} FROM self_storage_centers c WHERE c.empresa_id = $1 AND c.id = $2 ${bloquear ? "FOR UPDATE" : ""}`,
    [empresaId, id]
  );
  return rows[0] ?? null;
}

export async function crearCentro(db: Ejecutor, empresaId: string, d: Record<string, unknown>): Promise<Centro> {
  const { rows } = await db.query(
    `INSERT INTO self_storage_centers
       (empresa_id, code, name, address, postal_code, city, province, country, timezone, phone, email, public_visible)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id`,
    [empresaId, d.code, d.name, d.address ?? null, d.postalCode ?? null, d.city ?? null, d.province ?? null, d.country, d.timezone, d.phone ?? null, d.email ?? null, d.publicVisible]
  );
  return (await obtenerCentro(db, empresaId, rows[0].id))!;
}

export async function actualizarCentro(db: Ejecutor, empresaId: string, id: string, cambios: Record<string, unknown>): Promise<void> {
  const set = construirSet(cambios, COLUMNA_CENTRO, 3);
  if (!set.sql) return;
  await db.query(`UPDATE self_storage_centers SET ${set.sql} WHERE empresa_id = $1 AND id = $2`, [empresaId, id, ...set.valores]);
}

export async function listarZonas(db: Ejecutor, empresaId: string, centerId: string): Promise<(Zona & { trasteros: number })[]> {
  const { rows } = await db.query(
    `SELECT ${COLUMNAS_ZONA},
            (SELECT count(*)::int FROM self_storage_units u WHERE u.zone_id = z.id) AS trasteros
       FROM self_storage_zones z
      WHERE z.empresa_id = $1 AND z.center_id = $2
      ORDER BY z.sort_order, z.code`,
    [empresaId, centerId]
  );
  return rows;
}

export async function obtenerZona(db: Ejecutor, empresaId: string, id: string): Promise<Zona | null> {
  const { rows } = await db.query(`SELECT ${COLUMNAS_ZONA} FROM self_storage_zones z WHERE z.empresa_id = $1 AND z.id = $2`, [empresaId, id]);
  return rows[0] ?? null;
}

export async function crearZona(db: Ejecutor, empresaId: string, centerId: string, d: Record<string, unknown>): Promise<Zona> {
  const { rows } = await db.query(
    `INSERT INTO self_storage_zones (empresa_id, center_id, code, name, floor, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [empresaId, centerId, d.code, d.name, d.floor ?? null, d.sortOrder]
  );
  return (await obtenerZona(db, empresaId, rows[0].id))!;
}

export async function actualizarZona(db: Ejecutor, empresaId: string, id: string, cambios: Record<string, unknown>): Promise<void> {
  const set = construirSet(cambios, COLUMNA_ZONA, 3);
  if (!set.sql) return;
  await db.query(`UPDATE self_storage_zones SET ${set.sql} WHERE empresa_id = $1 AND id = $2`, [empresaId, id, ...set.valores]);
}
