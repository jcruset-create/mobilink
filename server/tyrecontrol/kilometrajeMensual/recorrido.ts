/**
 * Prueba del recorrido de UN vehículo en UN día (fase 1 de «tipo de vía»).
 *
 * Antes de montar nada para saber por qué carreteras va cada autobús
 * (autopista, autovía, nacional, comarcal, urbana) hay que saber si el
 * recorrido que da Movertis (`showtrips`) tiene puntos suficientes para pegar
 * el GPS a la carretera. Esto mide eso, sin guardar nada:
 *   · cuántos puntos da y cada cuánto (mediana, p90, máximo);
 *   · los huecos largos (más de 5 minutos sin punto mientras se mueve);
 *   · si trae velocidad;
 *   · la distancia sumando los puntos frente a la del resumen de viajes: si
 *     se parecen, los puntos siguen la carretera; si sale mucho menos, van
 *     cortando curvas (pocos puntos).
 */

export interface PuntoRecorrido { t: number; lat: number; lng: number; velocidad: number | null }

export type Veredicto = "suficiente" | "justo" | "insuficiente" | "sin_datos";

export interface EstadisticaRecorrido {
  puntos: number;
  primero: string | null;
  ultimo: string | null;
  /** Segundos entre puntos consecutivos. */
  intervaloMediana: number | null;
  intervaloP90: number | null;
  intervaloMaximo: number | null;
  /** Saltos de más de 5 minutos entre dos puntos separados más de 1 km. */
  huecos: number;
  minutosEnHuecos: number;
  conVelocidad: number;
  /** Suma de distancias en línea recta entre puntos consecutivos. */
  kmPorPuntos: number;
  veredicto: Veredicto;
  explicacion: string;
}

const R = 6371;
/** Distancia en km entre dos coordenadas (haversine). */
export function distanciaKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function percentil(ordenados: number[], p: number): number {
  const i = Math.min(ordenados.length - 1, Math.max(0, Math.ceil(p * ordenados.length) - 1));
  return ordenados[i];
}

const HUECO_S = 5 * 60;

export function estadisticaRecorrido(entrada: PuntoRecorrido[], kmResumen: number | null): EstadisticaRecorrido {
  const p = [...entrada].filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng)).sort((a, b) => a.t - b.t);
  const base = {
    puntos: p.length,
    primero: p[0] ? new Date(p[0].t).toISOString() : null,
    ultimo: p.length ? new Date(p[p.length - 1].t).toISOString() : null,
    conVelocidad: p.filter((x) => x.velocidad != null).length,
  };
  if (p.length < 2) {
    return { ...base, intervaloMediana: null, intervaloP90: null, intervaloMaximo: null, huecos: 0, minutosEnHuecos: 0,
      kmPorPuntos: 0, veredicto: "sin_datos",
      explicacion: p.length ? "Solo hay un punto ese día." : "Movertis no ha dado ningún punto ese día (¿no se movió?)." };
  }

  // Los intervalos que cuentan son los de MOVIMIENTO: si está parado en la
  // base toda la noche, que no haya puntos no es un problema.
  const intervalos: number[] = [];
  let km = 0;
  let huecos = 0;
  let segHuecos = 0;
  for (let i = 1; i < p.length; i++) {
    const s = (p[i].t - p[i - 1].t) / 1000;
    const d = distanciaKm(p[i - 1], p[i]);
    km += d;
    if (d < 0.05) continue; // parado
    intervalos.push(s);
    if (s > HUECO_S && d > 1) { huecos += 1; segHuecos += s; }
  }
  const ord = [...intervalos].sort((a, b) => a - b);
  const mediana = ord.length ? percentil(ord, 0.5) : null;
  const p90 = ord.length ? percentil(ord, 0.9) : null;
  const maximo = ord.length ? ord[ord.length - 1] : null;

  let veredicto: Veredicto;
  let explicacion: string;
  const cobertura = kmResumen && kmResumen > 0 ? km / kmResumen : null;
  const txtCobertura = cobertura != null
    ? ` Sumando los puntos salen ${Math.round(km)} km de los ${Math.round(kmResumen!)} del resumen de viajes (${Math.round(cobertura * 100)} %).`
    : "";
  if (mediana == null) {
    veredicto = "sin_datos";
    explicacion = "Hay puntos, pero el vehículo no se movió ese día.";
  } else if (mediana <= 60 && (p90 ?? 0) <= 180 && (cobertura == null || cobertura >= 0.85)) {
    veredicto = "suficiente";
    explicacion = `Un punto cada ${Math.round(mediana)} s en marcha: basta para saber por qué carretera va.${txtCobertura}`;
  } else if (mediana <= 300 && (cobertura == null || cobertura >= 0.6)) {
    veredicto = "justo";
    explicacion = `Un punto cada ${Math.round(mediana)} s en marcha: se puede, pero en zonas con muchas carreteras cerca habrá tramos dudosos.${txtCobertura}`;
  } else {
    veredicto = "insuficiente";
    explicacion = `Un punto cada ${Math.round(mediana)} s en marcha: demasiado separados para saber la carretera con seguridad.${txtCobertura}`;
  }
  return {
    ...base,
    intervaloMediana: mediana == null ? null : Math.round(mediana),
    intervaloP90: p90 == null ? null : Math.round(p90),
    intervaloMaximo: maximo == null ? null : Math.round(maximo),
    huecos, minutosEnHuecos: Math.round(segHuecos / 60),
    kmPorPuntos: Math.round(km * 10) / 10,
    veredicto, explicacion,
  };
}

/** Como mucho `max` puntos para dibujar, conservando el primero y el último. */
export function reducirPuntos<T>(p: T[], max = 2000): T[] {
  if (p.length <= max) return p;
  const paso = (p.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => p[Math.round(i * paso)]);
}
