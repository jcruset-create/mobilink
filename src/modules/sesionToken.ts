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

/*
 * ── El token caducado ───────────────────────────────────────────────────────
 *
 * El token dura una hora y Supabase lo renueva solo con un temporizador. Pero
 * el navegador frena los temporizadores de una pestaña que lleva tiempo en
 * segundo plano: al volver a ella, el valor guardado aquí puede estar ya
 * caducado, y la primera petición salía con él. El servidor contestaba 401 y
 * la pantalla enseñaba «No autorizado» a alguien que tenía la sesión abierta.
 * Pasó al crear una OTF en una pestaña abierta desde hacía dos días.
 *
 * Así que antes de enviar se mira la caducidad, y si toca se pide uno nuevo a
 * quien tiene el cliente de Supabase (se registra desde `apiFetch.ts`, para
 * que este módulo siga sin importar nada).
 */

/** Pide a Supabase la sesión vigente; con `forzar`, la renueva aunque no haya caducado. */
type Renovador = (forzar: boolean) => Promise<string | null>;
let renovador: Renovador | null = null;
let renovando: Promise<string | null> | null = null;

export function registrarRenovador(fn: Renovador | null): void {
  renovador = fn;
}

/** Cuándo caduca un JWT, en ms; null si no se puede leer. */
export function caducidadMs(token: string | null): number | null {
  try {
    const cuerpo = String(token ?? "").split(".")[1];
    if (!cuerpo) return null;
    const exp = JSON.parse(atob(cuerpo.replace(/-/g, "+").replace(/_/g, "/"))).exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Con medio minuto de margen: uno que caduca mientras viaja también falla. */
export function tokenCaducado(token: string | null, ahoraMs = Date.now()): boolean {
  const exp = caducidadMs(token);
  return exp != null && exp - ahoraMs < 30_000;
}

/** Renueva la sesión. Varias peticiones a la vez comparten una sola renovación. */
export function renovarSesion(forzar = false): Promise<string | null> {
  if (!renovador) return Promise.resolve(accessToken);
  if (!renovando) {
    renovando = renovador(forzar)
      .then((t) => {
        if (t) accessToken = t;
        return accessToken;
      })
      .catch(() => accessToken)
      .finally(() => { renovando = null; });
  }
  return renovando;
}

/** El token para enviar AHORA: el guardado, o uno nuevo si ese ha caducado. */
export async function tokenSesionVigente(): Promise<string | null> {
  if (accessToken && tokenCaducado(accessToken)) return renovarSesion(false);
  return accessToken;
}
