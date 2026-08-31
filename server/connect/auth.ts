/**
 * Connect Pro — autenticación por API key con scopes.
 *
 * Claves con formato mkc_<env>_<32 hex>. Solo se guarda el hash SHA-256;
 * la clave completa se muestra una única vez al crearla.
 */

import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import db from "../db.ts";

export interface ConnectAuthContext {
  partnerId: number;
  partnerName: string;
  apiKeyId: number;
  scopes: string[];
  environment: "live" | "test";
}

declare module "express-serve-static-core" {
  interface Request {
    connectAuth?: ConnectAuthContext;
  }
}

export function generateApiKey(environment: "live" | "test"): { key: string; prefix: string; hash: string } {
  const raw = crypto.randomBytes(16).toString("hex");
  const key = `mkc_${environment}_${raw}`;
  return { key, prefix: key.slice(0, 13), hash: sha256(key) };
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/**
 * Equivalencias entre permisos, en un único sitio.
 *
 * `assistances:write` es el permiso original, de cuando solo había uno para
 * escribir. Al separarlo en `create` y `update` quedaron claves vivas con el
 * antiguo, así que las dos formas tienen que valer: la vieja concede las dos
 * nuevas, y cualquiera de las nuevas satisface a quien pide la vieja.
 *
 * Sin esto, una credencial recién creada con los permisos nuevos recibiría un
 * 403 al crear una asistencia — que es exactamente lo que pasó al probarlo.
 */
const EQUIVALENCIAS: Record<string, string[]> = {
  "assistances:write": ["assistances:create", "assistances:update"],
};

/** Los permisos que concede de verdad una lista de scopes. */
export function expandirScopes(scopes: string[]): string[] {
  const fuera = new Set<string>();
  for (const s of scopes) {
    fuera.add(s);
    for (const e of EQUIVALENCIAS[s] ?? []) fuera.add(e);
  }
  return [...fuera];
}

/** Si una clave con `scopes` cumple el permiso `requerido`. */
export function cumpleScope(scopes: string[], requerido?: string): boolean {
  if (!requerido) return true;
  if (scopes.includes("*")) return true;
  const efectivos = expandirScopes(scopes);
  if (efectivos.includes(requerido)) return true;
  // Y al revés: quien pide el permiso antiguo se conforma con cualquiera de
  // los nuevos que lo sustituyen.
  return (EQUIVALENCIAS[requerido] ?? []).some((alternativo) => efectivos.includes(alternativo));
}

function sendError(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

/** Middleware: exige Authorization: Bearer mkc_... y el scope indicado. */
export function requireConnectKey(scope?: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = String(req.headers.authorization || "");
    const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!key.startsWith("mkc_")) {
      return sendError(res, 401, "unauthorized", "Falta la API key (Authorization: Bearer mkc_...)");
    }
    try {
      const r = await db.query(
        `SELECT k.id, k."partnerId", k.scopes, k.environment, k."revokedAtMs",
                p.name AS "partnerName", p.status AS "partnerStatus"
           FROM connect_api_keys k
           JOIN connect_partners p ON p.id = k."partnerId"
          WHERE k."keyHash" = $1`,
        [sha256(key)],
      );
      const row = r.rows[0];
      if (!row || row.revokedAtMs) {
        return sendError(res, 401, "unauthorized", "API key inválida o revocada");
      }
      if (row.partnerStatus !== "active") {
        return sendError(res, 403, "forbidden", "La cuenta del partner está suspendida");
      }
      const scopes: string[] = JSON.parse(row.scopes || "[]");
      if (!cumpleScope(scopes, scope)) {
        return sendError(res, 403, "scope_missing", `La API key no tiene el scope requerido: ${scope}`);
      }
      req.connectAuth = {
        partnerId: row.partnerId,
        partnerName: row.partnerName,
        apiKeyId: row.id,
        scopes,
        environment: row.environment,
      };
      db.query(`UPDATE connect_api_keys SET "lastUsedAtMs" = $1 WHERE id = $2`, [Date.now(), row.id]).catch(() => {});
      next();
    } catch (err: any) {
      console.error("[Connect] error autenticando API key:", err?.message);
      return sendError(res, 500, "internal_error", "Error interno de autenticación");
    }
  };
}
