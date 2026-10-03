/**
 * Guarda del PORTAL DEL CLIENTE (`/api/self-storage/portal/*`).
 *
 * Un cliente de trasteros entra con su sesión de Supabase Auth, pero NO es un
 * usuario interno: no está en `app_usuarios` ni tiene rol en
 * `app_usuario_modulos`. Lo que le da acceso es estar vinculado a una ficha de
 * `self_storage_customers` (auth_user_id). Esta guarda no da ningún permiso
 * del panel, y la del panel no deja pasar a nadie del portal.
 *
 * El `customer_id` sale SIEMPRE de aquí, nunca del cuerpo ni de la URL: un
 * cliente no puede pedir lo de otro ni cambiando un id.
 */

import type { RequestHandler } from "express";
import { pool } from "../shared/db.ts";
import type { Actor } from "../shared/audit.ts";

export type ClientePortal = { customerId: string; empresaId: string; authUserId: string; nombre: string; email: string; status: string };

/** Persona autorizada de un contrato con cuenta propia (fase 3): sólo abre puertas, sin nada financiero. */
export type MiembroPortal = { memberId: string; contractId: string; customerId: string; empresaId: string; authUserId: string; nombre: string; email: string | null };

declare module "express-serve-static-core" {
  interface Request {
    ssCliente?: ClientePortal;
    ssMiembro?: MiembroPortal;
  }
}

const cache = new Map<string, { authUserId: string; caduca: number }>();

async function usuarioDelToken(token: string): Promise<string | null> {
  const hit = cache.get(token);
  if (hit && hit.caduca > Date.now()) return hit.authUserId;
  const { supabase } = await import("../../supabase.ts");
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  cache.set(token, { authUserId: data.user.id, caduca: Date.now() + 60_000 });
  return data.user.id;
}

export const autenticarCliente: RequestHandler = async (req, res, next) => {
  try {
    const auth = String(req.headers.authorization || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Falta la sesión", code: "SIN_SESION" });
    const uid = await usuarioDelToken(token);
    if (!uid) return res.status(401).json({ error: "Sesión no válida", code: "SESION_NO_VALIDA" });
    const { rows } = await pool.query(
      `SELECT id, empresa_id, email, status,
              CASE WHEN customer_type = 'company' THEN company_name ELSE btrim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')) END AS nombre
         FROM self_storage_customers WHERE auth_user_id = $1`,
      [uid]
    );
    if (rows.length) {
      req.ssCliente = { customerId: rows[0].id, empresaId: rows[0].empresa_id, authUserId: uid, nombre: rows[0].nombre, email: rows[0].email, status: rows[0].status };
      return next();
    }
    // ¿Persona autorizada con cuenta propia? Sólo podrá usar lo de accesos.
    const { rows: m } = await pool.query(
      `SELECT m.id, m.contract_id, m.empresa_id, m.full_name, m.email, k.customer_id
         FROM self_storage_contract_members m JOIN self_storage_contracts k ON k.id = m.contract_id
        WHERE m.auth_user_id = $1`,
      [uid]
    );
    if (m.length) {
      req.ssMiembro = { memberId: m[0].id, contractId: m[0].contract_id, customerId: m[0].customer_id, empresaId: m[0].empresa_id, authUserId: uid, nombre: m[0].full_name, email: m[0].email };
      return next();
    }
    return res.status(403).json({ error: "Esta cuenta no tiene acceso al portal de trasteros.", code: "SIN_ACCESO" });
  } catch (e) {
    console.error("[Self Storage] portal: error de autenticación:", e);
    res.status(500).json({ error: "Error de autenticación" });
  }
};

/** Lo financiero y los contratos son sólo del TITULAR, no de sus personas autorizadas. */
export const soloTitular: RequestHandler = (req, res, next) => {
  if (!req.ssCliente) return res.status(403).json({ error: "Esta sección es sólo para el titular del contrato.", code: "SOLO_TITULAR" });
  next();
};

export function actorCliente(c: ClientePortal, ip: string | null): Actor {
  return { empresaId: c.empresaId, userId: c.authUserId, nombre: c.nombre, ip, tipo: "customer" };
}
