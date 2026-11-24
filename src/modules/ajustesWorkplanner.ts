/**
 * Ajustes generales de WorkPlanner (pantalla Configuración → Tiempos y radios).
 *
 * Valores que estaban fijos en el código y que ahora se guardan en el
 * servidor. Cambian para todos los talleres. Lógica pura: lo que viene
 * guardado se normaliza aquí, con los mismos valores por defecto que tenía
 * el código, para que una base sin ajustes se comporte exactamente igual
 * que antes.
 */

export type AjustesWorkplanner = {
  /** Minutos de una cita cuando ni la persona ni la entrada rápida dicen otra cosa. */
  duracionCitaMin: number;
  /** Minutos sin tocar la tablet del taller hasta pedir PIN o Face ID. */
  bloqueoTabletMin: number;
  /** A menos de esto de un lugar (base, destino de una salida), «En punto». */
  radioLlegadaM: number;
  /** A más de esto del taller, la furgoneta «ha salido». */
  radioSalidaTallerM: number;
};

export const AJUSTES_POR_DEFECTO: AjustesWorkplanner = {
  duracionCitaMin: 45,
  bloqueoTabletMin: 5,
  radioLlegadaM: 300,
  radioSalidaTallerM: 500,
};

/** Tope de cada ajuste [mín, máx], para que un cero o un millón no rompan nada. */
export const LIMITES: Record<keyof AjustesWorkplanner, [number, number]> = {
  duracionCitaMin: [5, 600],
  bloqueoTabletMin: [1, 120],
  radioLlegadaM: [50, 5000],
  radioSalidaTallerM: [100, 10000],
};

function entero(v: unknown, porDefecto: number, [min, max]: [number, number]): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return porDefecto;
  return Math.min(max, Math.max(min, n));
}

/** Lo que haya guardado, a ajustes válidos. Lo que falte o esté mal, al valor de siempre. */
export function normalizarAjustes(raw: unknown): AjustesWorkplanner {
  const r = (raw ?? {}) as Partial<Record<keyof AjustesWorkplanner, unknown>>;
  const d = AJUSTES_POR_DEFECTO;
  return {
    duracionCitaMin: entero(r.duracionCitaMin, d.duracionCitaMin, LIMITES.duracionCitaMin),
    bloqueoTabletMin: entero(r.bloqueoTabletMin, d.bloqueoTabletMin, LIMITES.bloqueoTabletMin),
    radioLlegadaM: entero(r.radioLlegadaM, d.radioLlegadaM, LIMITES.radioLlegadaM),
    radioSalidaTallerM: entero(r.radioSalidaTallerM, d.radioSalidaTallerM, LIMITES.radioSalidaTallerM),
  };
}

/** Errores de lo tecleado en el formulario, para decirlos antes de guardar. */
export function validarAjustes(tecleado: Record<keyof AjustesWorkplanner, string | number>): string[] {
  const errores: string[] = [];
  const nombres: Record<keyof AjustesWorkplanner, string> = {
    duracionCitaMin: "La duración por defecto de una cita",
    bloqueoTabletMin: "El bloqueo por inactividad",
    radioLlegadaM: "El radio de llegada a un lugar",
    radioSalidaTallerM: "El radio de salida del taller",
  };
  for (const k of Object.keys(LIMITES) as (keyof AjustesWorkplanner)[]) {
    const n = Number(tecleado[k]);
    const [min, max] = LIMITES[k];
    if (!Number.isFinite(n) || String(tecleado[k]).trim() === "") errores.push(`${nombres[k]} tiene que ser un número.`);
    else if (n < min || n > max) errores.push(`${nombres[k]} tiene que estar entre ${min} y ${max}.`);
  }
  if (Number(tecleado.radioSalidaTallerM) <= Number(tecleado.radioLlegadaM)) {
    errores.push("El radio de salida del taller tiene que ser mayor que el radio de llegada.");
  }
  return errores;
}
