/**
 * Los movimientos de la furgoneta durante una asistencia, en una línea de
 * tiempo: trayecto, parada, trayecto, parada… con sus horas, kilómetros y
 * duración, y los hitos de la asistencia (salida, llegada al punto,
 * finalizada…) en su sitio.
 *
 * Solo cuentas, sin red: los trayectos llegan ya de Webfleet. La misma
 * ventana de tiempo y el mismo mínimo de parada que el informe PDF de
 * seguimiento, para que la pantalla y el papel digan lo mismo.
 */

export type Trayecto = {
  start_time: string;
  end_time: string;
  start_latitude: number;
  start_longitude: number;
  end_latitude: number;
  end_longitude: number;
  start_postext?: string;
  end_postext?: string;
  distance: number; // metros
  duration: number; // segundos
  max_speed?: number;
};

export type Tramo =
  | {
      tipo: "trayecto";
      inicioMs: number;
      finMs: number;
      segundos: number;
      km: number;
      desde: string | null;
      hasta: string | null;
      velocidadMax: number | null;
    }
  | {
      tipo: "parada";
      n: number;
      inicioMs: number;
      finMs: number;
      segundos: number;
      lugar: string;
      lat: number | null;
      lng: number | null;
      /** Los hitos de la asistencia que caen durante esta parada («En punto»…). */
      hitos: string[];
    };

export type Hito = { etiqueta: string; ms: number };

/** La ventana de la asistencia: desde la salida (o asignación) hasta la llegada al taller (o fin). */
export function ventanaDeAsistencia(a: {
  createdAtMs?: number | null;
  assignedAtMs?: number | null;
  departedAtMs?: number | null;
  finishedAtMs?: number | null;
  arrivedAtWorkshopMs?: number | null;
}, ahoraMs = Date.now()): { desdeMs: number; hastaMs: number } {
  const desdeMs = Number(a.departedAtMs || a.assignedAtMs || a.createdAtMs || ahoraMs);
  const hastaMs = Number(a.arrivedAtWorkshopMs || a.finishedAtMs || ahoraMs);
  return { desdeMs, hastaMs: Math.max(desdeMs, hastaMs) };
}

/** Los hitos de la asistencia que tienen hora, en orden. */
export function hitosDeAsistencia(a: Record<string, unknown>): Hito[] {
  const lista: [string, string][] = [
    ["assignedAtMs", "Asignada"],
    ["departedAtMs", "Salida"],
    ["arrivedAtPointMs", "Llegada al punto"],
    ["inicioReparacionAtMs", "Inicio reparación"],
    ["finishedAtMs", "Finalizada"],
    ["enCaminoBaseAtMs", "Vuelta a base"],
    ["arrivedAtWorkshopMs", "Llegada al taller"],
  ];
  return lista
    .map(([campo, etiqueta]) => ({ etiqueta, ms: Number(a[campo]) }))
    .filter((h) => Number.isFinite(h.ms) && h.ms > 0)
    .sort((x, y) => x.ms - y.ms);
}

const coord = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n / 1_000_000 : null;
};

/**
 * Trayectos y paradas intercalados. Una parada es el hueco entre el final de
 * un trayecto y el principio del siguiente, si dura al menos `minParadaSeg`
 * (por defecto 3 min, como el informe): un semáforo no es una parada.
 */
export function lineaDeTiempo(trayectos: Trayecto[], hitos: Hito[] = [], minParadaSeg = 180): Tramo[] {
  const ordenados = [...trayectos].sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time));
  const tramos: Tramo[] = [];
  let n = 0;
  ordenados.forEach((t, i) => {
    const inicioMs = Date.parse(t.start_time);
    const finMs = Date.parse(t.end_time);
    tramos.push({
      tipo: "trayecto",
      inicioMs,
      finMs,
      segundos: Math.max(0, Math.round(Number(t.duration) || (finMs - inicioMs) / 1000)),
      km: Math.round(((Number(t.distance) || 0) / 1000) * 10) / 10,
      desde: t.start_postext || null,
      hasta: t.end_postext || null,
      velocidadMax: t.max_speed != null ? Number(t.max_speed) : null,
    });
    const siguiente = ordenados[i + 1];
    if (!siguiente) return;
    const salidaMs = Date.parse(siguiente.start_time);
    const hueco = Math.round((salidaMs - finMs) / 1000);
    if (hueco < minParadaSeg) return;
    n += 1;
    tramos.push({
      tipo: "parada",
      n,
      inicioMs: finMs,
      finMs: salidaMs,
      segundos: hueco,
      lugar: t.end_postext || "Parada",
      lat: coord(t.end_latitude),
      lng: coord(t.end_longitude),
      hitos: hitos.filter((h) => h.ms >= finMs && h.ms <= salidaMs).map((h) => h.etiqueta),
    });
  });
  return tramos;
}

/** Totales para la cabecera. */
export function resumenMovimientos(tramos: Tramo[]) {
  const trayectos = tramos.filter((t) => t.tipo === "trayecto");
  const paradas = tramos.filter((t) => t.tipo === "parada");
  return {
    km: Math.round(trayectos.reduce((s, t) => s + (t.tipo === "trayecto" ? t.km : 0), 0) * 10) / 10,
    conduccionSeg: trayectos.reduce((s, t) => s + t.segundos, 0),
    paradoSeg: paradas.reduce((s, t) => s + t.segundos, 0),
    trayectos: trayectos.length,
    paradas: paradas.length,
  };
}
