/**
 * Dónde está la tablet de cada operario de TyreControl.
 *
 * Mismo criterio que `server/tablets/posicionTablet.ts`, el de Mobilink
 * Assist, y a propósito: son el mismo problema y dos reglas distintas serían
 * dos pantallas que se contradicen. Lo que cambia es la clave —aquí un
 * `tc_usuarios.id`, allí un nombre de técnico de Assist— y el almacén, que es
 * Supabase porque es donde vive TyreControl.
 *
 * Lo que se guarda es SOLO la última posición de cada uno. No es un recorrido:
 * la pregunta que contesta es «¿dónde está ahora?», no «¿por dónde ha ido?».
 * Guardar el rastro sería otra cosa, con otras implicaciones, y no es lo que
 * se ha pedido.
 *
 * Se borra al cerrar sesión: quien ha cerrado sesión no está en ningún sitio.
 */

import { supabase } from "../../supabase.ts";

/** Más vieja que esto, la posición no dice dónde está nadie. */
export const MAX_EDAD_MS = 24 * 60 * 60_000;

export type PosicionTablet = {
  lat: number;
  lng: number;
  precisionM?: number | null;
  velocidadKmh?: number | null;
  /** Cuándo se tomó EN LA TABLET, no cuándo llegó aquí. */
  vistoAt: Date;
};

/** ¿Es una posición que valga la pena guardar? */
export function posicionValida(p: {
  lat: unknown;
  lng: unknown;
}): p is { lat: number; lng: number } {
  const { lat, lng } = p as { lat: number; lng: number };
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  // Fuera del mundo: un error de conversión, no un sitio.
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  /*
   * El (0, 0) es la isla Null, en el golfo de Guinea. Nadie está ahí: es lo
   * que devuelve un GPS que todavía no ha fijado. Lo mismo hace el almacén de
   * Assist, y por el mismo motivo: una tablet en mitad del Atlántico en el
   * mapa es peor que una tablet que no sale.
   */
  if (lat === 0 && lng === 0) return false;
  return true;
}

/**
 * Guarda la última posición de un operario.
 *
 * Una posición más vieja NUNCA pisa a una más nueva. Pasa de verdad: la cola
 * offline de la tablet puede soltar de golpe posiciones de hace una hora
 * justo después de que haya llegado la de ahora, y sin esta guarda el mapa
 * daría un salto al pasado.
 */
export async function guardarPosicion(
  usuarioId: string,
  empresaId: string | null,
  p: PosicionTablet,
): Promise<void> {
  if (!usuarioId || !posicionValida(p)) return;

  const { data: actual } = await supabase
    .from("tc_posicion_tablet")
    .select("visto_at")
    .eq("usuario_id", usuarioId)
    .maybeSingle();

  if (actual?.visto_at && new Date(actual.visto_at as string) > p.vistoAt) return;

  const { error } = await supabase.from("tc_posicion_tablet").upsert(
    {
      usuario_id: usuarioId,
      empresa_id: empresaId,
      lat: p.lat,
      lng: p.lng,
      precision_m: p.precisionM ?? null,
      velocidad_kmh: p.velocidadKmh ?? null,
      visto_at: p.vistoAt.toISOString(),
      actualizado_at: new Date().toISOString(),
    },
    { onConflict: "usuario_id" },
  );
  if (error) throw new Error(`No se pudo guardar la posición: ${error.message}`);
}

/** Al cerrar sesión. Quien ha cerrado sesión no sale en ninguna pantalla. */
export async function borrarPosicion(usuarioId: string): Promise<void> {
  if (!usuarioId) return;
  const { error } = await supabase
    .from("tc_posicion_tablet")
    .delete()
    .eq("usuario_id", usuarioId);
  if (error) throw new Error(`No se pudo borrar la posición: ${error.message}`);
}

/** ¿Esta posición todavía dice algo? */
export function esReciente(vistoAt: string | Date | null | undefined, ahoraMs = Date.now()): boolean {
  if (!vistoAt) return false;
  const t = vistoAt instanceof Date ? vistoAt.getTime() : Date.parse(String(vistoAt));
  if (!Number.isFinite(t)) return false;
  // Una posición del futuro es un reloj mal puesto en la tablet, no un dato.
  if (t > ahoraMs + 5 * 60_000) return false;
  return ahoraMs - t <= MAX_EDAD_MS;
}
