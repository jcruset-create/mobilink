import { supabase } from "./administracion/services/supabase";

/**
 * Cabecera Authorization con el token de la sesión unificada (Supabase),
 * para los endpoints del backend protegidos desde la fase 1 SaaS.
 * Si no hay sesión, devuelve solo las cabeceras extra.
 */
export async function sessionHeaders(
  extra?: Record<string, string>
): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    ...(extra ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}
