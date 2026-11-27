/**
 * ¿Trae la petición la sesión unificada (Bearer) de un SUPER-ADMIN activo?
 *
 * La usa el guard del Integration Hub como alternativa a `x-admin-token`.
 * Solo super-admin: el Hub elige el tenant por parámetro, así que un
 * administrador de una empresa podría mirar las de otras.
 */

import type { Request } from "express";
import { resolveAuthContext } from "../../core/auth.ts";

export async function esSuperadminPorSesion(
  req: Request, resolver: typeof resolveAuthContext = resolveAuthContext,
): Promise<boolean> {
  const auth = String(req.headers.authorization ?? "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return false;
  try {
    return (await resolver(token))?.esSuperadmin === true;
  } catch {
    return false;
  }
}
