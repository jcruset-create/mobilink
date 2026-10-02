/**
 * Clientes de Self Storage: SQL.
 *
 * Sólo se lee y escribe `self_storage_customers` y sus tablas hijas: este
 * módulo no conoce ninguna otra tabla de clientes de Mobilink, y una prueba lo
 * comprueba recorriendo el código.
 */

import { construirSet, type Ejecutor } from "../../shared/db.ts";

const COLUMNAS = `
  c.id, c.customer_type AS "customerType", c.first_name AS "firstName", c.last_name AS "lastName",
  c.company_name AS "companyName", c.tax_id AS "taxId", c.phone, c.email, c.address,
  c.postal_code AS "postalCode", c.city, c.province, c.country, c.status, c.status_reason AS "statusReason",
  c.notes, (c.auth_user_id IS NOT NULL) AS "hasPortalAccount",
  c.created_at AS "createdAt", c.updated_at AS "updatedAt",
  CASE WHEN c.customer_type = 'company' THEN c.company_name
       ELSE btrim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')) END AS "displayName"`;

export type Cliente = {
  id: string;
  customerType: "individual" | "company";
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  taxId: string;
  phone: string;
  email: string;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  country: string;
  status: "active" | "blocked" | "inactive";
  statusReason: string | null;
  notes: string | null;
  hasPortalAccount: boolean;
  displayName: string;
};

const COLUMNA: Record<string, string> = {
  customerType: "customer_type",
  firstName: "first_name",
  lastName: "last_name",
  companyName: "company_name",
  taxId: "tax_id",
  phone: "phone",
  email: "email",
  address: "address",
  postalCode: "postal_code",
  city: "city",
  province: "province",
  country: "country",
  status: "status",
  statusReason: "status_reason",
  notes: "notes",
};

export async function listar(
  db: Ejecutor,
  empresaId: string,
  f: { q?: string; status?: string; limit: number; offset: number }
): Promise<{ total: number; items: (Cliente & { contratosVivos: number })[] }> {
  const cond = ["c.empresa_id = $1"];
  const vals: unknown[] = [empresaId];
  if (f.status) {
    vals.push(f.status);
    cond.push(`c.status = $${vals.length}`);
  }
  if (f.q) {
    vals.push(`%${f.q}%`);
    const p = `$${vals.length}`;
    cond.push(`(c.first_name ILIKE ${p} OR c.last_name ILIKE ${p} OR c.company_name ILIKE ${p}
               OR c.tax_id ILIKE ${p} OR c.email ILIKE ${p} OR c.phone ILIKE ${p})`);
  }
  const where = cond.join(" AND ");
  const total = await db.query(`SELECT count(*)::int AS n FROM self_storage_customers c WHERE ${where}`, vals);
  const { rows } = await db.query(
    `SELECT ${COLUMNAS},
            (SELECT count(*)::int FROM self_storage_contracts k
              WHERE k.customer_id = c.id AND k.status IN ('pending_signature','pending_payment','active','suspended')) AS "contratosVivos"
       FROM self_storage_customers c
      WHERE ${where}
      ORDER BY "displayName"
      LIMIT ${f.limit} OFFSET ${f.offset}`,
    vals
  );
  return { total: total.rows[0].n, items: rows };
}

export async function obtener(db: Ejecutor, empresaId: string, id: string, bloquear = false): Promise<Cliente | null> {
  const { rows } = await db.query(
    `SELECT ${COLUMNAS} FROM self_storage_customers c WHERE c.empresa_id = $1 AND c.id = $2 ${bloquear ? "FOR UPDATE" : ""}`,
    [empresaId, id]
  );
  return rows[0] ?? null;
}

export async function crear(db: Ejecutor, empresaId: string, d: Record<string, unknown>, creadoPor: string | null): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO self_storage_customers
       (empresa_id, customer_type, first_name, last_name, company_name, tax_id, phone, email,
        address, postal_code, city, province, country, notes, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'active',$15) RETURNING id`,
    [
      empresaId, d.customerType, d.firstName ?? null, d.lastName ?? null, d.companyName ?? null, d.taxId, d.phone, d.email,
      d.address ?? null, d.postalCode ?? null, d.city ?? null, d.province ?? null, d.country, d.notes ?? null, creadoPor,
    ]
  );
  return rows[0].id;
}

export async function actualizar(db: Ejecutor, empresaId: string, id: string, cambios: Record<string, unknown>): Promise<void> {
  const set = construirSet(cambios, COLUMNA, 3);
  if (!set.sql) return;
  await db.query(`UPDATE self_storage_customers SET ${set.sql} WHERE empresa_id = $1 AND id = $2`, [empresaId, id, ...set.valores]);
}

export async function telefonos(db: Ejecutor, empresaId: string, customerId: string) {
  const { rows } = await db.query(
    `SELECT id, phone_e164 AS phone, label, allow_door_access AS "allowDoorAccess", verified_at AS "verifiedAt", created_at AS "createdAt"
       FROM self_storage_customer_phones WHERE empresa_id = $1 AND customer_id = $2 ORDER BY created_at`,
    [empresaId, customerId]
  );
  return rows as { id: string; phone: string; label: string | null; allowDoorAccess: boolean }[];
}

export async function crearTelefono(db: Ejecutor, empresaId: string, customerId: string, phone: string, label: string | null, allowDoorAccess: boolean): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO self_storage_customer_phones (empresa_id, customer_id, phone_e164, label, allow_door_access)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [empresaId, customerId, phone, label, allowDoorAccess]
  );
  return rows[0].id;
}

export async function borrarTelefono(db: Ejecutor, empresaId: string, customerId: string, phoneId: string) {
  const { rows } = await db.query(
    `DELETE FROM self_storage_customer_phones WHERE empresa_id = $1 AND customer_id = $2 AND id = $3
     RETURNING phone_e164 AS phone, label, allow_door_access AS "allowDoorAccess"`,
    [empresaId, customerId, phoneId]
  );
  return rows[0] ?? null;
}

/** Contratos del cliente (1 cliente → N contratos, en uno o varios centros). */
export async function contratos(db: Ejecutor, empresaId: string, customerId: string) {
  const { rows } = await db.query(
    `SELECT k.id, k.contract_number AS "contractNumber", k.status, to_char(k.start_date,'YYYY-MM-DD') AS "startDate",
            to_char(k.end_date,'YYYY-MM-DD') AS "endDate", k.monthly_price::float8 AS "monthlyPrice",
            u.id AS "unitId", u.code AS "unitCode", ce.id AS "centerId", ce.name AS "centerName",
            (SELECT count(*)::int FROM self_storage_contract_members m WHERE m.contract_id = k.id AND m.status <> 'revoked') AS "members"
       FROM self_storage_contracts k
       JOIN self_storage_units u ON u.id = k.storage_unit_id
       JOIN self_storage_centers ce ON ce.id = k.center_id
      WHERE k.empresa_id = $1 AND k.customer_id = $2
      ORDER BY k.start_date DESC`,
    [empresaId, customerId]
  );
  return rows;
}
