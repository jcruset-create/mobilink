/**
 * Dónde está la furgoneta, con dos fuentes: el GPS de Webfleet y la tablet.
 *
 * Hasta ahora solo se miraba Webfleet. Si el equipo de la furgoneta dejaba de
 * dar posición —sin cobertura, desconectado, o con una posición vieja— el
 * seguimiento del cliente se quedaba sin ETA y la vuelta al taller no se
 * detectaba, aunque la tablet del operario estuviera mandando la suya cada
 * treinta segundos.
 *
 * La regla:
 *   1. Webfleet, si su posición es reciente: es el equipo fijo de la furgoneta.
 *   2. Si no, la tablet, si la suya es reciente.
 *   3. Si ninguna es reciente, la más nueva de las dos, marcada como antigua:
 *      mejor una posición vieja que ninguna para el ETA, y quien la pinta
 *      puede avisar.
 */

export type FuentePosicion = "furgoneta" | "tablet";

export type Lectura = { lat: number; lng: number; atMs: number };

export type PosicionElegida = Lectura & {
  fuente: FuentePosicion;
  /** Ninguna fuente tenía una posición reciente: esta es la menos vieja. */
  antigua: boolean;
};

/** A partir de cuánto una posición deja de contar como «ahora». */
export const MAX_EDAD_POSICION_MS = 5 * 60_000;

function valida(l: Lectura | null | undefined): l is Lectura {
  return (
    l != null &&
    Number.isFinite(l.lat) &&
    Number.isFinite(l.lng) &&
    Number.isFinite(l.atMs) &&
    // (0, 0) es lo que manda un GPS sin fijar, no un sitio del golfo de Guinea.
    !(l.lat === 0 && l.lng === 0)
  );
}

export function elegirPosicion(args: {
  furgoneta: Lectura | null;
  tablet: Lectura | null;
  ahoraMs: number;
  maxEdadMs?: number;
}): PosicionElegida | null {
  const maxEdad = args.maxEdadMs ?? MAX_EDAD_POSICION_MS;
  const furgoneta = valida(args.furgoneta) ? args.furgoneta : null;
  const tablet = valida(args.tablet) ? args.tablet : null;
  const reciente = (l: Lectura) => args.ahoraMs - l.atMs <= maxEdad;

  if (furgoneta && reciente(furgoneta)) return { ...furgoneta, fuente: "furgoneta", antigua: false };
  if (tablet && reciente(tablet)) return { ...tablet, fuente: "tablet", antigua: false };

  if (furgoneta && tablet) {
    return tablet.atMs > furgoneta.atMs
      ? { ...tablet, fuente: "tablet", antigua: true }
      : { ...furgoneta, fuente: "furgoneta", antigua: true };
  }
  if (furgoneta) return { ...furgoneta, fuente: "furgoneta", antigua: true };
  if (tablet) return { ...tablet, fuente: "tablet", antigua: true };
  return null;
}

/**
 * La hora de la posición de Webfleet (`pos_time`). Si no viene o no se
 * entiende, se toma como de ahora: es lo que se hacía antes y no hay motivo
 * para tirar una posición solo porque el formato de la hora sea raro.
 */
export function horaWebfleet(posTime: string | null | undefined, ahoraMs: number): number {
  if (!posTime) return ahoraMs;
  const ms = Date.parse(posTime);
  return Number.isFinite(ms) && ms <= ahoraMs + 60_000 ? ms : ahoraMs;
}
