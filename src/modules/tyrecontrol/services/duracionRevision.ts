/**
 * Cuánto se tarda en hacer una revisión.
 *
 * El cronómetro ya existía y nadie lo veía: la APK guarda `inicio_at` al abrir
 * la revisión y, al cerrarla, `fin_at`, `duracion_seg`, `trabajo_seg`,
 * `pausa_seg` y `n_pausas`. Lo que faltaba era enseñarlo.
 *
 * ── Por qué la mayoría de las filas NO tienen duración ──────────────────────
 *
 * Porque la mayoría de las revisiones no las hace una persona. De las 11.159
 * revisiones completadas de esta instalación, 10.778 son del CheckPoint: el
 * arco mide al paso del vehículo y no hay nada que empiece ni que acabe. Esas
 * se quedan sin número y se dice por qué, en vez de poner un cero que parecería
 * una revisión instantánea.
 *
 * Y hay un puñado de revisiones antiguas de técnico, anteriores al cronómetro,
 * que tampoco lo tienen. Mismo trato: raya y motivo.
 *
 * ── Duración y trabajo no son lo mismo ──────────────────────────────────────
 *
 * `duracion_seg` es de punta a punta, pausas incluidas, y es lo que se pregunta
 * cuando se pregunta «cuánto ha tardado». `trabajo_seg` descuenta las pausas.
 * Mientras no haya pausas los dos números coinciden —hoy no hay ni una en toda
 * la base— así que el desglose solo se enseña cuando hay algo que desglosar.
 */

/** Los campos de cronómetro de una revisión, tal como vienen de la tabla. */
export interface TiempoRevision {
  duracion_seg?: number | null;
  trabajo_seg?: number | null;
  pausa_seg?: number | null;
  n_pausas?: number | null;
}

/**
 * Un número de segundos, dicho como lo diría una persona.
 *
 * Por debajo del minuto, segundos. Por encima, minutos y segundos, y se callan
 * los segundos cuando son cero: «3 min» y no «3 min 0 s». A partir de la hora,
 * horas y minutos: a esa escala el segundo no cambia ninguna decisión.
 *
 * Un valor que no es un número, es negativo o no existe devuelve raya. Un cero
 * sí se dice —«0 s»— porque es un dato, no una ausencia: significa que se abrió
 * y se cerró en el mismo segundo, y eso hay que poder verlo.
 */
export function duracionCorta(seg: number | null | undefined): string {
  if (seg == null || !Number.isFinite(seg) || seg < 0) return "—";
  const s = Math.round(seg);
  if (s < 60) return `${s} s`;
  if (s < 3600) {
    const min = Math.floor(s / 60);
    const resto = s % 60;
    return resto === 0 ? `${min} min` : `${min} min ${resto} s`;
  }
  const h = Math.floor(s / 3600);
  const min = Math.round((s % 3600) / 60);
  // Redondear los minutos puede dar 60: entonces es una hora más, no «2 h 60».
  if (min === 60) return `${h + 1} h`;
  return min === 0 ? `${h} h` : `${h} h ${min} min`;
}

/** ¿Hay cronómetro que enseñar? */
export function tieneDuracion(t: TiempoRevision | null | undefined): boolean {
  const d = t?.duracion_seg;
  return d != null && Number.isFinite(d) && d >= 0;
}

/**
 * Por qué esta revisión no tiene duración.
 *
 * Va en el `title` de la raya, para que nadie tenga que adivinar si falta el
 * dato o es que no existe. Son dos cosas distintas y la diferencia importa:
 * del arco no habrá número nunca, y de una revisión antigua lo habrá a partir
 * de la siguiente.
 */
export function motivoSinDuracion(esArco: boolean): string {
  return esArco
    ? "El CheckPoint mide al paso del vehículo: no hay una revisión que empiece y acabe."
    : "Revisión anterior al cronómetro de la APK, que empezó a guardarse después.";
}

/**
 * El desglose para la ficha: «2 min 14 s · 1 min 50 s de trabajo · 1 pausa».
 *
 * Devuelve `null` cuando no hay nada que desglosar, que es el caso normal: sin
 * pausas, el trabajo es la duración y repetirlo no añade nada.
 */
export function desglosePausas(t: TiempoRevision | null | undefined): string | null {
  const pausa = t?.pausa_seg;
  if (pausa == null || !Number.isFinite(pausa) || pausa <= 0) return null;
  const n = t?.n_pausas ?? 0;
  const cuantas = n === 1 ? "1 pausa" : `${n} pausas`;
  const trabajo = tieneDuracion(t) && t?.trabajo_seg != null
    ? `${duracionCorta(t.trabajo_seg)} de trabajo`
    : null;
  return [trabajo, `${cuantas} de ${duracionCorta(pausa)}`].filter(Boolean).join(" · ");
}

/** Lo que resume la cabecera de la lista. */
export interface ResumenDuracion {
  /** Cuántas de las filas cargadas llevan cronómetro. */
  cronometradas: number;
  /** La mediana de esas, en segundos. `null` si no hay ninguna. */
  medianaSeg: number | null;
}

/**
 * Cuántas revisiones de las que se ven están cronometradas, y cuánto duran.
 *
 * La MEDIANA y no la media, a propósito: una revisión que alguien dejó abierta
 * mientras se iba a comer arrastra la media y no dice nada de cómo se trabaja.
 * En esta instalación la más larga es de 21 minutos contra una mediana de 2.
 *
 * Se cuenta sobre las filas YA CARGADAS, igual que el resto de la cabecera, así
 * que no puede discrepar de lo que se ve en la tabla.
 */
export function resumenDuracion(filas: Array<TiempoRevision | null | undefined>): ResumenDuracion {
  const segundos = filas
    .filter(tieneDuracion)
    .map((f) => Math.round(f!.duracion_seg as number))
    .sort((a, b) => a - b);
  if (segundos.length === 0) return { cronometradas: 0, medianaSeg: null };
  const medio = Math.floor(segundos.length / 2);
  const mediana = segundos.length % 2 === 1
    ? segundos[medio]
    : Math.round((segundos[medio - 1] + segundos[medio]) / 2);
  return { cronometradas: segundos.length, medianaSeg: mediana };
}
