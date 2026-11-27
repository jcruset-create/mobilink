/**
 * Hablar con Overpass sin que un tropiezo tire la tanda.
 *
 * Overpass es el servicio público y gratuito de OpenStreetMap del que salen
 * las carreteras. Es compartido, va a ratos y de vez en cuando ni siquiera
 * acepta la conexión. Eso no es una avería nuestra: es cómo es, y el cliente
 * tiene que contar con ello.
 *
 * ── Lo que se arregla aquí ──────────────────────────────────────────────────
 *
 * Antes, el primer fallo paraba la descarga entera y la pantalla enseñaba
 * «fetch failed», que es lo que dice Node cuando no logra abrir la conexión y
 * no significa nada para quien lo lee. Un corte de un segundo dejaba el día
 * sin analizar y a una persona mirando un mensaje que no explica nada.
 *
 * Ahora:
 *
 *  · Se reintenta con esperas crecientes, pero SOLO lo que puede mejorar
 *    repitiéndolo: que no conteste, o que conteste «estoy ocupado» (429, 502,
 *    503, 504). Una consulta mal escrita devuelve 400 y repetirla daría 400
 *    cuatro veces más despacio.
 *  · Se puede dar MÁS DE UN servidor y se van alternando. El de la casa es el
 *    oficial; quien quiera poner un espejo lo pone en la variable de entorno,
 *    sin tocar código ni desplegar.
 *  · El motivo se cuenta en cristiano y diciendo QUÉ servidor falló, que es lo
 *    primero que hace falta saber para arreglarlo.
 *
 * Las esperas son generosas a propósito: esto pide a un servicio gratuito que
 * mantiene otra gente. Antes esperar de más que insistir de más.
 */

/** Esperas entre intentos, en ms. Su longitud fija cuántos reintentos hay. */
export const ESPERAS_MS = [2_000, 6_000, 15_000];

/** Respuestas que significan «ahora no puedo»: repetirlas tiene sentido. */
const HTTP_REINTENTABLES = new Set([429, 500, 502, 503, 504]);

/**
 * Los servidores públicos de Overpass que se usan si no se configura nada: el
 * oficial y dos espejos de la lista de instancias públicas de OpenStreetMap.
 * Con solo el oficial, cuando no contestaba (pasa a ratos) no había a dónde
 * ir y el día se quedaba sin analizar: «overpass-api.de no contesta».
 */
export const SERVIDORES_POR_DEFECTO = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

/**
 * Los servidores a los que preguntar, en orden.
 *
 * Varios separados por comas en TC_OVERPASS_URL. Vacío o sin variable: el
 * oficial y sus espejos.
 */
export function servidoresDe(valor: string | undefined | null): string[] {
  const lista = String(valor ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));
  return lista.length ? lista : [...SERVIDORES_POR_DEFECTO];
}

/** El nombre del servidor, para poder decir cuál ha fallado. */
export function servidorDe(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

/**
 * Por qué ha fallado, dicho para una persona.
 *
 * «fetch failed» es lo que da Node cuando ni siquiera abre la conexión. Quien
 * lee la pantalla necesita saber que el que no contesta es OpenStreetMap, no
 * nosotros.
 */
export function motivoDeFallo(e: unknown, url: string): string {
  const donde = servidorDe(url);
  if (e instanceof RespuestaOverpass) return `OpenStreetMap (${donde}) ha contestado ${e.status}`;
  const txt = e instanceof Error ? e.message : String(e);
  if (/abort|timeout/i.test(txt)) return `OpenStreetMap (${donde}) ha tardado demasiado`;
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|socket/i.test(txt)) {
    return `OpenStreetMap (${donde}) no contesta`;
  }
  return `OpenStreetMap (${donde}): ${txt}`;
}

/** Un HTTP que no es 2xx. Lleva el código para decidir si se reintenta. */
export class RespuestaOverpass extends Error {
  constructor(readonly status: number, url: string) {
    super(`OpenStreetMap (${servidorDe(url)}) ha contestado ${status}`);
    this.name = "RespuestaOverpass";
  }
}

/** ¿Puede mejorar repitiéndolo? */
export function reintentable(e: unknown): boolean {
  if (e instanceof RespuestaOverpass) return HTTP_REINTENTABLES.has(e.status);
  // Cualquier otro fallo aquí es de conexión: no llegó a haber respuesta.
  return true;
}

export interface OpcionesPeticion {
  servidores: string[];
  /** Inyectables para poder probar esto sin red ni esperas de verdad. */
  fetchImpl?: typeof fetch;
  esperar?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Lanza la consulta y devuelve el JSON. Alterna servidores y reintenta.
 *
 * Lanza con el motivo del ÚLTIMO intento cuando se acaban: es el que hay que
 * enseñar, y los anteriores no añaden nada que no diga ya la insistencia.
 */
export async function pedirAOverpass(consulta: string, o: OpcionesPeticion): Promise<unknown> {
  const servidores = o.servidores.length ? o.servidores : servidoresDe(null);
  const hacer = o.fetchImpl ?? fetch;
  const esperar = o.esperar ?? dormir;
  const intentos = ESPERAS_MS.length + 1;

  let ultimo: unknown = null;
  for (let i = 0; i < intentos; i++) {
    // Se rota de servidor en cada intento: si el primero está caído, el
    // siguiente intento ya va al otro en vez de insistir contra la pared.
    const url = servidores[i % servidores.length];
    try {
      const r = await hacer(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          // Overpass pide identificarse para poder avisar a quien abusa.
          "User-Agent": "MobilinkTyreControl/1.0",
        },
        body: new URLSearchParams({ data: consulta }),
        signal: AbortSignal.timeout(o.timeoutMs ?? 120_000),
      });
      if (!r.ok) throw new RespuestaOverpass(r.status, url);
      return await r.json();
    } catch (e) {
      ultimo = new Error(motivoDeFallo(e, url));
      if (!reintentable(e) || i === intentos - 1) break;
      await esperar(ESPERAS_MS[i]);
    }
  }
  throw ultimo instanceof Error ? ultimo : new Error(String(ultimo));
}
