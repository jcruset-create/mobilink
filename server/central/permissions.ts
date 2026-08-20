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

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { rol: string | null; expiresAt: number }>();

export async function rolCentral(userId: string, esSuperadmin: boolean): Promise<string | null> {
  if (esSuperadmin) return "admin";

  const hit = cache.get(userId);
  if (hit && hit.expiresAt > Date.now()) return hit.rol;

  const { rows } = await pool.query<{ rol: string }>(
    `SELECT rol FROM app_usuario_modulos WHERE user_id = $1 AND modulo = 'central'`,
    [userId]
  );
  const rol = rows[0]?.rol ?? null;
  cache.set(userId, { rol, expiresAt: Date.now() + CACHE_TTL_MS });
  return rol;
}

declare module "express-serve-static-core" {
  interface Request {
    centralRol?: string | null;
    centralPermisos?: readonly Permiso[];
  }
}

export const cargarPermisosCentral: RequestHandler = async (req, res, next) => {
  const ctx = req.authCtx;
  if (!ctx) return res.status(401).json({ error: "Sesión requerida" });
  try {
    const rol = await rolCentral(ctx.userId, ctx.esSuperadmin);
    req.centralRol = rol;
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
