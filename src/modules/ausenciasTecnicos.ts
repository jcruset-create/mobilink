// Recuento de ausencias de los técnicos por año: vacaciones disfrutadas,
// programadas y pendientes, más el resto de estados (baja, permiso...).
//
// Lógica pura: sin React y sin red, para poder probarla aislada, igual que
// agendaConfig.ts. Las fechas son cadenas 'YYYY-MM-DD' (convención de toda la
// agenda), de día completo y sin zona horaria, así que la comparación
// lexicográfica es válida y la aritmética se hace en UTC.

import {
  addDaysToDateKey,
  getHolidayForDate,
  weekdayIndexMonFirst,
  type AgendaConfig,
} from "./agendaConfig";
import type { ScheduledTechStatus } from "./techStatusScheduleHelpers";
import type { TechStatus } from "./workshopTypes";

/**
 * Cómo se cuentan los días de vacaciones:
 * - `naturales`: cuentan todos los días del rango, fines de semana y festivos
 *   incluidos (el convenio típico de 30 días).
 * - `laborables`: solo de lunes a viernes, descontando los festivos del
 *   calendario del taller (el convenio típico de 22 días).
 *
 * El modo afecta SOLO a `vacaciones`. Una baja médica o un permiso se cuentan
 * siempre en días naturales, que es como se cuentan de verdad.
 */
export type ModoVacaciones = "naturales" | "laborables";

export const DIAS_POR_DEFECTO: Record<ModoVacaciones, number> = {
  naturales: 30,
  laborables: 22,
};

/** Estados que esta pantalla cuenta. El resto no tiene rango de fechas. */
export const ESTADOS_CONTADOS: TechStatus[] = [
  "vacaciones",
  "baja",
  "permiso",
  "nodisponible",
  "otro_taller",
];

export const ETIQUETA_ESTADO: Record<string, string> = {
  vacaciones: "Vacaciones",
  baja: "Baja",
  permiso: "Permiso",
  nodisponible: "No disponible",
  otro_taller: "Otro taller",
  disponible: "Disponible",
};

export type RangoFechas = { startDate: string; endDate: string };

const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function esFechaValida(fecha: string): boolean {
  return FORMATO_FECHA.test(String(fecha || "").trim());
}

/**
 * Normaliza un rango: descarta lo que no tenga formato de fecha y ordena los
 * extremos si vienen del revés (se guardan a mano, y pasa).
 */
export function normalizaRango(rango: RangoFechas): RangoFechas | null {
  const inicio = String(rango.startDate || "").trim();
  const fin = String(rango.endDate || "").trim();

  if (!esFechaValida(inicio) || !esFechaValida(fin)) return null;

  return inicio <= fin
    ? { startDate: inicio, endDate: fin }
    : { startDate: fin, endDate: inicio };
}

/** Recorta un rango al año indicado. Devuelve null si no toca ese año. */
export function recortaAlAnio(
  rango: RangoFechas,
  anio: number
): RangoFechas | null {
  const normalizado = normalizaRango(rango);
  if (!normalizado) return null;

  const desde = `${anio}-01-01`;
  const hasta = `${anio}-12-31`;

  const inicio = normalizado.startDate > desde ? normalizado.startDate : desde;
  const fin = normalizado.endDate < hasta ? normalizado.endDate : hasta;

  return inicio <= fin ? { startDate: inicio, endDate: fin } : null;
}

/** Parte del rango que ya ha pasado, hoy incluido. */
export function parteHastaHoy(
  rango: RangoFechas,
  hoy: string
): RangoFechas | null {
  const normalizado = normalizaRango(rango);
  if (!normalizado) return null;
  if (normalizado.startDate > hoy) return null;

  const fin = normalizado.endDate < hoy ? normalizado.endDate : hoy;

  return { startDate: normalizado.startDate, endDate: fin };
}

/** Parte del rango que aún no ha llegado (a partir de mañana). */
export function partePosteriorAHoy(
  rango: RangoFechas,
  hoy: string
): RangoFechas | null {
  const normalizado = normalizaRango(rango);
  if (!normalizado) return null;
  if (normalizado.endDate <= hoy) return null;

  const manana = addDaysToDateKey(hoy, 1);
  if (!manana) return null;

  const inicio = normalizado.startDate > manana ? normalizado.startDate : manana;

  return inicio <= normalizado.endDate
    ? { startDate: inicio, endDate: normalizado.endDate }
    : null;
}

