/**
 * Ajustes generales de WorkPlanner (pantalla Configuración → Tiempos y radios).
 *
 * Valores que estaban fijos en el código y que ahora se guardan en el
 * servidor. Cambian para todos los talleres. Lógica pura: lo que viene
 * guardado se normaliza aquí, con los mismos valores por defecto que tenía
 * el código, para que una base sin ajustes se comporte exactamente igual
 * que antes.
 */

export const AREAS_TALLER = ["camion", "movil", "tacografo", "turismo", "mecanica"] as const;
export type AreaTaller = (typeof AREAS_TALLER)[number];

export const ETIQUETA_AREA_TALLER: Record<AreaTaller, string> = {
  camion: "Camión",
  movil: "Móvil",
  tacografo: "Tacógrafo",
  turismo: "Turismo",
  mecanica: "Mecánica",
};

export type SonidoTv = "apagado" | "tono" | "voz";

export type BloquesTv = {
  recepciones: boolean;
  llegadas: boolean;
  validar: boolean;
  standby: boolean;
  cola: boolean;
};

export type AjustesWorkplanner = {
  /** Minutos de una cita cuando ni la persona ni la entrada rápida dicen otra cosa. */
  duracionCitaMin: number;
  /** Minutos sin tocar la tablet del taller hasta pedir PIN o Face ID. */
  bloqueoTabletMin: number;
  /** A menos de esto de un lugar (base, destino de una salida), «En punto». */
  radioLlegadaM: number;
  /** A más de esto del taller, la furgoneta «ha salido». */
  radioSalidaTallerM: number;

  // ── WhatsApp al cliente: lo que va marcado al crear una cita ──
  waAlGuardar: boolean;
  waRecordatorio24h: boolean;
  waRecordatorio1h: boolean;
  /** Caducidad de tacógrafo: días de antelación del primer y segundo aviso. */
  tacografoDiasAviso: number;
  tacografoDiasAviso2: number;

  // ── Pantalla técnicos ──
  tvSonido: SonidoTv;
  tvRefrescoSeg: number;
  tvBloques: BloquesTv;

  // ── Áreas ──
  /** Orden en que salen en Operativo 2 y en la Agenda. */
  areasOrden: AreaTaller[];
  /** Un área desactivada no sale para crear entradas ni citas. */
  areasActivas: Record<AreaTaller, boolean>;
  /** Móvil no se puede autorizar sin furgoneta. */
  movilExigeFurgoneta: boolean;
};

export const AJUSTES_POR_DEFECTO: AjustesWorkplanner = {
  duracionCitaMin: 45,
  bloqueoTabletMin: 5,
  radioLlegadaM: 300,
  radioSalidaTallerM: 500,
  waAlGuardar: true,
  waRecordatorio24h: true,
  waRecordatorio1h: true,
  tacografoDiasAviso: 15,
  tacografoDiasAviso2: 7,
  tvSonido: "apagado",
  tvRefrescoSeg: 20,
  tvBloques: { recepciones: true, llegadas: true, validar: true, standby: true, cola: true },
  areasOrden: [...AREAS_TALLER],
  areasActivas: { camion: true, movil: true, tacografo: true, turismo: true, mecanica: true },
  movilExigeFurgoneta: true,
};

type ClaveNumerica = "duracionCitaMin" | "bloqueoTabletMin" | "radioLlegadaM" | "radioSalidaTallerM" | "tacografoDiasAviso" | "tacografoDiasAviso2" | "tvRefrescoSeg";

/** Tope de cada ajuste numérico [mín, máx], para que un cero o un millón no rompan nada. */
export const LIMITES: Record<ClaveNumerica, [number, number]> = {
  duracionCitaMin: [5, 600],
  bloqueoTabletMin: [1, 120],
  radioLlegadaM: [50, 5000],
  radioSalidaTallerM: [100, 10000],
  tacografoDiasAviso: [1, 365],
  tacografoDiasAviso2: [0, 365],
  tvRefrescoSeg: [5, 300],
};

function entero(v: unknown, porDefecto: number, [min, max]: [number, number]): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return porDefecto;
  return Math.min(max, Math.max(min, n));
}

function booleano(v: unknown, porDefecto: boolean): boolean {
  return typeof v === "boolean" ? v : porDefecto;
}

function esArea(v: unknown): v is AreaTaller {
  return (AREAS_TALLER as readonly string[]).includes(String(v));
}

/** Un orden válido: las áreas que vengan (sin repetir) y, detrás, las que falten en su orden de siempre. */
export function ordenDeAreas(raw: unknown): AreaTaller[] {
  const vistas = new Set<AreaTaller>();
  const orden: AreaTaller[] = [];
  for (const a of Array.isArray(raw) ? raw : []) {
    if (esArea(a) && !vistas.has(a)) {
      vistas.add(a);
      orden.push(a);
    }
  }
  for (const a of AREAS_TALLER) if (!vistas.has(a)) orden.push(a);
  return orden;
}

