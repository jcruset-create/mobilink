/**
 * Permisos de MC Central.
 *
 * Mismo mecanismo que Mobilink Cash: el rol sale de `app_usuario_modulos`, esta
 * vez con módulo `central`. No hay tabla de permisos nueva ni un segundo
 * sistema que mantener.
 *
 * Son deliberadamente pocos. Central, de momento, **solo mira**: no mueve
 * dinero, no cierra jornadas ajenas y no corrige nada. Lo único que escribe es
 * la organización de la red —qué taller está en qué zona—, y eso ya es de por
 * sí un permiso aparte.
 */

import type { RequestHandler } from "express";
import pool from "../db.ts";

export const PERMISOS = [
  "central.view",
  "central.zones.configure",
  /** Crear y cambiar reglas: decide a quién avisa el sistema y con qué umbral. */
  "central.rules.configure",
  /** Reconocer y resolver incidencias. */
  "central.incidents.manage",
] as const;
export type Permiso = (typeof PERMISOS)[number];

const POR_ROL: Record<string, readonly Permiso[]> = {
  consulta: ["central.view"],
  // El supervisor atiende la bandeja pero no cambia los umbrales: quien vigila
  // no debería poder subir el listón hasta que su red deje de dar avisos.
  supervisor: ["central.view", "central.incidents.manage"],
  admin: PERMISOS,
};

export function permisosDeRol(rol: string | null | undefined): readonly Permiso[] {
  if (!rol) return [];
  return POR_ROL[rol] ?? [];
}

export type AmbitoCentral = { rol: string | null; centroId: string | null };

/**
 * Rol y ámbito del usuario en MC Central.
 *
 * **Sin caché**, por lo mismo que se quitó la de Mobilink Cash en la fase 10:
 * los roles se escriben desde el navegador contra Supabase, el servidor no se
 * entera, y en Render hay varias instancias, así que no hay forma de
 * invalidarla. Cuesta una lectura por clave indexada y compra que retirar un
 * permiso surta efecto en la siguiente petición.
 *
 * El `centroId` es el ámbito de taller, y aquí importa sobre todo por las
 * exportaciones: un fichero descargado se reenvía, y sería la vía más fácil
 * para que alguien limitado a un taller acabara con los datos de toda la red.
 */
export async function rolCentral(
  userId: string,
  esSuperadmin: boolean
): Promise<AmbitoCentral> {
  if (esSuperadmin) return { rol: "admin", centroId: null };

  const { rows } = await pool.query<{ rol: string; centro_id: string | null }>(
    `SELECT rol, centro_id FROM app_usuario_modulos WHERE user_id = $1 AND modulo = 'central'`,
    [userId]
  );
  return { rol: rows[0]?.rol ?? null, centroId: rows[0]?.centro_id ?? null };
}

declare module "express-serve-static-core" {
  interface Request {
    centralRol?: string | null;
    centralPermisos?: readonly Permiso[];
    /** Taller al que está limitado. `null` = toda la empresa. */
    centralCentroId?: string | null;
  }
}

export const cargarPermisosCentral: RequestHandler = async (req, res, next) => {
  const ctx = req.authCtx;
  if (!ctx) return res.status(401).json({ error: "Sesión requerida" });
  try {
    const { rol, centroId } = await rolCentral(ctx.userId, ctx.esSuperadmin);
    req.centralRol = rol;
    req.centralCentroId = centroId;
    req.centralPermisos = permisosDeRol(rol);
    next();
  } catch (e) {
    console.error("[MC Central] error cargando permisos:", e);
    res.status(500).json({ error: "Error comprobando permisos" });
  }
};

export function exigirPermiso(permiso: Permiso): RequestHandler {
  return (req, res, next) => {
    if (!req.centralPermisos?.includes(permiso)) {
      return res.status(403).json({
        error: "No tienes permiso para hacer esto en MC Central.",
        code: "PERMISO_DENEGADO",
        permiso,
      });
    }
    next();
  };
}
