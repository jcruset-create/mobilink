/**
 * Qué se le puede cambiar a un usuario de TyreControl desde su ficha: el
 * correo y la empresa.
 *
 * Aquí solo se DECIDE; lo escribe quien llama. Va aparte y sin tocar la base
 * para poder probar las reglas, que son las que importan:
 *
 *   · Un administrador de empresa solo toca a los de SU empresa, y no los
 *     cambia de empresa: eso sería sacarlos de su alcance o meter a alguien
 *     en la de otro. Solo el superadministrador mueve usuarios.
 *   · A un superadministrador solo lo toca otro superadministrador.
 *   · A un usuario UNIFICADO (el que también existe en `app_usuarios` y entra
 *     por el acceso común de Mobilink) no se le cambia aquí ni el correo ni la
 *     empresa: su correo se deriva de su nombre de usuario y su empresa la
 *     sincroniza Administración. Cambiarlos aquí lo dejaría sin poder entrar,
 *     o lo desharía la siguiente sincronización.
 */

export type Quien = { id: string; es_superadmin: boolean; empresa_id: string | null };
export type Objetivo = { id: string; email: string | null; empresa_id: string | null; es_superadmin: boolean };
export type Pedido = { email?: unknown; empresa_id?: unknown };

export type Decision =
  | { ok: false; estado: number; error: string }
  | { ok: true; email?: string; empresaId?: string };

const FORMA_DE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function decidirCambioDeDatos(
  admin: Quien, objetivo: Objetivo, unificado: boolean, pedido: Pedido,
): Decision {
  if (objetivo.es_superadmin && !admin.es_superadmin) {
    return { ok: false, estado: 403, error: "A un superadministrador solo lo edita otro superadministrador" };
  }
  if (!admin.es_superadmin && (!admin.empresa_id || admin.empresa_id !== objetivo.empresa_id)) {
    return { ok: false, estado: 403, error: "Ese usuario no es de tu empresa" };
  }

  const email = typeof pedido.email === "string" ? pedido.email.trim().toLowerCase() : "";
  const empresaId = typeof pedido.empresa_id === "string" ? pedido.empresa_id.trim() : "";
  const cambiaEmail = email !== "" && email !== String(objetivo.email ?? "").toLowerCase();
  const cambiaEmpresa = empresaId !== "" && empresaId !== objetivo.empresa_id;

  if (!cambiaEmail && !cambiaEmpresa) return { ok: true };

  if (unificado) {
    return {
      ok: false, estado: 400,
      error: "Este usuario entra con el acceso común de Mobilink: su correo y su empresa se cambian en Administración → Usuarios",
    };
  }
  if (cambiaEmail && !FORMA_DE_CORREO.test(email)) {
    return { ok: false, estado: 400, error: "Ese correo no tiene forma de correo" };
  }
  if (cambiaEmpresa && !admin.es_superadmin) {
    return { ok: false, estado: 403, error: "Solo un superadministrador cambia a un usuario de empresa" };
  }
  if (cambiaEmpresa && objetivo.es_superadmin) {
    return { ok: false, estado: 400, error: "Un superadministrador no se cambia de empresa" };
  }

  return {
    ok: true,
    ...(cambiaEmail ? { email } : {}),
    ...(cambiaEmpresa ? { empresaId } : {}),
  };
}

/** El aviso de Supabase Auth cuando el correo ya es de otro, en castellano. */
export function mensajeDeCorreo(mensaje: string | undefined | null): string {
  const m = String(mensaje ?? "");
  if (/already (been )?registered|already exists|duplicate/i.test(m)) {
    return "Ese correo ya lo usa otro usuario. Cada usuario necesita un correo distinto.";
  }
  if (/invalid.*email|email.*invalid/i.test(m)) return "Ese correo no es válido";
  return m || "No se ha podido guardar el correo";
}
