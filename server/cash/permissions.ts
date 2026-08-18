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
  /**
   * Alta y baja de las cajas físicas de la empresa.
   *
   * Va separado de `cash.erp.configure` a propósito: dar de alta una caja en
   * Reus y conectar la ERP de la empresa son decisiones de calado distinto, y
   * quien puede hacer la primera no tiene por qué poder hacer la segunda.
   */
  "cash.configure",
  /**
   * Catálogo de denominaciones y cartuchos.
   *
   * Permiso propio y solo de admin porque `cash_denominations` NO tiene
   * empresa: es el catálogo de toda la instalación. Si un responsable de una
   * empresa pudiera desactivar la moneda de 1 c, se la estaría desactivando
   * también a las demás. Con el euro esto rara vez se toca, pero el permiso
   * tiene que reflejar el alcance real de la tabla.
   */
  "cash.denominations.configure",
  /**
   * Tesorería: pedir cambio al banco y entregar dinero a una persona.
   *
   * Un solo permiso para las cuatro acciones (pedir, recibir, entregar,
   * liquidar) porque son la misma responsabilidad vista dos veces: sacar
   * dinero de la caja que vuelve más tarde. Partirlo dejaría que alguien
   * pudiera sacar los 200 € y no pudiera cerrar el pedido cuando vuelve del
   * banco, que es como se quedan los pendientes abiertos para siempre.
   */
  "cash.treasury.manage",
  /** Colgar el PDF del escáner de un cobro o un pago. */
  "cash.document.attach",
  /**
   * Retirar un justificante. Va aparte de adjuntar y es de responsable: quitar
   * la factura que respalda una salida de caja es justo lo que no debe poder
   * hacer quien la registró sin que quede rastro.
   */
  "cash.document.void",
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
    "cash.document.attach",
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
    // Puede dar de alta una caja de su empresa, pero no tocar el catálogo de
    // denominaciones, que es de toda la instalación.
    "cash.configure",
    "cash.treasury.manage",
    "cash.document.attach",
    "cash.document.void",
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
