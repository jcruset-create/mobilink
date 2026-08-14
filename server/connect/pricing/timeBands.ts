/**
 * Franjas horarias del tarifario.
 *
 * Dos cosas que parecen detalles y deciden el precio de un servicio:
 *
 * 1. Una franja puede cruzar la medianoche. "19:00–08:00" es UNA franja, no
 *    dos: partirla en dos filas obliga a mantenerlas sincronizadas y a que
 *    alguien recuerde por qué son dos.
 * 2. En una franja nocturna de lunes a viernes, el sábado a las 02:00 hay que
 *    decidir si es todavía el nocturno del viernes o ya es sábado. Las dos
 *    lecturas son defendibles y valen dinero distinto, así que lo dice el
 *    tarifario (`weekdayAnchor`), no el código.
 */

import { diaAnterior, diaSemanaDe, horaDeMinutos, type InstanteLocal } from "./time.ts";

export type AnclajeDia = "moment" | "band_start";

export interface FranjaHoraria {
  id: number;
  code: string;
  name: string;
  /** Minutos desde medianoche, hora local del tarifario. */
  startMinute: number;
  endMinute: number;
  /** 1 = lunes … 7 = domingo. Vacío o ausente = todos. */
  weekdays?: number[] | null;
  weekdayAnchor?: AnclajeDia | null;
  active?: boolean;
}

/** ¿La franja cruza la medianoche? */
export function cruzaMedianoche(f: FranjaHoraria): boolean {
  return f.startMinute > f.endMinute;
}

/** ¿La hora cae dentro de la franja, ignorando el día de la semana? */
export function horaEnFranja(f: FranjaHoraria, minutos: number): boolean {
  return cruzaMedianoche(f)
    ? minutos >= f.startMinute || minutos < f.endMinute
    : minutos >= f.startMinute && minutos < f.endMinute;
}

/**
 * Día de la semana con el que se compara la franja.
 *
 * Con `band_start`, y estando en la parte de madrugada de una franja que cruza
 * la medianoche, la franja empezó ayer: es el día de ayer el que cuenta.
 */
export function diaAplicable(f: FranjaHoraria, instante: InstanteLocal): number {
  const anclaje = f.weekdayAnchor ?? "moment";
  if (anclaje === "band_start" && cruzaMedianoche(f) && instante.minutos < f.endMinute) {
    return diaSemanaDe(diaAnterior(instante.fecha));
  }
  return instante.diaSemana;
}

export function franjaAplica(f: FranjaHoraria, instante: InstanteLocal): boolean {
  if (f.active === false) return false;
  if (!horaEnFranja(f, instante.minutos)) return false;
  const dias = f.weekdays ?? [];
  if (dias.length === 0) return true;
  return dias.includes(diaAplicable(f, instante));
}

/**
 * Franjas aplicables a un instante. Pueden ser varias —el tarifario decide
 * cuál manda con la prioridad de sus reglas—, así que se devuelven todas en un
 * orden estable y no una "ganadora" elegida aquí.
 */
export function franjasAplicables(
  franjas: FranjaHoraria[],
  instante: InstanteLocal,
): FranjaHoraria[] {
  return franjas
    .filter((f) => franjaAplica(f, instante))
    .sort((a, b) => a.id - b.id);
}

/** "19:00–08:00 (L-V)", para la explicación de la tarifa. */
export function describirFranja(f: FranjaHoraria): string {
  const horario = `${horaDeMinutos(f.startMinute)}–${horaDeMinutos(f.endMinute)}`;
  const dias = f.weekdays ?? [];
  if (dias.length === 0 || dias.length === 7) return horario;
  const nombres = ["L", "M", "X", "J", "V", "S", "D"];
  const ordenados = [...dias].sort((a, b) => a - b);
  const consecutivos = ordenados.every((d, i) => i === 0 || d === ordenados[i - 1] + 1);
  const etiqueta = consecutivos && ordenados.length > 2
    ? `${nombres[ordenados[0] - 1]}-${nombres[ordenados[ordenados.length - 1] - 1]}`
    : ordenados.map((d) => nombres[d - 1]).join(",");
  return `${horario} (${etiqueta})`;
}
