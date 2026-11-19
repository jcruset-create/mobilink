/**
 * Firmas de las teselas de satélite: funciones puras, aparte del router para
 * poder probarlas sin Supabase.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Cuánto vale una firma. Lo bastante para mirar un patio con calma. */
export const VIDA_FIRMA_MS = 2 * 60 * 60 * 1000;

export const SECRETO =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || randomBytes(32).toString("hex");

/** Firma para la tesela: HMAC de la caducidad. */
export function firmar(expira: number, secreto = SECRETO): string {
  return createHmac("sha256", `teselas:${secreto}`).update(String(expira)).digest("hex");
}

/** ¿Vale esta firma ahora? Caducada, mal formada o falsa: no. */
export function firmaValida(firma: unknown, expira: unknown, ahora = Date.now(), secreto = SECRETO): boolean {
  const e = Number(expira);
  if (typeof firma !== "string" || !Number.isFinite(e) || e < ahora || e > ahora + VIDA_FIRMA_MS + 60_000) {
    return false;
  }
  const buena = Buffer.from(firmar(e, secreto), "hex");
  const dada = Buffer.from(firma, "hex");
  return dada.length === buena.length && timingSafeEqual(dada, buena);
}

/** Coordenadas de tesela que tienen sentido; el resto no se le pide a Google. */
export function teselaValida(z: number, x: number, y: number): boolean {
  if (![z, x, y].every(Number.isInteger)) return false;
  if (z < 0 || z > 22) return false;
  const n = 2 ** z;
  return x >= 0 && y >= 0 && x < n && y < n;
}

