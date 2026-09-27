import { tokenSesionActual } from "./sesionToken";

export const ADMIN_TOKEN_STORAGE_KEY = "sea-admin-token";

/**
 * Factory: crea una función `getAdminHeaders` que resuelve el token mediante
 * `getToken()` en cada llamada. Permite reutilizar la cabecera de admin sin
 * acoplarse a `localStorage` (útil para tests y futuros hooks).
 */
export function makeAdminHeaders(getToken: () => string) {
  return (extra?: HeadersInit): HeadersInit => {
    const cabeceras: Record<string, string> = {
      ...((extra ?? {}) as Record<string, string>),
      "x-admin-token": encodeURIComponent(getToken()),
    };

    /*
     * Además del token clásico, la sesión unificada cuando la hay.
     *
     * El servidor resuelve el rol mirando primero el Bearer y solo después el
     * token clásico (`getRoleFromRequestAsync`). Mandando los dos, el panel
     * sigue funcionando exactamente igual y deja de depender de que el login
     * SSO le entregue una contraseña: ese era el camino por el que la
     * contraseña maestra acababa en `localStorage` de cada administrador.
     *
     * Quien entra por el login clásico —tecleando la contraseña compartida— no
     * tiene sesión de Supabase y sigue yendo solo con el token, como hasta hoy.
     */
    const sesion = tokenSesionActual();
    if (sesion && !cabeceras.Authorization) {
      cabeceras.Authorization = `Bearer ${sesion}`;
    }
    return cabeceras;
  };
}

/**
 * Implementación por defecto usada por la app: lee el token de admin desde
 * `localStorage` en cada llamada (comportamiento idéntico al original).
 */
export const getAdminHeaders = makeAdminHeaders(
  () => localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) ?? ""
);
