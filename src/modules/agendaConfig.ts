// Configuración de la agenda: horario semanal, festivos y cierres especiales.
// Lógica pura (sin React ni red) para poder probarla de forma aislada.

export type AgendaDaySchedule = {
  /** Día cerrado por completo (no editable en la agenda). */
  closed: boolean;
  /** "HH:MM"; cadena vacía en morningStart/morningEnd desactiva el turno. */
  morningStart: string;
  morningEnd: string;
  afternoonStart: string;
  afternoonEnd: string;
};

export type AgendaConfig = {
  /** Índice 0 = lunes … 5 = sábado (la agenda no muestra domingos). */
  days: AgendaDaySchedule[];
  /** Festivos concretos en formato 'YYYY-MM-DD'. */
  holidays: string[];
  /** Cierre recurrente de los sábados de agosto. */
  closedSaturdaysInAugust: boolean;
};

export const AGENDA_DAY_LABELS = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];

// Horario histórico del taller, usado mientras no se guarde otra configuración.
export const DEFAULT_AGENDA_CONFIG: AgendaConfig = {
  days: [
    { closed: false, morningStart: "08:30", morningEnd: "13:30", afternoonStart: "15:00", afternoonEnd: "18:30" },
    { closed: false, morningStart: "08:30", morningEnd: "13:30", afternoonStart: "15:00", afternoonEnd: "18:30" },
    { closed: false, morningStart: "08:30", morningEnd: "13:30", afternoonStart: "15:00", afternoonEnd: "18:30" },
    { closed: false, morningStart: "08:30", morningEnd: "13:30", afternoonStart: "15:00", afternoonEnd: "18:30" },
    { closed: false, morningStart: "08:30", morningEnd: "13:30", afternoonStart: "15:00", afternoonEnd: "18:30" },
    { closed: false, morningStart: "09:00", morningEnd: "13:00", afternoonStart: "", afternoonEnd: "" },
  ],
  holidays: [],
  closedSaturdaysInAugust: true,
};

export function timeToMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(time || "").trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Índice de día con lunes=0 … domingo=6, a partir de "YYYY-MM-DD". */
export function weekdayIndexMonFirst(dateStr: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || "").trim());
  if (!match) return null;
  const g = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  ).getUTCDay(); // 0=domingo … 6=sábado
  return (g + 6) % 7;
}

export function normalizeAgendaConfig(raw: any): AgendaConfig {
  const base = DEFAULT_AGENDA_CONFIG;
  const rawDays = Array.isArray(raw?.days) ? raw.days : [];

  const days = base.days.map((fallback, index) => {
    const day = rawDays[index] ?? {};
    const pick = (value: unknown, def: string) => {
      // Ausente → valor por defecto; cadena vacía explícita → turno desactivado.
      if (value == null) return def;
      const text = String(value).trim();
      if (text === "") return "";
      return timeToMinutes(text) != null ? text : def;
    };
    return {
      closed: day.closed === true,
      morningStart: pick(day.morningStart, fallback.morningStart),
      morningEnd: pick(day.morningEnd, fallback.morningEnd),
      afternoonStart: pick(day.afternoonStart, fallback.afternoonStart),
      afternoonEnd: pick(day.afternoonEnd, fallback.afternoonEnd),
    };
  });

  const holidays: string[] = Array.isArray(raw?.holidays)
    ? Array.from(
        new Set<string>(
          raw.holidays
            .map((d: unknown) => String(d ?? "").trim())
            .filter((d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d))
        )
      ).sort()
    : [];

  return {
    days,
    holidays,
    closedSaturdaysInAugust: raw?.closedSaturdaysInAugust !== false,
  };
}

