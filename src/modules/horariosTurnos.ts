import {
  getRangesForDate,
  isClosedDate,
  minutesToTime,
  timeToMinutes,
  weekdayIndexMonFirst,
  type AgendaConfig,
} from "./agendaConfig";

/**
 * Horarios y turnos de los empleados.
 *
 * ── Qué resuelve ────────────────────────────────────────────────────────────
 *
 * Hasta ahora la aplicación sabía cuándo abre el taller y cuándo falta alguien
 * (vacaciones, baja), pero no cuándo tenía que trabajar cada persona. Sin eso
 * no hay control posible desde el superadministrador: ni cuántos hay por
 * turno, ni quién entra a las seis.
 *
 * ── Las piezas ──────────────────────────────────────────────────────────────
 *
 * · Un TURNO es un nombre con uno o dos tramos horarios y los días de la
 *   semana en que se trabaja. «Noche 22:00–06:00» acaba al día siguiente y
 *   cuenta igual: ocho horas.
 * · El turno «Horario del taller» no se guarda: es el calendario de la agenda
 *   (Agenda → Configuración), con sus sábados y jornadas especiales. Es lo que
 *   tiene quien trabaja «como el taller».
 * · Una ASIGNACIÓN dice qué turno lleva un empleado desde una fecha. Fija: un
 *   turno. Rotativa: una secuencia de turnos, uno por semana, en bucle, con
 *   la semana en la que empieza por el primero.
 * · El calendario del taller manda: en un día cerrado nadie tiene turno, sea
 *   cual sea su asignación. Y una ausencia pisa el turno.
 *
 * Todo esto es lógica pura: las pantallas solo pintan lo que sale de aquí.
 */

export const TURNO_TALLER = "taller";

export type Tramo = { inicio: string; fin: string };

export type Turno = {
  id: string;
  nombre: string;
  tramos: Tramo[];
  /** 1 = lunes … 7 = domingo. */
  dias: number[];
  activo: boolean;
  orden?: number;
};

export type AsignacionHorario = {
  id?: string;
  employeeId: string;
  tipo: "fijo" | "rotativo";
  /** Un turno si es fijo; la secuencia si es rotativo. `TURNO_TALLER` vale. */
  turnoIds: string[];
  /** Lunes de la semana en la que se empieza por el primer turno (rotativo). */
  semanaInicio: string;
  /** Desde qué día vale esta asignación. La anterior sigue para antes. */
  vigenteDesde: string;
};

export type CeldaDia =
  | { tipo: "cerrado" }
  | { tipo: "libre" }
  | { tipo: "sin_horario" }
  | { tipo: "ausencia"; estado: string }
  | { tipo: "turno"; turnoId: string; nombre: string; tramos: Tramo[]; minutos: number; cruzaMedianoche: boolean };

const DIAS_LABORABLES = [1, 2, 3, 4, 5];
const MS_DIA = 86_400_000;

/** Minutos de un tramo. Si acaba antes de empezar, es que acaba al día siguiente. */
export function minutosDeTramo(t: Tramo): number {
  const a = timeToMinutes(t.inicio);
  const b = timeToMinutes(t.fin);
  if (a == null || b == null) return 0;
  return b > a ? b - a : b + 24 * 60 - a;
}

export function minutosDeTramos(tramos: Tramo[]): number {
  return tramos.reduce((total, t) => total + minutosDeTramo(t), 0);
}

export function cruzaMedianoche(tramos: Tramo[]): boolean {
  return tramos.some((t) => {
    const a = timeToMinutes(t.inicio);
    const b = timeToMinutes(t.fin);
    return a != null && b != null && b <= a;
  });
}

export function formatoHoras(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}

export function formatoTramos(tramos: Tramo[]): string {
  return tramos.map((t) => `${t.inicio}–${t.fin}`).join(" · ");
}

function fechaUtc(fecha: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fecha || "").trim());
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function aClave(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Lunes de la semana de esa fecha, como "YYYY-MM-DD". */
export function lunesDe(fecha: string): string | null {
  const d = fechaUtc(fecha);
  const idx = weekdayIndexMonFirst(fecha);
  if (!d || idx == null) return null;
  return aClave(new Date(d.getTime() - idx * MS_DIA));
}

export function sumarDias(fecha: string, dias: number): string | null {
  const d = fechaUtc(fecha);
  return d ? aClave(new Date(d.getTime() + dias * MS_DIA)) : null;
}

/** Los siete días de la semana que contiene la fecha, de lunes a domingo. */
export function diasDeLaSemana(fecha: string): string[] {
  const lunes = lunesDe(fecha);
  if (!lunes) return [];
  return Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i)!);
}

