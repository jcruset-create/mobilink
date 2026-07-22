/**
 * SaaS fase 1 — autenticación y autorización centralizadas.
 *
 * Middleware reutilizable para proteger endpoints del Express con la
 * sesión unificada de Supabase (mismo patrón que /api/login-sso y
 * verificarAdminApp, pero generalizado):
 *
 *   authenticate          → Bearer token válido + usuario activo; deja
 *                           el contexto en req.authCtx
 *   requireModule("x")    → además, licencia vigente del módulo para la
 *                           empresa del usuario (app_licencia_activa)
 *   requireSuperadmin     → además, es_superadmin
 *   registrarAuditoria()  → inserta en app_auditoria
 *
 * AUTH_MODE (variable de entorno):
 *   legacy → no se usa este middleware en rutas antiguas (estado actual)
 *   dual   → conviven la auth antigua y la nueva (por defecto)
 *   strict → /api/login por contraseña compartida queda deshabilitado
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import db from "../db.ts";
import { supabase } from "../supabase.ts";

export type AuthContext = {
  userId: string;
  username: string;
  nombre: string;
  empresaId: string;
  esSuperadmin: boolean;
};

declare module "express-serve-static-core" {
  interface Request {
    authCtx?: AuthContext;
  }
}

export function getAuthMode(): "legacy" | "dual" | "strict" {
  const m = String(process.env.AUTH_MODE || "dual").toLowerCase();
  return m === "legacy" || m === "strict" ? m : "dual";
}

// ── Caches en memoria (TTL corto) ────────────────────────────
// Evitan una llamada a Supabase Auth + una query por cada request.
const CACHE_TTL_MS = 60_000;

const ctxCache = new Map<string, { ctx: AuthContext; expiresAt: number }>();
const licenseCache = new Map<string, { activa: boolean; expiresAt: number }>();

function cacheGet<T>(map: Map<string, { expiresAt: number } & T>, key: string) {
  const hit = map.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit;
  map.delete(key);
  return null;
}

/** Resuelve el token Bearer a un contexto de usuario activo (o null). */
export async function resolveAuthContext(token: string): Promise<AuthContext | null> {
  const cached = cacheGet(ctxCache, token);
  if (cached) return cached.ctx;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;

  const r = await db.query(
    `SELECT username, nombre, activo, es_superadmin, empresa_id
     FROM app_usuarios WHERE id = $1`,
    [data.user.id]
  );
  const u = r.rows[0];
  if (!u || !u.activo || !u.empresa_id) return null;

  const ctx: AuthContext = {
    userId: data.user.id,
    username: u.username,
    nombre: u.nombre,
    empresaId: u.empresa_id,
    esSuperadmin: Boolean(u.es_superadmin),
  };
  ctxCache.set(token, { ctx, expiresAt: Date.now() + CACHE_TTL_MS });
  return ctx;
}

export const authenticate: RequestHandler = async (req, res, next) => {
  try {
    const auth = String(req.headers.authorization || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Falta el token de sesión" });

    const ctx = await resolveAuthContext(token);
    if (!ctx) return res.status(401).json({ error: "Sesión no válida o usuario inactivo" });

    req.authCtx = ctx;
    next();
  } catch (e) {
    console.error("authenticate error:", e);
    res.status(500).json({ error: "Error de autenticación" });
  }
};

/** Licencia vigente del módulo para la empresa (cacheado 60 s). */
export async function licenciaActiva(empresaId: string, modulo: string): Promise<boolean> {
  const key = `${empresaId}:${modulo}`;
  const cached = cacheGet(licenseCache, key);
  if (cached) return cached.activa;

  const r = await db.query(`SELECT app_licencia_activa($1, $2) AS activa`, [empresaId, modulo]);
  const activa = Boolean(r.rows[0]?.activa);
  licenseCache.set(key, { activa, expiresAt: Date.now() + CACHE_TTL_MS });
  return activa;
}

export function requireModule(modulo: string): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const ctx = req.authCtx;
    if (!ctx) return res.status(401).json({ error: "Sesión requerida" });
    if (ctx.esSuperadmin) return next();
    try {
      if (!(await licenciaActiva(ctx.empresaId, modulo))) {
        return res.status(403).json({
          error: "Módulo sin licencia vigente",
          code: "LICENSE_EXPIRED",
          modulo,
        });
      }
      next();
    } catch (e) {
      console.error("requireModule error:", e);
      res.status(500).json({ error: "Error comprobando la licencia" });
    }
  };
}

export const requireSuperadmin: RequestHandler = (req, res, next) => {
  if (!req.authCtx) return res.status(401).json({ error: "Sesión requerida" });
  if (!req.authCtx.esSuperadmin) {
    return res.status(403).json({ error: "Solo un administrador de Mobilink puede hacer esto" });
  }
  next();
};

/** Registra una acción en app_auditoria (best-effort: nunca rompe la request). */
export async function registrarAuditoria(opts: {
  empresaId: string;
  userId?: string | null;
  accion: string;
  entidad?: string;
  entidadId?: string;
  detalle?: unknown;
  ip?: string;
}): Promise<void> {
  try {
    await db.query(
      `INSERT INTO app_auditoria (empresa_id, user_id, accion, entidad, entidad_id, detalle, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        opts.empresaId,
        opts.userId ?? null,
        opts.accion,
        opts.entidad ?? null,
        opts.entidadId ?? null,
        opts.detalle ? JSON.stringify(opts.detalle) : null,
        opts.ip ?? null,
      ]
    );
  } catch (e) {
    console.error("registrarAuditoria error:", e);
  }
}

/** Datos para GET /api/me: usuario + empresa + módulos con licencia vigente. */
export async function buildMePayload(ctx: AuthContext) {
  const [empresa, modulos] = await Promise.all([
    db.query(`SELECT id, nombre, slug, estado FROM app_empresas WHERE id = $1`, [ctx.empresaId]),
    db.query(
      `SELECT m.modulo, m.rol, m.pantallas
       FROM app_usuario_modulos m
       WHERE m.user_id = $1 AND app_licencia_activa($2, m.modulo)`,
      [ctx.userId, ctx.empresaId]
    ),
  ]);
  return {
    user: {
      id: ctx.userId,
      username: ctx.username,
      nombre: ctx.nombre,
      esSuperadmin: ctx.esSuperadmin,
    },
    empresa: empresa.rows[0] ?? null,
    apps: modulos.rows.map((r: { modulo: string }) => r.modulo),
    modulos: modulos.rows,
  };
}
