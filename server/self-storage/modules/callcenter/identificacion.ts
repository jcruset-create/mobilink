/**
 * ¿Quién llama? Se normaliza el teléfono y se busca en los teléfonos de los
 * clientes (principal y adicionales) y en las personas autorizadas de los
 * contratos. Un número puede ser de varios (un teléfono de empresa): se
 * devuelven todos y el operador elige.
 *
 * FICHA MÍNIMA (mínimo privilegio): nombre, estado, contratos con su trastero
 * y centro, si tiene el acceso bloqueado y si tiene algo pendiente de pago
 * (sí/no). Nada de importes, documentos, NIF, dirección ni motivo detallado de
 * un bloqueo. Si no hay coincidencia, es un INTERESADO: no se crea cliente.
 */

import { pool } from "../../shared/db.ts";
import { auditar, type Actor } from "../../shared/audit.ts";
import { normalizarTelefono } from "../../domain/identidad.ts";
import { enmascararTelefono } from "../../domain/callcenter.ts";
import type { ContractStatus, CustomerStatus } from "../../../../src/modules/self-storage/types/enums.ts";

export type FichaMinima = {
  customerId: string;
  name: string;
  status: CustomerStatus;
  /** Cómo coincide: su teléfono o el de una persona autorizada de un contrato suyo. */
  match: "customer" | "authorized_person";
  matchedPersonName: string | null;
  accessBlocked: boolean;
  hasPendingPayments: boolean;
  openIncidents: number;
  contracts: { id: string; contractNumber: string; status: ContractStatus; unitCode: string; zoneName: string | null; centerId: string; centerName: string; startDate: string }[];
};

export type Identificacion = {
  phone: string | null;
  /** true si no coincide con ningún cliente: es un interesado. */
  interested: boolean;
  matches: FichaMinima[];
  /** Llamadas anteriores de este número (las últimas). */
  previousCalls: { id: string; startedAt: string; reasonCode: string | null; resultCode: string | null; status: string; summary: string | null }[];
};

/** Teléfono normalizado o null si no se puede (número oculto, extranjero mal escrito…). */
export function telefonoONulo(tel: string | null | undefined): string | null {
  if (!tel || !String(tel).trim()) return null;
  try {
    return normalizarTelefono(tel);
  } catch {
    return null;
  }
}

export async function clientesPorTelefono(empresaId: string, e164: string): Promise<{ customerId: string; match: "customer" | "authorized_person"; personName: string | null }[]> {
  const { rows } = await pool.query(
    `SELECT id AS "customerId", 'customer' AS match, NULL::text AS "personName"
       FROM self_storage_customers WHERE empresa_id = $1 AND phone = $2
     UNION
     SELECT p.customer_id, 'customer', NULL FROM self_storage_customer_phones p WHERE p.empresa_id = $1 AND p.phone_e164 = $2
     UNION
     SELECT k.customer_id, 'authorized_person', m.full_name
       FROM self_storage_contract_members m JOIN self_storage_contracts k ON k.id = m.contract_id
      WHERE m.empresa_id = $1 AND m.phone_e164 = $2 AND m.status <> 'revoked'`,
    [empresaId, e164]
  );
  // Si es a la vez cliente y persona autorizada, gana «cliente».
  const porCliente = new Map<string, { customerId: string; match: "customer" | "authorized_person"; personName: string | null }>();
  for (const r of rows) {
    const ya = porCliente.get(r.customerId);
    if (!ya || (ya.match === "authorized_person" && r.match === "customer")) porCliente.set(r.customerId, r);
  }
  return [...porCliente.values()];
}

export async function fichaMinima(empresaId: string, customerId: string): Promise<Omit<FichaMinima, "match" | "matchedPersonName"> | null> {
  const { rows } = await pool.query(
    `SELECT c.id, c.status,
            CASE WHEN c.customer_type = 'company' THEN c.company_name ELSE btrim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')) END AS name,
            EXISTS (SELECT 1 FROM self_storage_access_blocks b WHERE b.customer_id = c.id AND b.lifted_at IS NULL) AS blocked,
            EXISTS (SELECT 1 FROM self_storage_invoices i WHERE i.customer_id = c.id AND i.status IN ('pending','overdue')) AS pending,
            (SELECT count(*)::int FROM self_storage_incidents n WHERE n.customer_id = c.id AND n.status IN ('open','in_progress')) AS incidents
       FROM self_storage_customers c WHERE c.empresa_id = $1 AND c.id = $2`,
    [empresaId, customerId]
  );
  if (!rows.length) return null;
  const { rows: ks } = await pool.query(
    `SELECT k.id, k.contract_number AS "contractNumber", k.status, u.code AS "unitCode", z.name AS "zoneName",
            ce.id AS "centerId", ce.name AS "centerName", k.start_date::text AS "startDate"
       FROM self_storage_contracts k
       JOIN self_storage_units u ON u.id = k.storage_unit_id
       JOIN self_storage_centers ce ON ce.id = k.center_id
       LEFT JOIN self_storage_zones z ON z.id = u.zone_id
      WHERE k.empresa_id = $1 AND k.customer_id = $2 AND k.status NOT IN ('draft','cancelled')
      ORDER BY k.start_date DESC LIMIT 20`,
    [empresaId, customerId]
  );
  const r = rows[0];
  return { customerId: r.id, name: r.name, status: r.status, accessBlocked: r.blocked, hasPendingPayments: r.pending, openIncidents: r.incidents, contracts: ks };
}

/**
 * Identificación completa para la pantalla de la llamada. Queda en la
 * auditoría quién consultó qué número (enmascarado) y qué fichas vio.
 */
export async function identificar(actor: Actor, telefono: string | null | undefined): Promise<Identificacion> {
  const phone = telefonoONulo(telefono);
  if (!phone) return { phone: null, interested: true, matches: [], previousCalls: [] };
  const encontrados = await clientesPorTelefono(actor.empresaId, phone);
  const matches: FichaMinima[] = [];
  for (const e of encontrados) {
    const f = await fichaMinima(actor.empresaId, e.customerId);
    if (f) matches.push({ ...f, match: e.match, matchedPersonName: e.personName });
  }
  const { rows: previas } = await pool.query(
    `SELECT id, started_at AS "startedAt", reason_code AS "reasonCode", result_code AS "resultCode", status, summary
       FROM self_storage_calls WHERE empresa_id = $1 AND phone_e164 = $2 ORDER BY started_at DESC LIMIT 10`,
    [actor.empresaId, phone]
  );
  await auditar(pool, actor, {
    action: "call_center.customer_lookup",
    entityType: "customer",
    entityId: matches.length === 1 ? matches[0].customerId : null,
    after: { phone: enmascararTelefono(phone), customers: matches.map((m) => m.customerId) },
  });
  return { phone, interested: matches.length === 0, matches, previousCalls: previas };
}
