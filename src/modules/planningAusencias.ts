import type { ScheduledTechStatus } from "./techStatusScheduleHelpers";
import {
  getHolidayForDate,
  getSpecialDayForDate,
  isClosedDate,
  type AgendaConfig,
} from "./agendaConfig";
import { ESTADOS_CONTADOS } from "./ausenciasTecnicos";

/**
 * La cuadrícula del planning anual: una fila por técnico, un día por celda.
 *
 * No inventa nada. Los estados salen de la franja «Todo el día» de la agenda
 * (los mismos que cuenta «Ausencias y vacaciones») y los días cerrados del
 * calendario del taller (festivos nacionales, autonómicos y locales que se
 * dieron de alta en Agenda → Configuración, los sábados de agosto y las
 * jornadas especiales). Esta pantalla solo los pone uno al lado del otro.
 */

export type EstadoDia = "vacaciones" | "baja" | "permiso" | "otro_taller" | "nodisponible";

export type CeldaDia = {
  fecha: string;
  /** Estado programado ese día, o null si trabaja. */
  estado: EstadoDia | null;
  /** Primer y último día del rango, para redondear las esquinas. */
  inicio: boolean;
  fin: boolean;
  /** Aún no ha llegado: se pinta rayado. */
  programado: boolean;
  /** Rango completo, para el aviso al pasar el ratón. */
  rango: string;
};

export type DiaDelAnio = {
  fecha: string;
  dia: number;
  mes: number;
  /** 0 = lunes … 6 = domingo. */
  semana: number;
  finde: boolean;
  /** El taller cierra: festivo, sábado de agosto o jornada especial cerrada. */
  cerrado: boolean;
  /** Por qué cierra, si hay un nombre (p. ej. «Diada de Catalunya»). */
  motivo: string | null;
  hoy: boolean;
};

export function fechaIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Los 365 (o 366) días del año, ya con lo que el calendario dice de cada uno. */
export function diasDelAnio(anio: number, config: AgendaConfig, hoy: string): DiaDelAnio[] {
  const salida: DiaDelAnio[] = [];
  for (let d = new Date(anio, 0, 1); d.getFullYear() === anio; d.setDate(d.getDate() + 1)) {
    const fecha = fechaIso(d);
    const semana = (d.getDay() + 6) % 7;
    const finde = semana >= 5;
    const festivo = getHolidayForDate(config, fecha);
    const especial = getSpecialDayForDate(config, fecha);
    // Un domingo siempre «cierra», pero no es noticia: solo se marca cerrado lo
    // que no sea fin de semana, o un sábado que cierra por festivo/agosto.
    const cerrado = semana === 6 ? false : isClosedDate(config, fecha);
    const motivo = festivo?.label
      ?? (especial?.closed ? (especial.label || "Cierre") : null)
      ?? (cerrado && semana === 5 && fecha.slice(5, 7) === "08" ? "Sábado de agosto" : null);
    salida.push({ fecha, dia: d.getDate(), mes: d.getMonth(), semana, finde, cerrado, motivo, hoy: fecha === hoy });
  }
  return salida;
}

function formatoCorto(fecha: string): string {
  return `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;
}

/** La fila de un técnico: una celda por día del año. */
export function filaDeTecnico(
  tecnico: string,
  estados: ScheduledTechStatus[],
  dias: DiaDelAnio[],
  hoy: string
): CeldaDia[] {
  const suyos = estados
    .filter((e) => e.techName === tecnico && (ESTADOS_CONTADOS as string[]).includes(e.status))
    .filter((e) => e.startDate && e.endDate)
    // El más reciente manda si dos se solapan: es el que alguien corrigió.
    .sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));

  return dias.map((d) => {
    const e = suyos.find((s) => d.fecha >= s.startDate && d.fecha <= s.endDate);
    if (!e) return { fecha: d.fecha, estado: null, inicio: false, fin: false, programado: false, rango: "" };
    return {
      fecha: d.fecha,
      estado: e.status as EstadoDia,
      inicio: d.fecha === e.startDate,
      fin: d.fecha === e.endDate,
      programado: d.fecha > hoy,
      rango: `${formatoCorto(e.startDate)} → ${formatoCorto(e.endDate)}`,
    };
  });
}

/** Cuántos técnicos faltan cada día del año. */
export function faltanPorDia(filas: CeldaDia[][], numDias: number): number[] {
  const n = new Array<number>(numDias).fill(0);
  for (const fila of filas) fila.forEach((c, i) => { if (c.estado) n[i]++; });
  return n;
}

/** El día (o rango de días seguidos) con más técnicos fuera. */
export function picoDeAusencias(faltan: number[], dias: DiaDelAnio[]): { cuantos: number; desde: string; hasta: string } | null {
  const max = Math.max(0, ...faltan);
  if (max === 0) return null;
  const i = faltan.indexOf(max);
  let j = i;
  while (j + 1 < faltan.length && faltan[j + 1] === max) j++;
  return { cuantos: max, desde: dias[i].fecha, hasta: dias[j].fecha };
}