/** Ese día cuenta como vacaciones en modo laborable (L-V y no festivo). */
export function esDiaLaborable(fecha: string, config: AgendaConfig): boolean {
  const diaSemana = weekdayIndexMonFirst(fecha);

  // 0 = lunes … 4 = viernes. Sábado y domingo no cuentan nunca.
  if (diaSemana == null || diaSemana > 4) return false;

  return getHolidayForDate(config, fecha) == null;
}

/**
 * Días que suma un rango. Un rango de un solo día suma 1, no 0.
 *
 * El bucle avanza día a día porque en modo laborable hay que mirar cada fecha;
 * los rangos de ausencias son de días o semanas, no de años, así que el coste
 * es irrelevante. Aun así se corta a 5 años por si llega un dato corrupto.
 */
export function diasDelRango(
  rango: RangoFechas,
  modo: ModoVacaciones,
  config: AgendaConfig
): number {
  const normalizado = normalizaRango(rango);
  if (!normalizado) return 0;

  if (modo === "naturales") {
    return diasNaturalesDelRango(normalizado);
  }

  let total = 0;
  let fecha: string | null = normalizado.startDate;
  let guarda = 0;

  while (fecha && fecha <= normalizado.endDate && guarda < 366 * 5) {
    if (esDiaLaborable(fecha, config)) total += 1;
    fecha = addDaysToDateKey(fecha, 1);
    guarda += 1;
  }

  return total;
}

/** Días naturales de un rango, extremos incluidos. */
export function diasNaturalesDelRango(rango: RangoFechas): number {
  const normalizado = normalizaRango(rango);
  if (!normalizado) return 0;

  const inicio = Date.parse(`${normalizado.startDate}T00:00:00Z`);
  const fin = Date.parse(`${normalizado.endDate}T00:00:00Z`);

  if (Number.isNaN(inicio) || Number.isNaN(fin)) return 0;

  return Math.round((fin - inicio) / (24 * 60 * 60 * 1000)) + 1;
}

/**
 * Días que aporta un estado concreto. El modo laborable solo se aplica a
 * vacaciones; el resto de estados se cuentan siempre en días naturales.
 */
export function diasDelEstado(
  estado: { status: TechStatus; startDate: string; endDate: string },
  modo: ModoVacaciones,
  config: AgendaConfig
): number {
  const modoEfectivo: ModoVacaciones =
    estado.status === "vacaciones" ? modo : "naturales";

  return diasDelRango(estado, modoEfectivo, config);
}

export type DetalleAusencia = {
  id: string;
  status: TechStatus;
  /** Rango original, tal y como está guardado. */
  startDate: string;
  endDate: string;
  /** Rango recortado al año que se está mirando. */
  inicioEnAnio: string;
  finEnAnio: string;
  diasDisfrutados: number;
  diasProgramados: number;
  notes?: string;
};

export type ResumenTecnico = {
  techName: string;
  /** Cupo anual de vacaciones aplicado a este técnico. */
  cupo: number;
  vacacionesDisfrutadas: number;
  vacacionesProgramadas: number;
  /** cupo − disfrutadas − programadas. Negativo = se ha pasado del cupo. */
  vacacionesPendientes: number;
  /** Total por estado, incluidas las vacaciones. */
  porEstado: Record<string, number>;
  detalles: DetalleAusencia[];
};

export type Solape = {
  techName: string;
  a: DetalleAusencia;
  b: DetalleAusencia;
};

export type ConfigVacaciones = {
  modo: ModoVacaciones;
  diasPorDefecto: number;
  /** Cupo distinto para técnicos concretos (antigüedad, jornada parcial...). */
  diasPorTecnico?: Record<string, number>;
};

export function cupoDeTecnico(
  techName: string,
  config: ConfigVacaciones
): number {
  const propio = config.diasPorTecnico?.[techName];

  return typeof propio === "number" && Number.isFinite(propio)
    ? propio
    : config.diasPorDefecto;
}

/**
 * Resumen de un año para una lista de técnicos.
 *
 * `tecnicos` manda: se devuelve una fila por cada uno, aunque no tenga ninguna
 * ausencia, y se añaden al final los nombres que aparecen en los estados pero
 * ya no están en el plantel (alguien dado de baja a mitad de año sigue teniendo
 * su año contado).
 */
