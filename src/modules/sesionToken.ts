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
 *
 * ── La carrera del arranque ─────────────────────────────────────────────────
 *
 * El token se lee de Supabase en segundo plano al cargar la página. Una
 * pantalla que pide sus datos nada más abrirse —la de OTF pedía las furgonetas
 * así— llegaba ANTES que el token: la petición salía sin credencial, el
 * servidor contestaba 401 y la lista se quedaba vacía sin decir nada. Se veía
 * como «no salen las furgonetas», con las furgonetas ahí.
 *
 * Por eso quien carga el token anuncia que lo está cargando, y las peticiones
 * pueden esperarlo. Con tope de tiempo: si Supabase tarda o no responde, la
 * petición sale igual, como antes, en vez de quedarse colgada.
 */

let accessToken: string | null = null;

/** La carga en curso, si alguien ha anunciado una. */
let carga: Promise<void> | null = null;
let soltarCarga: (() => void) | null = null;

export function guardarTokenSesion(token: string | null): void {
  accessToken = token;
}

export function tokenSesionActual(): string | null {
  return accessToken;
}

/** Lo llama quien va a leer la sesión, antes de empezar a leerla. */
export function anunciarCargaSesion(): void {
  if (carga) return;
  carga = new Promise<void>((resolver) => {
    soltarCarga = resolver;
  });
}

/** Lo llama quien ha terminado de leerla, haya sesión o no. */
export function sesionCargada(): void {
  soltarCarga?.();
  soltarCarga = null;
  carga = Promise.resolve();
}

/**
 * Espera a que la sesión esté leída, como mucho `maxMs`.
 *
 * Si nadie ha anunciado una carga —páginas sin login unificado, pruebas— no
 * espera nada: no hay token que esperar.
 */
export function esperarSesion(maxMs = 3000): Promise<void> {
  if (!carga) return Promise.resolve();
  return Promise.race([
    carga,
    new Promise<void>((resolver) => setTimeout(resolver, maxMs)),
  ]);
}