/** El taller está cerrado ese día concreto (festivo, día cerrado o sábado de agosto). */
export function isClosedDate(config: AgendaConfig, date: string): boolean {
  if (config.holidays.includes(date)) return true;

  const index = weekdayIndexMonFirst(date);
  if (index == null) return false;

  // Domingo: la agenda no lo muestra, pero por seguridad se considera cerrado.
  if (index === 6) return true;
  if (config.days[index]?.closed) return true;

  if (config.closedSaturdaysInAugust && index === 5) {
    const month = date.split("-")[1];
    if (month === "08") return true;
  }

  return false;
}

/** Franjas [inicio, fin) laborables de un día de la semana, en minutos. */
export function getDayRanges(
  config: AgendaConfig,
  dayIndex: number
): { start: number; end: number }[] {
  const day = config.days[dayIndex];
  if (!day || day.closed) return [];

  const ranges: { start: number; end: number }[] = [];
  const add = (from: string, to: string) => {
    const start = timeToMinutes(from);
    const end = timeToMinutes(to);
    if (start != null && end != null && end > start) ranges.push({ start, end });
  };

  add(day.morningStart, day.morningEnd);
  add(day.afternoonStart, day.afternoonEnd);

  return ranges;
}

/** Hora dentro del horario laborable de ese día de la semana. */
export function isWorkingTime(
  config: AgendaConfig,
  dayIndex: number,
  time: string
): boolean {
  const minutes = timeToMinutes(time);
  if (minutes == null) return false;

  return getDayRanges(config, dayIndex).some(
    (range) => minutes >= range.start && minutes < range.end
  );
}

/** Descanso entre el turno de mañana y el de tarde (mediodía). */
export function isLunchTime(
  config: AgendaConfig,
  dayIndex: number,
  time: string
): boolean {
  const ranges = getDayRanges(config, dayIndex);
  if (ranges.length < 2) return false;

  const minutes = timeToMinutes(time);
  if (minutes == null) return false;

  return minutes >= ranges[0].end && minutes < ranges[1].start;
}

export function getDayStart(config: AgendaConfig, dayIndex: number): number {
  const ranges = getDayRanges(config, dayIndex);
  return ranges.length ? ranges[0].start : 0;
}

export function getDayEnd(config: AgendaConfig, dayIndex: number): number {
  const ranges = getDayRanges(config, dayIndex);
  return ranges.length ? ranges[ranges.length - 1].end : 0;
}

/**
 * Límites de la rejilla común a todas las columnas: desde el primer inicio
 * hasta el último fin de la semana, para que los días queden alineados con la
 * columna de horas.
 */
export function getGridBounds(config: AgendaConfig): { start: number; end: number } {
  const starts: number[] = [];
  const ends: number[] = [];

  config.days.forEach((_, index) => {
    const ranges = getDayRanges(config, index);
    if (!ranges.length) return;
    starts.push(ranges[0].start);
    ends.push(ranges[ranges.length - 1].end);
  });

  if (!starts.length) return { start: 8 * 60 + 30, end: 18 * 60 + 45 };

  return { start: Math.min(...starts), end: Math.max(...ends) };
}

export function getGridSlots(config: AgendaConfig, slotMinutes: number): string[] {
  const { start, end } = getGridBounds(config);
  const slots: string[] = [];
  for (let t = start; t < end; t += slotMinutes) slots.push(minutesToTime(t));
  return slots;
}

/** Valida una configuración antes de guardarla; devuelve la lista de errores. */
export function validateAgendaConfig(config: AgendaConfig): string[] {
  const errors: string[] = [];

  config.days.forEach((day, index) => {
    if (day.closed) return;

    const label = AGENDA_DAY_LABELS[index] ?? `Día ${index + 1}`;
    const ranges = getDayRanges(config, index);

    if (!ranges.length) {
      errors.push(`${label}: falta un horario válido (o márcalo como cerrado).`);
      return;
    }

    if (ranges.length === 2 && ranges[1].start < ranges[0].end) {
      errors.push(`${label}: el turno de tarde empieza antes de acabar el de mañana.`);
    }
  });

  return errors;
}
