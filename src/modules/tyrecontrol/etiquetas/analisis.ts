import { supabase } from "../services/supabase";
import type { FotoEtiqueta } from "./datos";
import { sinLeer } from "./revision";

/**
 * Leer los números de serie de las fotos que ha subido la tablet.
 *
 * ── Quién analiza y por qué aquí ────────────────────────────────────────────
 *
 * La tablet SOLO hace fotos. No espera a que suban, no llama a la IA y no
 * decide nada: el operario está de pie delante de un palé y lo único que tiene
 * que hacer es disparar. El análisis se hace en el panel, que es donde después
 * una persona mira la foto y confirma el número, y donde una lectura lenta no
 * le hace perder tiempo a nadie en el patio.
 *
 * El lector es el MISMO de siempre —el endpoint del flanco, que devuelve solo
 * el número—: no hay una segunda IA ni un segundo sistema de fotografías.
 *
 * Y sigue siendo una PROPUESTA: esto rellena la casilla, nunca confirma. Para
 * que algo se imprima tiene que pulsarlo una persona.
 */

const API = import.meta.env.PROD ? "" : "http://localhost:4000";

export interface Lectura {
  serie: string | null;
  confianza: number | null;
  dudoso: boolean;
  /** 'detectada' | 'revisar' | 'no_detectada', tal como lo decide el servidor. */
  estado: string;
  aviso: string | null;
}

/**
 * Pide al servidor el número de serie de una foto.
 *
 * La clave de OpenAI no sale del servidor: aquí se manda la URL de la foto y
 * vuelve el número. Si el servicio no está disponible, se devuelve null y la
 * foto se queda como estaba —sin leer— para poder reintentarlo; marcarla como
 * «no detectada» sería mentir: nadie la ha mirado todavía.
 */
export async function leerSerieDeFoto(fotoUrl: string): Promise<Lectura | null> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("Sesión no válida");

  const r = await fetch(`${API}/api/tyrecontrol/etiquetas/leer`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ imagen_url: fotoUrl }),
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  if (!j) return null;
  return {
    serie: j.serie ?? null,
    confianza: j.confianza ?? null,
    dudoso: j.dudoso === true,
    estado: j.estado ?? "no_detectada",
    aviso: j.aviso ?? null,
  };
}

/**
 * Guarda lo leído en la foto.
 *
 * `soloSiSigueSinLeer` es lo que evita una carrera: cuando el análisis va solo,
 * dos personas con el mismo lote abierto lo lanzan las dos, y la segunda no
 * puede pisar un número que la primera ya haya dejado revisado o confirmado.
 * Gana quien llega antes y la otra escritura no hace nada.
 *
 * Cuando una persona pulsa «Volver a leer» es al revés: está pidiendo
 * expresamente que se relea una foto que ya tiene estado, así que ahí se
 * escribe. Lo que NUNCA se toca es `serie_confirmada`: la corrección de una
 * persona no la deshace la máquina.
 */
export async function guardarLectura(
  fotoId: string,
  l: Lectura,
  soloSiSigueSinLeer = true,
): Promise<void> {
  let q = supabase
    .from("tc_etiquetas_foto")
    .update({
      serie_detectada: l.serie,
      confianza: l.confianza,
      dudoso: l.dudoso,
      estado: l.estado,
      updated_at: new Date().toISOString(),
    })
    .eq("id", fotoId);
  if (soloSiSigueSinLeer) q = q.eq("estado", "pendiente");
  const { error } = await q;
  if (error) throw new Error(error.message);
}

/**
 * Analiza las fotos sin leer, de UNA EN UNA.
 *
 * De una en una a propósito: son llamadas a un modelo de visión, y lanzar
 * treinta a la vez no va más rápido —se encolan igual— y sí multiplica los
 * fallos por tiempo de espera. Además así la pantalla puede ir enseñando cada
 * número en cuanto llega, en vez de quedarse muda hasta el final.
 *
 * `alAvanzar` se llama después de cada foto para refrescar la pantalla. Un
 * fallo en una foto no detiene las demás: esa se queda sin leer y se puede
 * reintentar.
 */
export async function analizarPendientes(
  fotos: FotoEtiqueta[],
  alAvanzar: (hechas: number, total: number) => void,
): Promise<void> {
  const cola = sinLeer(fotos);
  for (let i = 0; i < cola.length; i++) {
    try {
      const lectura = await leerSerieDeFoto(cola[i].foto_url);
      if (lectura) await guardarLectura(cola[i].id, lectura);
    } catch {
      // Se deja sin leer: es reintentable y no bloquea al resto.
    }
    alAvanzar(i + 1, cola.length);
  }
}