/** La asignación que vale en esa fecha: la última cuyo «desde» no la pasa. */
export function asignacionVigente(
  asignaciones: AsignacionHorario[],
  fecha: string
): AsignacionHorario | null {
  let mejor: AsignacionHorario | null = null;
  for (const a of asignaciones) {
    if (!a.vigenteDesde || a.vigenteDesde > fecha) continue;
    if (!mejor || a.vigenteDesde > mejor.vigenteDesde) mejor = a;
  }
  return mejor;
}

/**
 * Turno que toca en la semana de esa fecha. Rotativo: semanas enteras desde el
 * lunes de arranque, en bucle; antes del arranque se cuenta hacia atrás, para
 * que la secuencia sea la misma mirando el pasado.
 */
export function turnoDeLaSemana(asig: AsignacionHorario, fecha: string): string | null {
  const ids = asig.turnoIds.filter(Boolean);
  if (ids.length === 0) return null;
  if (asig.tipo === "fijo" || ids.length === 1) return ids[0];

  const lunes = lunesDe(fecha);
  const arranque = lunesDe(asig.semanaInicio || asig.vigenteDesde);
  const a = lunes && fechaUtc(lunes);
  const b = arranque && fechaUtc(arranque);
  if (!a || !b) return ids[0];

  const semanas = Math.round((a.getTime() - b.getTime()) / (7 * MS_DIA));
  const n = ids.length;
  return ids[((semanas % n) + n) % n];
}

/** Posición (1-based) del turno de esta semana dentro de la secuencia, para enseñar «semana 2 de 3». */
export function posicionEnLaSecuencia(asig: AsignacionHorario, fecha: string): { i: number; n: number } | null {
  if (asig.tipo !== "rotativo" || asig.turnoIds.length < 2) return null;
  const id = turnoDeLaSemana(asig, fecha);
  const n = asig.turnoIds.length;
  const lunes = lunesDe(fecha);
  const arranque = lunesDe(asig.semanaInicio || asig.vigenteDesde);
  const a = lunes && fechaUtc(lunes);
  const b = arranque && fechaUtc(arranque);
  if (!a || !b || id == null) return null;
  const semanas = Math.round((a.getTime() - b.getTime()) / (7 * MS_DIA));
  return { i: (((semanas % n) + n) % n) + 1, n };
}

function tramosDelTaller(config: AgendaConfig, fecha: string): Tramo[] {
  return getRangesForDate(config, fecha).map((r) => ({
    inicio: minutesToTime(r.start),
    fin: minutesToTime(r.end),
  }));
}

/**
 * Qué le toca a una persona un día concreto.
 *
 * Orden de las reglas, de más fuerte a más débil: la ausencia pisa todo; sin
 * asignación no se inventa nada; el taller cerrado cierra para todos; y
 * después, el turno que diga la asignación para esa semana.
 */
export function celdaDelDia({
  asignaciones,
  turnos,
  fecha,
  config,
  ausencia,
}: {
  asignaciones: AsignacionHorario[];
  turnos: Turno[];
  fecha: string;
  config: AgendaConfig;
  ausencia?: string | null;
}): CeldaDia {
  if (ausencia) return { tipo: "ausencia", estado: ausencia };

  const asig = asignacionVigente(asignaciones, fecha);
  if (!asig) return { tipo: "sin_horario" };

  if (isClosedDate(config, fecha)) return { tipo: "cerrado" };

  const turnoId = turnoDeLaSemana(asig, fecha);
  if (!turnoId) return { tipo: "sin_horario" };

  if (turnoId === TURNO_TALLER) {
    const tramos = tramosDelTaller(config, fecha);
    if (tramos.length === 0) return { tipo: "libre" };
    return {
      tipo: "turno",
      turnoId,
      nombre: "Taller",
      tramos,
      minutos: minutosDeTramos(tramos),
      cruzaMedianoche: false,
    };
  }

  const turno = turnos.find((t) => t.id === turnoId);
  if (!turno || !turno.activo) return { tipo: "sin_horario" };

  const idx = weekdayIndexMonFirst(fecha);
  const diaIso = idx == null ? 0 : idx + 1;
  const dias = turno.dias.length > 0 ? turno.dias : DIAS_LABORABLES;
  if (!dias.includes(diaIso)) return { tipo: "libre" };

  return {
    tipo: "turno",
    turnoId,
    nombre: turno.nombre,
    tramos: turno.tramos,
    minutos: minutosDeTramos(turno.tramos),
    cruzaMedianoche: cruzaMedianoche(turno.tramos),
  };
}

