import { supabase } from "./administracion/services/supabase";

/**
 * fetch con la sesión unificada (fase 1 SaaS): añade Authorization Bearer
 * a las llamadas del panel hacia el backend Express. Sustituto drop-in de
 * fetch — respeta method, headers y body tal cual.
 *
 * El token se mantiene en una caché síncrona (onAuthStateChange) para no
 * convertir en async todos los puntos de llamada del panel.
 */

let accessToken: string | null = null;

void supabase.auth.getSession().then(({ data }) => {
  accessToken = data.session?.access_token ?? null;
});
supabase.auth.onAuthStateChange((_event, session) => {
  accessToken = session?.access_token ?? null;
});

export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!accessToken) return fetch(input, init);
  const headers = new Headers(init?.headers);
  if (!headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  return fetch(input, { ...init, headers });
}