export function resumenPorTecnico(
  estados: ScheduledTechStatus[],
  tecnicos: string[],
  anio: number,
  configVacaciones: ConfigVacaciones,
  configAgenda: AgendaConfig,
  hoy: string
): ResumenTecnico[] {
  const porNombre = new Map<string, ScheduledTechStatus[]>();

  for (const estado of estados) {
    const nombre = String(estado?.techName || "").trim();
    if (!nombre) continue;
    if (!recortaAlAnio(estado, anio)) continue;

    const lista = porNombre.get(nombre) ?? [];
    lista.push(estado);
    porNombre.set(nombre, lista);
  }

  const nombres = [...tecnicos.map((n) => String(n || "").trim()).filter(Boolean)];

  for (const nombre of porNombre.keys()) {
    if (!nombres.includes(nombre)) nombres.push(nombre);
  }

  return nombres.map((techName) => {
    const propios = porNombre.get(techName) ?? [];
    const detalles: DetalleAusencia[] = [];

    const porEstado: Record<string, number> = {};

    let vacacionesDisfrutadas = 0;
    let vacacionesProgramadas = 0;

    for (const estado of propios) {
      const enAnio = recortaAlAnio(estado, anio);
      if (!enAnio) continue;

      const pasado = parteHastaHoy(enAnio, hoy);
      const futuro = partePosteriorAHoy(enAnio, hoy);

      const diasDisfrutados = pasado
        ? diasDelEstado(
            { ...estado, ...pasado },
            configVacaciones.modo,
            configAgenda
          )
        : 0;

      const diasProgramados = futuro
        ? diasDelEstado(
            { ...estado, ...futuro },
            configVacaciones.modo,
            configAgenda
          )
        : 0;

      const total = diasDisfrutados + diasProgramados;

      porEstado[estado.status] = (porEstado[estado.status] ?? 0) + total;

      if (estado.status === "vacaciones") {
        vacacionesDisfrutadas += diasDisfrutados;
        vacacionesProgramadas += diasProgramados;
      }

      detalles.push({
        id: estado.id,
        status: estado.status,
        startDate: estado.startDate,
        endDate: estado.endDate,
        inicioEnAnio: enAnio.startDate,
        finEnAnio: enAnio.endDate,
        diasDisfrutados,
        diasProgramados,
        notes: estado.notes,
      });
    }

    detalles.sort((a, b) => a.inicioEnAnio.localeCompare(b.inicioEnAnio));

    const cupo = cupoDeTecnico(techName, configVacaciones);

    return {
      techName,
      cupo,
      vacacionesDisfrutadas,
      vacacionesProgramadas,
      vacacionesPendientes: cupo - vacacionesDisfrutadas - vacacionesProgramadas,
      porEstado,
      detalles,
    };
  });
}

/**
 * Rangos del mismo técnico que se pisan. Nada impide crearlos, y sumarían dos
 * veces los mismos días: hay que enseñarlos, no corregirlos por nuestra cuenta.
 */
export function detectaSolapes(resumenes: ResumenTecnico[]): Solape[] {
  const solapes: Solape[] = [];

  for (const resumen of resumenes) {
    const { detalles } = resumen;

    for (let i = 0; i < detalles.length; i += 1) {
      for (let j = i + 1; j < detalles.length; j += 1) {
        const a = detalles[i];
        const b = detalles[j];

        if (a.inicioEnAnio <= b.finEnAnio && b.inicioEnAnio <= a.finEnAnio) {
          solapes.push({ techName: resumen.techName, a, b });
        }
      }
    }
  }

  return solapes;
}

/** Años con datos, más el año en curso, de más reciente a más antiguo. */
export function aniosConDatos(
  estados: ScheduledTechStatus[],
  anioActual: number
): number[] {
  const anios = new Set<number>([anioActual]);

  for (const estado of estados) {
    for (const fecha of [estado?.startDate, estado?.endDate]) {
      if (!esFechaValida(String(fecha || ""))) continue;
      const anio = Number(String(fecha).slice(0, 4));
      if (Number.isFinite(anio)) anios.add(anio);
    }
  }

  return [...anios].sort((a, b) => b - a);
}
