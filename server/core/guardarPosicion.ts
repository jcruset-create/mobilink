/**
 * ¿Merece la pena guardar esta posición del operario?
 *
 * Las salidas y la vuelta al taller escriben la posición en la asistencia
 * cada uno o dos minutos para que el mapa del panel esté en vivo. Lo hacían
 * siempre: con la furgoneta parada era la misma fila reescrita sin fin, y una
 * salida que se quedara abierta escribía para siempre.
 *
 * Se guarda si se ha movido de verdad o si lo guardado empieza a envejecer.
 * El panel da por vieja una posición a los cinco minutos
 * (`MAX_EDAD_POSICION_MS`); refrescándola cada dos como mucho, nunca llega.
 *
 * Sin base: se prueba en `guardarPosicion.test.ts`.
 */

import { haversineMeters } from "../connect/liteRules.ts";

export type PosicionGuardada = { lat: number | null; lng: number | null; atMs: number | null };

/** Menos que esto es el GPS bailando con la furgoneta quieta. */
export const MOVIMIENTO_MINIMO_M = 25;
/** Lo guardado se refresca como mucho cada tanto, aunque no se mueva. */
export const REFRESCO_MAXIMO_MS = 2 * 60_000;

export function debeGuardarPosicion(
  guardada: PosicionGuardada,
  nueva: { lat: number; lng: number; atMs: number }
): boolean {
  const { lat, lng, atMs } = guardada;
  if (lat == null || lng == null || atMs == null) return true;
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng)) || !Number.isFinite(Number(atMs))) return true;
  // Una lectura igual o más vieja que la guardada no aporta nada.
  if (nueva.atMs <= Number(atMs)) return false;
  if (haversineMeters(Number(lat), Number(lng), nueva.lat, nueva.lng) >= MOVIMIENTO_MINIMO_M) return true;
  return nueva.atMs - Number(atMs) >= REFRESCO_MAXIMO_MS;
}
