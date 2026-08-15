/**
 * Permisos de Mobilink Cash.
 *
 * No se inventa un sistema de usuarios nuevo. Se apoya en el que ya existe:
 * `app_usuario_modulos` guarda, por usuario y módulo, un `rol` y una lista de
 * `pantallas`. Aquí se traduce ese rol a permisos finos, que es lo que permite
 * lo que pedía el encargo: que alguien pueda cobrar facturas de la ERP pero no
 * crear cobros manuales, o que solo un responsable pueda reabrir una jornada.
 *
 * Los permisos se derivan del rol en lugar de guardarse uno a uno porque el
 * resto de módulos de Mobilink funciona así, y una segunda tabla de permisos
 * sería un mecanismo paralelo que mantener.
 */

import type { RequestHandler } from "express";
import pool from "../db.ts";

export const PERMISOS = [
  "cash.view",
  "cash.open_session",
  "cash.close_session",
  "cash.session.reopen",
  "cash.collection.create",
  "cash.collection.create_manual",
  "cash.payment.create",
  "cash.payment.create_manual",
  "cash.movement.create",
  "cash.adjustment.create",
  "cash.operation.reverse",
  "cash.count.create",
  "cash.erp.view",
  "cash.erp.sync",
  "cash.erp.configure",
] as const;

export type Permiso = (typeof PERMISOS)[number];

export type RolCaja = "admin" | "responsable" | "cajero" | "consulta";

/**
 * Qué puede hacer cada rol.
 *
 * · consulta    — mirar y nada más.
 * · cajero      — el día a día del mostrador: cobrar, pagar, arquear.
 * · responsable — además abre y cierra caja, ajusta, anula y reintenta la ERP.
 * · admin       — todo, incluida la configuración de la integración.
 */
const POR_ROL: Record<RolCaja, readonly Permiso[]> = {
  consulta: ["cash.view", "cash.erp.view"],
  cajero: [
    "cash.view",
    "cash.erp.view",
    "cash.collection.create",
    "cash.collection.create_manual",
    "cash.payment.create",
    "cash.movement.create",
    "cash.count.create",
  ],
  responsable: [
    "cash.view",
    "cash.erp.view",
    "cash.erp.sync",
    "cash.open_session",
    "cash.close_session",
    "cash.session.reopen",
    "cash.collection.create",
    "cash.collection.create_manual",
    "cash.payment.create",
    "cash.payment.create_manual",
    "cash.movement.create",
    "cash.adjustment.create",
    "cash.operation.reverse",
    "cash.count.create",
  ],
  admin: PERMISOS,
};

export function permisosDeRol(rol: string | null | undefined): readonly Permiso[] {
  if (!rol) return [];
  return POR_ROL[rol as RolCaja] ?? [];
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { rol: string | null; expiresAt: number }>();

/**
 * Rol del usuario en el módulo `cash`.
 *
 * Un superadmin es admin de caja sin necesidad de fila: es el mismo criterio
 * que aplica `requireModule` con las licencias.
 */
export async function rolDeCaja(userId: string, esSuperadmin: boolean): Promise<string | null> {
  if (esSuperadmin) return "admin";

  const hit = cache.get(userId);
  if (hit && hit.expiresAt > Date.now()) return hit.rol;

  const { rows } = await pool.query<{ rol: string }>(
    `SELECT rol FROM app_usuario_modulos WHERE user_id = $1 AND modulo = 'cash'`,
    [userId]
  );
  const rol = rows[0]?.rol ?? null;
  cache.set(userId, { rol, expiresAt: Date.now() + CACHE_TTL_MS });
  return rol;
}

declare module "express-serve-static-core" {
  interface Request {
    cashRol?: string | null;
    cashPermisos?: readonly Permiso[];
  }
}

/** Carga rol y permisos en la petición. Va después de `authenticate`. */
export const cargarPermisosCaja: RequestHandler = async (req, res, next) => {
  const ctx = req.authCtx;
  if (!ctx) return res.status(401).json({ error: "Sesión requerida" });
  try {
    const rol = await rolDeCaja(ctx.userId, ctx.esSuperadmin);
    req.cashRol = rol;
    req.cashPermisos = permisosDeRol(rol);
    next();
  } catch (e) {
    console.error("[Mobilink Cash] error cargando permisos:", e);
    res.status(500).json({ error: "Error comprobando permisos" });
  }
};

/** Exige un permiso concreto. */
export function exigirPermiso(permiso: Permiso): RequestHandler {
  return (req, res, next) => {
    if (!req.cashPermisos?.includes(permiso)) {
      return res.status(403).json({
        error: "No tienes permiso para hacer esto en Mobilink Cash.",
        code: "PERMISO_DENEGADO",
        permiso,
      });
    }
    next();
  };
}