/** Lo que haya guardado, a ajustes válidos. Lo que falte o esté mal, al valor de siempre. */
export function normalizarAjustes(raw: unknown): AjustesWorkplanner {
  const r = (raw ?? {}) as Partial<Record<keyof AjustesWorkplanner, any>>;
  const d = AJUSTES_POR_DEFECTO;
  const activas = { ...d.areasActivas };
  for (const a of AREAS_TALLER) activas[a] = booleano(r.areasActivas?.[a], true);
  // Nunca todas apagadas: sin áreas no se puede crear nada.
  if (!AREAS_TALLER.some((a) => activas[a])) for (const a of AREAS_TALLER) activas[a] = true;
  const bloques = { ...d.tvBloques };
  for (const k of Object.keys(bloques) as (keyof BloquesTv)[]) bloques[k] = booleano(r.tvBloques?.[k], true);
  const sonido = ["apagado", "tono", "voz"].includes(String(r.tvSonido)) ? (r.tvSonido as SonidoTv) : d.tvSonido;
  return {
    duracionCitaMin: entero(r.duracionCitaMin, d.duracionCitaMin, LIMITES.duracionCitaMin),
    bloqueoTabletMin: entero(r.bloqueoTabletMin, d.bloqueoTabletMin, LIMITES.bloqueoTabletMin),
    radioLlegadaM: entero(r.radioLlegadaM, d.radioLlegadaM, LIMITES.radioLlegadaM),
    radioSalidaTallerM: entero(r.radioSalidaTallerM, d.radioSalidaTallerM, LIMITES.radioSalidaTallerM),
    waAlGuardar: booleano(r.waAlGuardar, d.waAlGuardar),
    waRecordatorio24h: booleano(r.waRecordatorio24h, d.waRecordatorio24h),
    waRecordatorio1h: booleano(r.waRecordatorio1h, d.waRecordatorio1h),
    tacografoDiasAviso: entero(r.tacografoDiasAviso, d.tacografoDiasAviso, LIMITES.tacografoDiasAviso),
    tacografoDiasAviso2: entero(r.tacografoDiasAviso2, d.tacografoDiasAviso2, LIMITES.tacografoDiasAviso2),
    tvSonido: sonido,
    tvRefrescoSeg: entero(r.tvRefrescoSeg, d.tvRefrescoSeg, LIMITES.tvRefrescoSeg),
    tvBloques: bloques,
    areasOrden: ordenDeAreas(r.areasOrden),
    areasActivas: activas,
    movilExigeFurgoneta: booleano(r.movilExigeFurgoneta, d.movilExigeFurgoneta),
  };
}

/** Las áreas que se ofrecen para crear entradas y citas, en su orden. */
export function areasEnUso(a: Pick<AjustesWorkplanner, "areasOrden" | "areasActivas">): AreaTaller[] {
  return a.areasOrden.filter((x) => a.areasActivas[x]);
}

/** Errores de lo tecleado en el formulario de Tiempos y radios, para decirlos antes de guardar. */
export function validarAjustes(tecleado: Partial<Record<ClaveNumerica, string | number>>): string[] {
  const errores: string[] = [];
  const nombres: Record<ClaveNumerica, string> = {
    duracionCitaMin: "La duración por defecto de una cita",
    bloqueoTabletMin: "El bloqueo por inactividad",
    radioLlegadaM: "El radio de llegada a un lugar",
    radioSalidaTallerM: "El radio de salida del taller",
    tacografoDiasAviso: "El primer aviso de caducidad",
    tacografoDiasAviso2: "El segundo aviso de caducidad",
    tvRefrescoSeg: "El refresco de Pantalla técnicos",
  };
  for (const k of Object.keys(tecleado) as ClaveNumerica[]) {
    if (!(k in LIMITES)) continue;
    const n = Number(tecleado[k]);
    const [min, max] = LIMITES[k];
    if (!Number.isFinite(n) || String(tecleado[k]).trim() === "") errores.push(`${nombres[k]} tiene que ser un número.`);
    else if (n < min || n > max) errores.push(`${nombres[k]} tiene que estar entre ${min} y ${max}.`);
  }
  if (tecleado.radioSalidaTallerM != null && tecleado.radioLlegadaM != null && Number(tecleado.radioSalidaTallerM) <= Number(tecleado.radioLlegadaM)) {
    errores.push("El radio de salida del taller tiene que ser mayor que el radio de llegada.");
  }
  if (tecleado.tacografoDiasAviso != null && tecleado.tacografoDiasAviso2 != null && Number(tecleado.tacografoDiasAviso2) >= Number(tecleado.tacografoDiasAviso)) {
    errores.push("El segundo aviso de caducidad tiene que ir después del primero (menos días de antelación).");
  }
  return errores;
}
