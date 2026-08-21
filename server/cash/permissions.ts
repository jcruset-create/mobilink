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

/**
 * Lo que el usuario es en Mobilink Cash: su rol y hasta dónde llega.
 *
 * `centroId` es el **ámbito**: el taller al que está limitado. `null` significa
 * toda la empresa, y es lo que tiene todo el mundo hasta que alguien decida lo
 * contrario en Administración. Se eligió así, y no al revés, porque el valor
 * por defecto de una columna nueva lo hereda todo el censo de usuarios: con el
 * criterio contrario, desplegar esta fase habría dejado a la plantilla entera
 * sin poder abrir su caja el lunes por la mañana.
 */
export type AmbitoCaja = { rol: string | null; centroId: string | null };

/**
 * Rol y ámbito del usuario en el módulo `cash`.
 *
 * Un superadmin es admin de caja sin necesidad de fila —el mismo criterio que
 * aplica `requireModule` con las licencias— y sin límite de taller: si tuviera
 * ámbito, no podría supervisar la red, que es justo para lo que está.
 *
 * **Sin caché, y es un cambio deliberado de la fase 10.** Había una de 60
 * segundos, lo que significaba que retirarle el permiso a alguien tardaba hasta
 * un minuto en surtir efecto (riesgo R10). No se puede arreglar invalidándola:
 * los roles se escriben desde el navegador contra Supabase, así que el servidor
 * no se entera, y aunque hubiera un endpoint para vaciarla solo alcanzaría a la
 * instancia que atendiera esa llamada —en Render hay varias—.
 *
 * Lo que cuesta quitarla es una lectura por clave indexada en cada petición.
 * Lo que compra es que retirar un permiso surta efecto en la siguiente, que
 * para el permiso de mover dinero es la respuesta correcta.
 */
export async function rolDeCaja(userId: string, esSuperadmin: boolean): Promise<AmbitoCaja> {
  if (esSuperadmin) return { rol: "admin", centroId: null };

  const { rows } = await pool.query<{ rol: string; centro_id: string | null }>(
    `SELECT rol, centro_id FROM app_usuario_modulos WHERE user_id = $1 AND modulo = 'cash'`,
    [userId]
  );
  return {
    rol: rows[0]?.rol ?? null,
    centroId: rows[0]?.centro_id ?? null,
  };
}

declare module "express-serve-static-core" {
  interface Request {
    cashRol?: string | null;
    cashPermisos?: readonly Permiso[];
    /** Taller al que está limitado el usuario. `null` = toda la empresa. */
    cashCentroId?: string | null;
  }
}

/** Carga rol y permisos en la petición. Va después de `authenticate`. */
export const cargarPermisosCaja: RequestHandler = async (req, res, next) => {
  const ctx = req.authCtx;
  if (!ctx) return res.status(401).json({ error: "Sesión requerida" });
  try {
    const { rol, centroId } = await rolDeCaja(ctx.userId, ctx.esSuperadmin);
    req.cashRol = rol;
    req.cashCentroId = centroId;
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
