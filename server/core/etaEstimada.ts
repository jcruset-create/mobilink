/**
 * El tiempo aproximado de llegada ANTES de salir: desde donde está ahora la
 * furgoneta asignada hasta el punto de la asistencia.
 *
 * En «Asignada» el operario todavía no ha salido, así que no es un ETA de
 * verdad: es «si saliera ahora, tardaría esto». Se enseña con «aprox.» y no se
 * guarda en `etaMinutos`, que es el ETA del trayecto real y lo usa el panel.
 *
 * ── Por qué una caché ───────────────────────────────────────────────────────
 *
 * La página de seguimiento se refresca cada 20 segundos y la puede tener
 * abierta el cliente, la oficina y quien reciba el enlace. Cada cálculo es
 * una llamada de pago a Google Routes, y antes de salir la furgoneta casi no
 * se mueve: con recalcular cada pocos minutos basta. Lo mismo con la
 * posición de Webfleet, que se guarda junto al cálculo.
 */

export type EtaEstimada = {
  minutos: number;
  kilometros: string;
  calculadaAtMs: number;
  /**
   * La posición con la que se calculó, para pintar la furgoneta en el mapa
   * sin volver a preguntar a Webfleet en cada refresco (también tiene límite
   * de peticiones).
   */
  posicion?: {
    lat: number;
    lng: number;
    fuente: "furgoneta" | "tablet";
    antigua: boolean;
    atMs: number;
    speedKmh: number | null;
    moving: boolean | null;
  } | null;
};

/** Cada cuánto se recalcula como mucho, por asistencia. */
export const TTL_ETA_ESTIMADA_MS = 3 * 60_000;

/** Los estados en que se enseña: asignada, aún sin salir. */
export const ESTADOS_ETA_ESTIMADA = new Set(["asignada"]);

export function crearCacheEta(ttlMs = TTL_ETA_ESTIMADA_MS) {
  const cache = new Map<number, EtaEstimada>();
  return {
    /** La guardada si es reciente; si no, null y hay que calcular. */
    leer(asistenciaId: number, ahoraMs: number): EtaEstimada | null {
      const e = cache.get(asistenciaId);
      if (!e) return null;
      if (ahoraMs - e.calculadaAtMs > ttlMs) {
        cache.delete(asistenciaId);
        return null;
      }
      return e;
    },
    guardar(asistenciaId: number, eta: EtaEstimada): void {
      cache.set(asistenciaId, eta);
      // Que no crezca sin fin: lo caducado fuera.
      if (cache.size > 500) {
        for (const [id, e] of cache) {
          if (eta.calculadaAtMs - e.calculadaAtMs > ttlMs) cache.delete(id);
        }
      }
    },
    get tamano() {
      return cache.size;
    },
  };
}
