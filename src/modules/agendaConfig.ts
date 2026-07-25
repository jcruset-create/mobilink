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

export type AgendaHoliday = {
  /** Fecha en formato 'YYYY-MM-DD'. */
  date: string;
  /** Motivo del festivo (p. ej. "Diada de Catalunya"). */
  label: string;
  /** Se repite cada año en el mismo día y mes. */
  yearly: boolean;
};

/** Día concreto con un horario distinto al de su día de la semana. */
export type AgendaSpecialDay = AgendaDaySchedule & {
  date: string;
  label: string;
  /** Se repite cada año en el mismo día y mes. */
  yearly: boolean;
};

export type AgendaConfig = {
  /** Índice 0 = lunes … 5 = sábado (la agenda no muestra domingos). */
  days: AgendaDaySchedule[];
  /** Días festivos en los que el taller cierra. */
  holidays: AgendaHoliday[];
  /** Jornadas especiales (p. ej. 24/12 de 8:30 a 14:00). */
  specialDays: AgendaSpecialDay[];
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
  specialDays: [],
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

// Ausente → valor por defecto; cadena vacía explícita → turno desactivado.
function pickTime(value: unknown, def: string) {
  if (value == null) return def;
  const text = String(value).trim();
  if (text === "") return "";
  return timeToMinutes(text) != null ? text : def;
}

export function normalizeAgendaConfig(raw: any): AgendaConfig {
  const base = DEFAULT_AGENDA_CONFIG;
  const rawDays = Array.isArray(raw?.days) ? raw.days : [];

  const days = base.days.map((fallback, index) => {
    const day = rawDays[index] ?? {};
    return {
      closed: day.closed === true,
      morningStart: pickTime(day.morningStart, fallback.morningStart),
      morningEnd: pickTime(day.morningEnd, fallback.morningEnd),
      afternoonStart: pickTime(day.afternoonStart, fallback.afternoonStart),
      afternoonEnd: pickTime(day.afternoonEnd, fallback.afternoonEnd),
    };
  });

  const seenSpecial = new Set<string>();
  const specialDays: AgendaSpecialDay[] = (
    Array.isArray(raw?.specialDays) ? raw.specialDays : []
  )
    .map((item: any): AgendaSpecialDay | null => {
      const date = String(item?.date ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

      const weekday = weekdayIndexMonFirst(date);
      const fallback = days[weekday ?? 0] ?? base.days[0];

      return {
        date,
        label: String(item?.label ?? "").trim(),
        yearly: item?.yearly === true,
        closed: item?.closed === true,
        morningStart: pickTime(item?.morningStart, fallback.morningStart),
        morningEnd: pickTime(item?.morningEnd, fallback.morningEnd),
        afternoonStart: pickTime(item?.afternoonStart, ""),
        afternoonEnd: pickTime(item?.afternoonEnd, ""),
      };
    })
    .filter((item: AgendaSpecialDay | null): item is AgendaSpecialDay => {
      if (!item) return false;
      if (seenSpecial.has(item.date)) return false;
      seenSpecial.add(item.date);
      return true;
    })
    .sort((a: AgendaSpecialDay, b: AgendaSpecialDay) => a.date.localeCompare(b.date));

  // Acepta el formato antiguo (array de fechas) y el actual (objetos con
  // motivo y repetición anual).
  const seen = new Set<string>();
  const holidays: AgendaHoliday[] = (Array.isArray(raw?.holidays) ? raw.holidays : [])
    .map((item: any): AgendaHoliday | null => {
      const date = String(typeof item === "string" ? item : item?.date ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
      return {
        date,
        label: String(typeof item === "string" ? "" : item?.label ?? "").trim(),
        yearly: typeof item === "string" ? false : item?.yearly === true,
      };
    })
    .filter((item: AgendaHoliday | null): item is AgendaHoliday => {
      if (!item) return false;
      if (seen.has(item.date)) return false;
      seen.add(item.date);
      return true;
    })
    .sort((a: AgendaHoliday, b: AgendaHoliday) => a.date.localeCompare(b.date));

  return {
    days,
    holidays,
    specialDays,
    closedSaturdaysInAugust: raw?.closedSaturdaysInAugust !== false,
  };
}

/**
 * Jornada especial que aplica a esa fecha: coincidencia exacta, o mismo día y
 * mes si está marcada como anual. Devuelve null si no hay ninguna.
 */
export function getSpecialDayForDate(
  config: AgendaConfig,
  date: string
): AgendaSpecialDay | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return null;

  const monthDay = date.slice(5);

  return (
    (config.specialDays ?? []).find(
      (special) =>
        special.date === date ||
        (special.yearly && special.date.slice(5) === monthDay && special.date <= date)
    ) ?? null
  );
}

/** Horario aplicable a una fecha concreta: la jornada especial si la hay. */
export function getScheduleForDate(
  config: AgendaConfig,
  date: string
): AgendaDaySchedule | null {
  const special = getSpecialDayForDate(config, date);
  if (special) return special;

  const index = weekdayIndexMonFirst(date);
  if (index == null || index === 6) return null;

  return config.days[index] ?? null;
}

/**
 * Festivo que aplica a esa fecha: coincidencia exacta, o mismo día y mes si
 * está marcado como repetición anual. Devuelve null si no hay ninguno.
 */
export function getHolidayForDate(
  config: AgendaConfig,
  date: string
): AgendaHoliday | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return null;

  const monthDay = date.slice(5);

  return (
    config.holidays.find(
      (holiday) =>
        holiday.date === date ||
        (holiday.yearly && holiday.date.slice(5) === monthDay && holiday.date <= date)
    ) ?? null
  );
}

/**
 * Si un festivo cae en viernes, propone hacer puente cerrando también el
 * sábado siguiente. Devuelve null si no es viernes o si ese sábado ya está
 * cerrado (festivo, día cerrado o sábado de agosto).
 *
 * El puente se propone siempre como fecha concreta, nunca anual: el año que
 * viene ese festivo caerá en otro día de la semana.
 */
export function getBridgeSaturday(
  config: AgendaConfig,
  holidayDate: string
): string | null {
  if (weekdayIndexMonFirst(holidayDate) !== 4) return null;

  const saturday = addDaysToDateKey(holidayDate, 1);
  if (!saturday) return null;

  return isClosedDate(config, saturday) ? null : saturday;
}

export type BridgeStatus =
  /** El festivo no cae en viernes: no aplica. */
  | { state: "none" }
  /** Cae en viernes y el sábado sigue abierto: se puede hacer puente. */
  | { state: "pending"; saturday: string }
  /** Cae en viernes y el sábado ya está cerrado. */
  | { state: "done"; saturday: string };

/** Estado del puente de un festivo que cae en viernes. */
export function getFridayBridgeStatus(
  config: AgendaConfig,
  holidayDate: string
): BridgeStatus {
  if (weekdayIndexMonFirst(holidayDate) !== 4) return { state: "none" };

  const saturday = addDaysToDateKey(holidayDate, 1);
  if (!saturday) return { state: "none" };

  return isClosedDate(config, saturday)
    ? { state: "done", saturday }
    : { state: "pending", saturday };
}

/** Suma días a una fecha 'YYYY-MM-DD' (aritmética UTC, sin efectos de DST). */
export function addDaysToDateKey(dateKey: string, days: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || "").trim());
  if (!match) return null;

  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const next = new Date(utc + days * 24 * 60 * 60 * 1000);

  const y = next.getUTCFullYear();
  const m = String(next.getUTCMonth() + 1).padStart(2, "0");
  const d = String(next.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** El taller está cerrado ese día concreto (festivo, día cerrado o sábado de agosto). */
export function isClosedDate(config: AgendaConfig, date: string): boolean {
  if (getHolidayForDate(config, date)) return true;

  // Una jornada especial manda sobre el horario semanal (también para abrir un
  // día que normalmente estaría cerrado).
  const special = getSpecialDayForDate(config, date);
  if (special) return special.closed;

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
  return getScheduleRanges(config.days[dayIndex] ?? null);
}

/** Franjas [inicio, fin) laborables de un horario, en minutos. */
export function getScheduleRanges(
  day: AgendaDaySchedule | null
): { start: number; end: number }[] {
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

/**
 * Franjas laborables aplicables a una fecha: usa la jornada especial si la hay
 * y, si no, el horario de ese día de la semana.
 */
export function getRangesForDate(
  config: AgendaConfig,
  date: string
): { start: number; end: number }[] {
  return getScheduleRanges(getScheduleForDate(config, date));
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

/** Igual que isWorkingTime pero teniendo en cuenta las jornadas especiales. */
export function isWorkingTimeForDate(
  config: AgendaConfig,
  date: string,
  time: string
): boolean {
  const minutes = timeToMinutes(time);
  if (minutes == null) return false;

  return getRangesForDate(config, date).some(
    (range) => minutes >= range.start && minutes < range.end
  );
}

function isLunchInRanges(
  ranges: { start: number; end: number }[],
  time: string
): boolean {
  if (ranges.length < 2) return false;

  const minutes = timeToMinutes(time);
  if (minutes == null) return false;

  return minutes >= ranges[0].end && minutes < ranges[1].start;
}

/** Descanso entre el turno de mañana y el de tarde (mediodía). */
export function isLunchTime(
  config: AgendaConfig,
  dayIndex: number,
  time: string
): boolean {
  return isLunchInRanges(getDayRanges(config, dayIndex), time);
}

/** Igual que isLunchTime pero teniendo en cuenta las jornadas especiales. */
export function isLunchTimeForDate(
  config: AgendaConfig,
  date: string,
  time: string
): boolean {
  return isLunchInRanges(getRangesForDate(config, date), time);
}

export function getDayStart(config: AgendaConfig, dayIndex: number): number {
  const ranges = getDayRanges(config, dayIndex);
  return ranges.length ? ranges[0].start : 0;
}

export function getDayEnd(config: AgendaConfig, dayIndex: number): number {
  const ranges = getDayRanges(config, dayIndex);
  return ranges.length ? ranges[ranges.length - 1].end : 0;
}

export function getDayStartForDate(config: AgendaConfig, date: string): number {
  const ranges = getRangesForDate(config, date);
  return ranges.length ? ranges[0].start : 0;
}

export function getDayEndForDate(config: AgendaConfig, date: string): number {
  const ranges = getRangesForDate(config, date);
  return ranges.length ? ranges[ranges.length - 1].end : 0;
}

/**
 * Límites de la rejilla común a todas las columnas: desde el primer inicio
 * hasta el último fin (incluidas las jornadas especiales), para que los días
 * queden alineados con la columna de horas.
 */
export function getGridBounds(config: AgendaConfig): { start: number; end: number } {
  const starts: number[] = [];
  const ends: number[] = [];

  const collect = (ranges: { start: number; end: number }[]) => {
    if (!ranges.length) return;
    starts.push(ranges[0].start);
    ends.push(ranges[ranges.length - 1].end);
  };

  config.days.forEach((_, index) => collect(getDayRanges(config, index)));
  (config.specialDays ?? []).forEach((special) => collect(getScheduleRanges(special)));

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

  (config.specialDays ?? []).forEach((special) => {
    if (special.closed) return;

    const label = special.label || special.date;

    if (!getScheduleRanges(special).length) {
      errors.push(`Jornada especial ${label}: falta un horario válido.`);
    }
  });

  return errors;
}
