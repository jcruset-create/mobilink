/**
 * El recorrido de una tablet en un periodo: kilómetros, paradas y trayectos,
 * sacados de sus posiciones GPS.
 *
 * Es lo mismo que el informe de seguimiento de la furgoneta, pero allí
 * Webfleet ya da los trayectos hechos. Aquí solo hay puntos (uno por minuto
 * fuera de asistencia, uno cada 30 s dentro), y las paradas y los trayectos
 * se deducen:
 *
 *   - Una PARADA es un rato en el que la tablet no se aleja más de
 *     `radioParadaM` del primer punto, de al menos `minParadaSec`.
 *   - Un TRAYECTO es lo que hay entre dos paradas.
 *   - Los KILÓMETROS son la suma de distancias entre puntos seguidos, sin los
 *     que tienen mala precisión ni los saltos imposibles (un punto que
 *     implica ir a más de `maxKmh`): el GPS de una tablet, dentro de una
 *     furgoneta, a veces da un punto a un kilómetro de donde está.
 */

export type PuntoRecorrido = {
  lat: number;
  lng: number;
  atMs: number;
  accuracyM?: number | null;
  speedKmh?: number | null;
};

export type Parada = {
  n: number;
  lat: number;
  lng: number;
  llegadaMs: number;
  salidaMs: number;
  duracionSec: number;
};

export type Trayecto = {
  inicioMs: number;
  finMs: number;
  km: number;
  duracionSec: number;
  maxKmh: number | null;
};

export type Recorrido = {
  km: number;
  enMarchaSec: number;
  paradoSec: number;
  paradas: Parada[];
  trayectos: Trayecto[];
  primeraSalidaMs: number | null;
  ultimaLlegadaMs: number | null;
  /** Los puntos buenos, para dibujar el recorrido en el mapa. */
  track: { lat: number; lng: number }[];
};

export function distanciaM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function analizarRecorrido(
  puntosEntrada: PuntoRecorrido[],
  opts: { minParadaSec?: number; radioParadaM?: number; maxPrecisionM?: number; maxKmh?: number } = {}
): Recorrido {
  const minParadaSec = opts.minParadaSec ?? 180;
  const radioParadaM = opts.radioParadaM ?? 120;
  const maxPrecisionM = opts.maxPrecisionM ?? 150;
  const maxKmh = opts.maxKmh ?? 200;

  // 1. Puntos buenos, en orden, sin saltos imposibles.
  const ordenados = puntosEntrada
    .filter(
      (p) =>
        Number.isFinite(p.lat) && Number.isFinite(p.lng) && Number.isFinite(p.atMs) &&
        !(p.lat === 0 && p.lng === 0) &&
        (p.accuracyM == null || p.accuracyM <= maxPrecisionM)
    )
    .sort((a, b) => a.atMs - b.atMs);
  const puntos: PuntoRecorrido[] = [];
  for (const p of ordenados) {
    const prev = puntos[puntos.length - 1];
    if (prev) {
      const horas = (p.atMs - prev.atMs) / 3_600_000;
      const km = distanciaM(prev.lat, prev.lng, p.lat, p.lng) / 1000;
      if (horas <= 0 || km / horas > maxKmh) continue;
    }
    puntos.push(p);
  }

  const vacio: Recorrido = {
    km: 0, enMarchaSec: 0, paradoSec: 0, paradas: [], trayectos: [],
    primeraSalidaMs: null, ultimaLlegadaMs: null,
    track: puntos.map((p) => ({ lat: p.lat, lng: p.lng })),
  };
  if (puntos.length < 2) return vacio;

  // 2. Grupos de puntos quietos: cada uno empieza en un punto y sigue mientras
  //    los siguientes no se alejen más del radio.
  type Grupo = { desde: number; hasta: number };
  const quietos: Grupo[] = [];
  let i = 0;
  while (i < puntos.length) {
    let j = i;
    while (
      j + 1 < puntos.length &&
      distanciaM(puntos[i].lat, puntos[i].lng, puntos[j + 1].lat, puntos[j + 1].lng) <= radioParadaM
    ) {
      j++;
    }
    if ((puntos[j].atMs - puntos[i].atMs) / 1000 >= minParadaSec) {
      quietos.push({ desde: i, hasta: j });
      i = j + 1;
    } else {
      i++;
    }
  }

  const paradas: Parada[] = quietos.map((g, k) => ({
    n: k + 1,
    lat: puntos[g.desde].lat,
    lng: puntos[g.desde].lng,
    llegadaMs: puntos[g.desde].atMs,
    salidaMs: puntos[g.hasta].atMs,
    duracionSec: Math.round((puntos[g.hasta].atMs - puntos[g.desde].atMs) / 1000),
  }));

  // 3. Trayectos: lo que queda entre paradas (y antes de la primera / después
  //    de la última, si la tablet se movía).
  const tramos: Array<[number, number]> = [];
  let inicio = 0;
  for (const g of quietos) {
    if (g.desde > inicio) tramos.push([inicio, g.desde]);
    inicio = g.hasta;
  }
  if (inicio < puntos.length - 1) tramos.push([inicio, puntos.length - 1]);

  const trayectos: Trayecto[] = [];
  for (const [a, b] of tramos) {
    let m = 0;
    let maxV: number | null = null;
    for (let k = a + 1; k <= b; k++) {
      m += distanciaM(puntos[k - 1].lat, puntos[k - 1].lng, puntos[k].lat, puntos[k].lng);
      const v = puntos[k].speedKmh;
      if (v != null && Number.isFinite(v)) maxV = Math.max(maxV ?? 0, v);
    }
    // Un «trayecto» de menos de 300 m es el GPS bailando, no un viaje.
    if (m < 300) continue;
    trayectos.push({
      inicioMs: puntos[a].atMs,
      finMs: puntos[b].atMs,
      km: m / 1000,
      duracionSec: Math.round((puntos[b].atMs - puntos[a].atMs) / 1000),
      maxKmh: maxV != null ? Math.round(maxV) : null,
    });
  }

  return {
    km: trayectos.reduce((s, t) => s + t.km, 0),
    enMarchaSec: trayectos.reduce((s, t) => s + t.duracionSec, 0),
    paradoSec: paradas.reduce((s, p) => s + p.duracionSec, 0),
    paradas,
    trayectos,
    primeraSalidaMs: trayectos[0]?.inicioMs ?? null,
    ultimaLlegadaMs: trayectos[trayectos.length - 1]?.finMs ?? null,
    track: puntos.map((p) => ({ lat: p.lat, lng: p.lng })),
  };
}
