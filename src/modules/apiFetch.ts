import { supabase } from "./administracion/services/supabase";
import {
  anunciarCargaSesion,
  esperarSesion,
  guardarTokenSesion,
  registrarRenovador,
  renovarSesion,
  sesionCargada,
  tokenSesionActual,
  tokenSesionVigente,
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

// Un token caducado se renueva aquí, que es donde está el cliente (ver
// «El token caducado» en sesionToken.ts). getSession() ya renueva si hace falta.
registrarRenovador(async (forzar) => {
  const { data } = forzar ? await supabase.auth.refreshSession() : await supabase.auth.getSession();
  return data.session?.access_token ?? null;
});

export { tokenSesionActual };

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // Nada más abrir una pantalla el token puede no haber llegado todavía.
  await esperarSesion();
  const enviar = (token: string | null) => {
    if (!token) return fetch(input, init);
    const headers = new Headers(init?.headers);
    if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };
  const token = await tokenSesionVigente();
  const respuesta = await enviar(token);
  // 401 con sesión: se renueva y se intenta UNA vez más antes de darlo por malo.
  if (respuesta.status !== 401 || !token || new Headers(init?.headers).has("Authorization")) return respuesta;
  const nuevo = await renovarSesion(true);
  return nuevo && nuevo !== token ? enviar(nuevo) : respuesta;
}
