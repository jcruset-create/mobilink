/**
 * El instante contractual, resuelto en la zona horaria del tarifario.
 *
 * Una franja "19:00–08:00" no significa nada sin decir dónde. Si se resolviera
 * en UTC, en verano español las 21:00 locales serían las 19:00 UTC y un
 * servicio diurno se facturaría como nocturno: 133 € de diferencia por
 * asistencia según el tarifario de referencia.
 *
 * Se resuelve con `Intl`, que conoce los cambios de hora de cada año. Sumar un
 * desfase fijo funciona once meses al año y falla los dos fines de semana que
 * más caro salen.
 *
 * Mismo enfoque que `getZonedDateTimeParts` en server/index.ts, del que esto
 * es hermano; aquí hace falta además el día de la semana.
 */

export interface InstanteLocal {
  /** AAAA-MM-DD en la zona pedida. */
  fecha: string;
  /** Minutos desde medianoche, 0..1439. */
  minutos: number;
  /** 1 = lunes … 7 = domingo (ISO). */
  diaSemana: number;
  /** Hora local en HH:MM, para las explicaciones. */
  hora: string;
}

const formateadores = new Map<string, Intl.DateTimeFormat>();

function formateador(zona: string): Intl.DateTimeFormat {
  let f = formateadores.get(zona);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zona,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
    formateadores.set(zona, f);
  }
  return f;
}

export function instanteLocal(ms: number, zona: string): InstanteLocal {
  const partes: Record<string, string> = {};
  for (const p of formateador(zona).formatToParts(new Date(ms))) {
    if (p.type !== "literal") partes[p.type] = p.value;
  }
  const fecha = `${partes.year}-${partes.month}-${partes.day}`;
  const minutos = Number(partes.hour) * 60 + Number(partes.minute);
  return {
    fecha,
    minutos,
    diaSemana: diaSemanaDe(fecha),
    hora: `${partes.hour}:${partes.minute}`,
  };
}

/**
 * Día de la semana de una fecha AAAA-MM-DD, en ISO (1 = lunes).
 *
 * Se construye en UTC a propósito: la fecha ya viene resuelta en la zona
 * correcta, y volver a pasarla por una zona horaria la desplazaría otra vez.
 */
export function diaSemanaDe(fecha: string): number {
  const [a, m, d] = fecha.split("-").map(Number);
  const dom0 = new Date(Date.UTC(a, m - 1, d)).getUTCDay(); // 0 = domingo
  return dom0 === 0 ? 7 : dom0;
}

/** Día anterior a una fecha AAAA-MM-DD. */
export function diaAnterior(fecha: string): string {
  const [a, m, d] = fecha.split("-").map(Number);
  const t = new Date(Date.UTC(a, m - 1, d));
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

/** "22:17" → 1337 minutos. Para cargar tarifarios y para las pruebas. */
export function minutosDeHora(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) throw new Error(`Hora no válida: ${hhmm}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`Hora fuera de rango: ${hhmm}`);
  return h * 60 + min;
}

/** 1337 → "22:17". */
export function horaDeMinutos(minutos: number): string {
  const h = Math.floor(minutos / 60) % 24;
  const m = minutos % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
