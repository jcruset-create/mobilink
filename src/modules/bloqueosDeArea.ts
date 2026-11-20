/**
 * Bloqueos por área en la agenda: «el jueves 26/11 por la mañana no se dan
 * citas de tacógrafo» (el técnico está de formación, el equipo de
 * calibración no está, etc.).
 *
 * Un bloqueo es una fecha, un área, una franja horaria y un motivo. Se guarda
 * en la configuración de la agenda junto a los festivos y las jornadas
 * especiales, y la agenda lo pinta en la columna del día y no deja guardar
 * una cita de esa área dentro de la franja. Lógica pura, probada aparte.
 */

export const AREAS_BLOQUEABLES = ["camion", "movil", "tacografo", "turismo", "mecanica"] as const;
export type AreaBloqueable = (typeof AREAS_BLOQUEABLES)[number];

export const ETIQUETA_AREA: Record<AreaBloqueable, string> = {
  camion: "Camión",
  movil: "Móvil",
  tacografo: "Tacógrafo",
  turismo: "Turismo",
  mecanica: "Mecánica",
};

export type BloqueoArea = {
  area: AreaBloqueable;
  /** 'YYYY-MM-DD' */
  date: string;
  /** 'HH:MM', inicio incluido. */
  start: string;
  /** 'HH:MM', fin excluido. */
  end: string;
  label: string;
};

function minutos(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

function esArea(v: unknown): v is AreaBloqueable {
  return (AREAS_BLOQUEABLES as readonly string[]).includes(String(v));
}

/** Lo que venga guardado, a bloqueos válidos: sin fecha, área u horas buenas, fuera. */
export function normalizarBloqueos(raw: unknown): BloqueoArea[] {
  if (!Array.isArray(raw)) return [];
  const vistos = new Set<string>();
  const lista: BloqueoArea[] = [];
  for (const item of raw) {
    const area = (item as any)?.area;
    const date = String((item as any)?.date ?? "").trim();
    const start = String((item as any)?.start ?? "").trim();
    const end = String((item as any)?.end ?? "").trim();
    if (!esArea(area) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const a = minutos(start);
    const b = minutos(end);
    if (a == null || b == null || b <= a) continue;
    const clave = `${area}|${date}|${start}|${end}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    lista.push({ area, date, start, end, label: String((item as any)?.label ?? "").trim() });
  }
  return lista.sort((x, y) => x.date.localeCompare(y.date) || x.start.localeCompare(y.start) || x.area.localeCompare(y.area));
}

export function bloqueosDelDia(bloqueos: BloqueoArea[], date: string): BloqueoArea[] {
  return bloqueos.filter((b) => b.date === date);
}

/**
 * El bloqueo que pisa una cita de `area` el día `date` entre `start` y `end`
 * (fin excluido), o null. Una cita que acaba justo cuando empieza el bloqueo,
 * o empieza justo cuando acaba, no choca.
 */
export function bloqueoQueChoca(
  bloqueos: BloqueoArea[],
  area: string,
  date: string,
  start: string,
  end: string
): BloqueoArea | null {
  const a = minutos(start);
  const b = minutos(end);
  if (a == null || b == null) return null;
  return (
    bloqueos.find((bl) => {
      if (bl.area !== area || bl.date !== date) return false;
      const x = minutos(bl.start)!;
      const y = minutos(bl.end)!;
      return a < y && b > x;
    }) ?? null
  );
}

/** «Tacógrafo bloqueado de 08:30 a 13:30: formación». */
export function textoDeBloqueo(b: BloqueoArea): string {
  const base = `${ETIQUETA_AREA[b.area]} bloqueado de ${b.start} a ${b.end}`;
  return b.label ? `${base}: ${b.label}` : base;
}

export function validarBloqueo(b: Partial<BloqueoArea>): string | null {
  if (!esArea(b.area)) return "Elige el área.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date ?? ""))) return "Elige la fecha.";
  const a = minutos(String(b.start ?? ""));
  const c = minutos(String(b.end ?? ""));
  if (a == null || c == null) return "Pon la hora de inicio y la de fin.";
  if (c <= a) return "La hora de fin tiene que ser posterior a la de inicio.";
  return null;
}
