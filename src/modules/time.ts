export function nowMs(): number {
  return Date.now();
}

export function timeToMinutesValue(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function addMinutesToTime(time: string, minutes: number) {
  const total = timeToMinutesValue(time) + minutes;
  const h = Math.floor(total / 60);
  const m = total % 60;

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function nowTime(): string {
  return new Date().toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatClock(ms?: number | null): string {
  if (!ms) return "-";
  return new Date(ms).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatMinutes(minutes?: number | null): string {
  if (minutes == null || Number.isNaN(minutes)) return "-";
  const rounded = Math.round(minutes);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (h <= 0) return `${m} min`;
  return `${h} h ${m} min`;
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function isSameOrAfter(ms: number | undefined, compare: Date): boolean {
  if (!ms) return false;
  return ms >= compare.getTime();
}

export function getElapsedMinutes(
  startedAtMs?: number | null,
  endMs = nowMs()
): number | null {
  if (!startedAtMs) return null;
  return Math.max(0, Math.round((endMs - startedAtMs) / 60000));
}