/**
 * El access token de la sesión unificada, en un módulo sin dependencias.
 *
 * Existe por una razón concreta: las cabeceras del panel clásico
 * (`adminHeaders.ts`, `workshopApi.ts`) necesitan el token de forma SÍNCRONA, y
 * si lo pidieran a `apiFetch.ts` arrastrarían con él el cliente de Supabase.
 * Ese cliente se crea al importarlo y exige `VITE_SUPABASE_URL`, así que
 * cualquier prueba que tocara `workshopApi` —aunque fuera para una función de
 * cálculo— empezaría a fallar por falta de variables de entorno. Ya pasó al
 * escribir esto.
 *
 * Así que aquí solo vive el valor. Quien tiene el cliente (`apiFetch.ts`) lo
 * deja escrito, y quien solo necesita leerlo lo lee.
 */

let accessToken: string | null = null;

export function guardarTokenSesion(token: string | null): void {
  accessToken = token;
}

export function tokenSesionActual(): string | null {
  return accessToken;
}
