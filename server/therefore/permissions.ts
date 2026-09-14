/**
 * Permisos del módulo Therefore.
 *
 * No se estrena un sistema de usuarios: se apoya en `app_usuario_modulos`, que
 * ya guarda por usuario y módulo un `rol`, y aquí ese rol se traduce a permisos
 * finos. Es la misma forma que `server/tacografos/permissions.ts` y
 * `server/cash/permissions.ts`; una segunda tabla de permisos sería un
 * mecanismo paralelo que mantener y que acabaría diciendo cosas distintas.
 *
 * Sin caché, por el mismo motivo que en caja: quitarle a alguien el permiso de
 * resolver expedientes tiene que surtir efecto en la siguiente petición, no en
 * la de dentro de un minuto. Cuesta una lectura por clave indexada.
 */

import type { RequestHandler } from "express";
import pool from "../db.ts";

export const PERMISOS = [
  /** Ver la bandeja y los expedientes. */
  "therefore.view",
  /** Asignar, anotar observaciones, fijar la prioridad a mano. */
  "therefore.expediente.edit",
  /** Crear un expediente a mano (una incidencia que llega por teléfono). */
  "therefore.expediente.create",
  /** Iniciar, resolver, bloquear y descartar actuaciones. */
  "therefore.actuacion.manage",
  /**
   * Reabrir algo ya resuelto o cerrado.
   *
   * Va aparte de resolver: reabrir contradice a quien dio el trabajo por
   * terminado, y eso es una decisión de quien lleva la cola, no del día a día.
   */
  "therefore.expediente.reopen",
  /**
   * Resolver las dudas del sistema: duplicados, cambios de instrucción,
   * reclamaciones sobre lo ya resuelto.
   *
   * Es trabajo diario y no de administración: quien lleva la cola es quien
   * sabe si dos correos hablan del mismo albarán. Reservarlo al admin
   * garantizaría que la cola de revisión no se vaciara nunca.
   */
  "therefore.decision.resolve",
  /**
   * Meter un correo en el sistema por la API.
   *
   * Va aparte y sólo para admin: no es una acción del día a día, es la boca de
   * entrada del módulo. Quien pueda llamarla puede crear expedientes con los
   * datos que quiera, sin el correo que los respalde.
   */
  "therefore.correo.importar",
  /** Pesos de la prioridad y demás ajustes del módulo. */
  "therefore.config.edit",
] as const;

export type Permiso = (typeof PERMISOS)[number];

export type RolTherefore = "consulta" | "gestor" | "admin";

/**
 * Qué puede hacer cada rol.
 *
 * · consulta — mirar. Sirve para quien necesita saber si un albarán está
 *              gestionado sin ser quien lo gestiona.
 * · gestor   — el trabajo diario: coger expedientes, resolver actuaciones y
 *              reabrir lo que haga falta.
 * · admin    — además, la configuración del módulo.
 */
const POR_ROL: Record<RolTherefore, readonly Permiso[]> = {
  consulta: ["therefore.view"],
  gestor: [
    "therefore.view",
    "therefore.expediente.edit",
    "therefore.expediente.create",
    "therefore.actuacion.manage",
    "therefore.expediente.reopen",
    "therefore.decision.resolve",
  ],
  admin: PERMISOS,
};

export function permisosDeRol(rol: string | null | undefined): readonly Permiso[] {
  if (!rol) return [];
  return POR_ROL[rol as RolTherefore] ?? [];
}

/**
 * Rol del usuario en el módulo. Un superadmin es admin sin necesidad de fila,
 * el mismo criterio que aplica `requireModule` con las licencias.
 */
export async function rolDeTherefore(
  userId: string,
  esSuperadmin: boolean
): Promise<string | null> {
  if (esSuperadmin) return "admin";
  const { rows } = await pool.query<{ rol: string }>(
    `SELECT rol FROM app_usuario_modulos WHERE user_id = $1 AND modulo = 'therefore'`,
    [userId]
  );
  return rows[0]?.rol ?? null;
}

declare module "express-serve-static-core" {
  interface Request {
    thereforeRol?: string | null;
    thereforePermisos?: readonly Permiso[];
  }
}

/** Carga rol y permisos en la petición. Va después de `authenticate`. */
export const cargarPermisos: RequestHandler = async (req, res, next) => {
  const ctx = req.authCtx;
  if (!ctx) return res.status(401).json({ error: "Sesión requerida" });
  try {
    const rol = await rolDeTherefore(ctx.userId, ctx.esSuperadmin);
    req.thereforeRol = rol;
    req.thereforePermisos = permisosDeRol(rol);
    next();
  } catch (e) {
    console.error("[Therefore] error cargando permisos:", e);
    res.status(500).json({ error: "Error comprobando permisos" });
  }
};

/** Exige un permiso concreto. */
export function exigirPermiso(permiso: Permiso): RequestHandler {
  return (req, res, next) => {
    if (!req.thereforePermisos?.includes(permiso)) {
      return res.status(403).json({
        error: "No tienes permiso para hacer esto en Therefore.",
        code: "PERMISO_DENEGADO",
        permiso,
      });
    }
    next();
  };
}
