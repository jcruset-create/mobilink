export const ADMIN_TOKEN_STORAGE_KEY = "sea-admin-token";

/**
 * Factory: crea una función `getAdminHeaders` que resuelve el token mediante
 * `getToken()` en cada llamada. Permite reutilizar la cabecera de admin sin
 * acoplarse a `localStorage` (útil para tests y futuros hooks).
 */
export function makeAdminHeaders(getToken: () => string) {
  return (extra?: HeadersInit): HeadersInit => ({
    ...(extra ?? {}),
    "x-admin-token": getToken(),
  });
}

/**
 * Implementación por defecto usada por la app: lee el token de admin desde
 * `localStorage` en cada llamada (comportamiento idéntico al original).
 */
export const getAdminHeaders = makeAdminHeaders(
  () => localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) ?? ""
);