export type FilaSemana = {
  employeeId: string;
  nombre: string;
  centro: string | null;
  resumen: string;
  celdas: CeldaDia[];
  minutos: number;
};

/**
 * Una fila por persona para la semana de esa fecha.
 *
 * `ausenciaDe(employeeId, fecha)` la pone quien llama: las ausencias siguen
 * guardadas por nombre en la agenda y aquí no se sabe cómo se llama cada
 * persona en ella.
 */
export function filaDeLaSemana({
  empleado,
  asignaciones,
  turnos,
  fecha,
  config,
  ausenciaDe,
}: {
  empleado: { id: string; nombre: string; centro?: string | null };
  asignaciones: AsignacionHorario[];
  turnos: Turno[];
  fecha: string;
  config: AgendaConfig;
  ausenciaDe?: (employeeId: string, fecha: string) => string | null;
}): FilaSemana {
  const propias = asignaciones.filter((a) => a.employeeId === empleado.id);
  const dias = diasDeLaSemana(fecha);
  const celdas = dias.map((d) =>
    celdaDelDia({
      asignaciones: propias,
      turnos,
      fecha: d,
      config,
      ausencia: ausenciaDe?.(empleado.id, d) ?? null,
    })
  );
  const minutos = celdas.reduce((t, c) => t + (c.tipo === "turno" ? c.minutos : 0), 0);

  const asig = asignacionVigente(propias, dias[0] ?? fecha);
  let resumen = "sin horario";
  if (asig) {
    const pos = posicionEnLaSecuencia(asig, fecha);
    resumen = pos ? `rotativo · semana ${pos.i} de ${pos.n}` : "fijo";
  }

  return { employeeId: empleado.id, nombre: empleado.nombre, centro: empleado.centro ?? null, resumen, celdas, minutos };
}

/** Cuántas personas tienen turno cada día de la semana. */
export function personasEnTurnoPorDia(filas: FilaSemana[]): number[] {
  const n = filas[0]?.celdas.length ?? 7;
  return Array.from({ length: n }, (_, i) =>
    filas.filter((f) => f.celdas[i]?.tipo === "turno").length
  );
}

/** Errores de un turno antes de guardarlo. Vacío = correcto. */
export function validarTurno(t: Partial<Turno>): string[] {
  const errores: string[] = [];
  if (!String(t.nombre ?? "").trim()) errores.push("El turno necesita un nombre.");
  const tramos = (t.tramos ?? []).filter((x) => x.inicio || x.fin);
  if (tramos.length === 0) errores.push("Hace falta al menos un tramo horario.");
  for (const x of tramos) {
    if (timeToMinutes(x.inicio) == null || timeToMinutes(x.fin) == null) {
      errores.push(`Tramo «${x.inicio || "?"}–${x.fin || "?"}»: hora no válida.`);
    } else if (x.inicio === x.fin) {
      errores.push(`Tramo «${x.inicio}–${x.fin}»: empieza y acaba a la misma hora.`);
    }
  }
  if (tramos.length === 2) {
    const a = tramos[0];
    const b = tramos[1];
    const finA = timeToMinutes(a.fin);
    const iniB = timeToMinutes(b.inicio);
    if (finA != null && iniB != null && !cruzaMedianoche([a]) && iniB < finA) {
      errores.push("El segundo tramo empieza antes de que acabe el primero.");
    }
  }
  if (tramos.length > 2) errores.push("Como mucho dos tramos por turno.");
  if ((t.dias ?? []).some((d) => d < 1 || d > 7)) errores.push("Día de la semana no válido.");
  return errores;
}

/** Errores de una asignación antes de guardarla. Vacío = correcto. */
export function validarAsignacion(a: Partial<AsignacionHorario>): string[] {
  const errores: string[] = [];
  const ids = (a.turnoIds ?? []).filter(Boolean);
  if (ids.length === 0) errores.push("Elige al menos un turno.");
  if (a.tipo === "rotativo" && ids.length < 2) errores.push("Un horario rotativo necesita dos turnos o más.");
  if (!fechaUtc(a.vigenteDesde ?? "")) errores.push("Falta la fecha desde la que vale.");
  if (a.tipo === "rotativo" && !fechaUtc(a.semanaInicio ?? "")) {
    errores.push("Falta la semana en la que empieza por el primer turno.");
  }
  return errores;
}
