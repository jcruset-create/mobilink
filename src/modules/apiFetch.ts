import { supabase } from "./administracion/services/supabase";
import {
  anunciarCargaSesion,
  esperarSesion,
  guardarTokenSesion,
  sesionCargada,
  tokenSesionActual,
} from "./sesionToken";

/**
 * fetch con la sesión unificada (fase 1 SaaS): añade Authorization Bearer
 * a las llamadas del panel hacia el backend Express. Sustituto drop-in de
 * fetch — respeta method, headers y body tal cual.
 *
 * El token se mantiene en una caché síncrona (onAuthStateChange) para no
 * convertir en async todos los puntos de llamada del panel.
 */

/*
 * El token vive en `sesionToken.ts`, que no importa nada. Aquí se alimenta, que
 * es lo que requiere tener el cliente de Supabase delante.
 */
// Se anuncia ANTES de pedirla, para que las peticiones que salgan mientras
// tanto la esperen en vez de irse sin credencial. Ver sesionToken.ts.
anunciarCargaSesion();
void supabase.auth
  .getSession()
  .then(({ data }) => {
    guardarTokenSesion(data.session?.access_token ?? null);
  })
  .catch(() => {
    /* sin sesión: se sigue con lo que haya */
  })
  .finally(() => sesionCargada());
supabase.auth.onAuthStateChange((_event, session) => {
  guardarTokenSesion(session?.access_token ?? null);
});

export { tokenSesionActual };

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // Nada más abrir una pantalla el token puede no haber llegado todavía.
  await esperarSesion();
  const accessToken = tokenSesionActual();
  if (!accessToken) return fetch(input, init);
  const headers = new Headers(init?.headers);
  if (!headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  return fetch(input, { ...init, headers });
}
