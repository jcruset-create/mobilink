/**
 * Connect Pro — roles y permisos del backoffice.
 *
 * Se apoya en la sesión unificada (server/core/auth.ts → authenticate deja
 * req.authCtx) y resuelve el usuario Connect en connect_users:
 *
 *   requireConnectRole("operator") → authenticate + usuario Connect activo
 *   con rol suficiente; deja el contexto en req.connectUser.
 *
 * Jerarquía: superadmin > cc_admin > supervisor > operator > analyst.
 * provider_user es un rol lateral (portal de empresa proveedora).
 * Los superadmins del hub se auto-aprovisionan en su primer acceso.
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import db from "../db.ts";
import { authenticate } from "../core/auth.ts";

export type ConnectRole = "superadmin" | "cc_admin" | "supervisor" | "operator" | "analyst" | "provider_user";

export interface ConnectUserContext {
  id: number;
  controlCenterId: number | null;
  email: string;
  name: string;
  role: ConnectRole;
  providerCompanyId: number | null;
}

declare module "express-serve-static-core" {
  interface Request {
    connectUser?: ConnectUserContext;
  }
}

const RANK: Record<ConnectRole, number> = {
  superadmin: 100, cc_admin: 80, supervisor: 60, operator: 40, analyst: 20, provider_user: 10,
};

async function resolveConnectUser(req: Request): Promise<ConnectUserContext | null> {
  const ctx = req.authCtx;
  if (!ctx) return null;
  const r = await db.query(
    `SELECT id, "controlCenterId", email, name, role, "providerCompanyId"
       FROM connect_users
      WHERE active AND ("supabaseUserId" = $1 OR lower(email) = lower($2))
      LIMIT 1`,
    [ctx.userId, ctx.username],
  );
  if (r.rows[0]) {
    // Completar el vínculo supabaseUserId si entró por email
    if (!r.rows[0].supabaseUserId) {
      db.query(`UPDATE connect_users SET "supabaseUserId" = $1 WHERE id = $2`, [ctx.userId, r.rows[0].id]).catch(() => {});
    }
    return r.rows[0] as ConnectUserContext;
  }
  // Auto-aprovisionamiento: superadmin del hub → superadmin de Connect
  if (ctx.esSuperadmin) {
    const now = Date.now();
    const cc = await db.query(`SELECT id FROM connect_control_centers ORDER BY id LIMIT 1`);
    const ins = await db.query(
      `INSERT INTO connect_users ("controlCenterId", "supabaseUserId", email, name, role, "createdAtMs", "updatedAtMs")
       VALUES ($1, $2, $3, $4, 'superadmin', $5, $5)
       ON CONFLICT (email) DO UPDATE SET "supabaseUserId" = EXCLUDED."supabaseUserId", "updatedAtMs" = EXCLUDED."updatedAtMs"
       RETURNING id, "controlCenterId", email, name, role, "providerCompanyId"`,
      [cc.rows[0]?.id ?? null, ctx.userId, ctx.username, ctx.nombre || ctx.username, now],
    );
    return ins.rows[0] as ConnectUserContext;
  }
  return null;
}

/** Middleware: sesión válida + usuario Connect con rango >= role. */
export function requireConnectRole(role: Exclude<ConnectRole, "provider_user">): RequestHandler[] {
  const check: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await resolveConnectUser(req);
      if (!user) return res.status(403).json({ error: { code: "no_connect_user", message: "Tu usuario no tiene acceso a Connect Pro" } });
      if (user.role === "provider_user" || RANK[user.role] < RANK[role]) {
        return res.status(403).json({ error: { code: "forbidden", message: "Permisos insuficientes" } });
      }
      req.connectUser = user;
      next();
    } catch (err: any) {
      console.error("[Connect] rbac error:", err?.message);
      res.status(500).json({ error: { code: "internal_error", message: "Error de autorización" } });
    }
  };
  return [authenticate, check];
}

/** Middleware: cualquier usuario Connect activo (incluye provider_user). */
export function requireConnectUser(): RequestHandler[] {
  const check: RequestHandler = async (req, res, next) => {
    try {
      const user = await resolveConnectUser(req);
      if (!user) return res.status(403).json({ error: { code: "no_connect_user", message: "Tu usuario no tiene acceso a Connect Pro" } });
      req.connectUser = user;
      next();
    } catch (err: any) {
      console.error("[Connect] rbac error:", err?.message);
      res.status(500).json({ error: { code: "internal_error", message: "Error de autorización" } });
    }
  };
  return [authenticate, check];
}

/** Middleware para el portal de empresa proveedora (solo su empresa). */
export function requireProviderUser(): RequestHandler[] {
  const check: RequestHandler = async (req, res, next) => {
    const user = await resolveConnectUser(req);
    if (!user || (user.role !== "provider_user" && RANK[user.role] < RANK.supervisor)) {
      return res.status(403).json({ error: { code: "forbidden", message: "Permisos insuficientes" } });
    }
    req.connectUser = user;
    next();
  };
  return [authenticate, check];
}

/** Auditoría de Connect (append-only). Nunca lanza. */
export async function auditConnect(opts: {
  req?: Request;
  actorType?: "user" | "api" | "system";
  action: string;
  resourceType?: string;
  resourceId?: string | number;
  detail?: unknown;
}): Promise<void> {
  try {
    const u = opts.req?.connectUser;
    await db.query(
      `INSERT INTO connect_audit_logs
         ("controlCenterId", "actorType", "actorId", "actorName", action, "resourceType", "resourceId", detail, ip, "createdAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        u?.controlCenterId ?? null,
        opts.actorType ?? (u ? "user" : "system"),
        u ? String(u.id) : null,
        u?.name ?? null,
        opts.action,
        opts.resourceType ?? null,
        opts.resourceId != null ? String(opts.resourceId) : null,
        opts.detail != null ? JSON.stringify(opts.detail).slice(0, 4000) : null,
        opts.req?.ip ?? null,
        Date.now(),
      ],
    );
  } catch (err: any) {
    console.error("[Connect] audit error:", err?.message);
  }
}
