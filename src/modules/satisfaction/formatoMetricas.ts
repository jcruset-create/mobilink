/**
 * Cómo se pinta cada cifra del cuadro de mando de satisfacción.
 *
 * Está fuera del componente por lo de siempre —el repositorio no tiene jsdom—
 * pero sobre todo porque aquí es donde se decide lo único que puede hacer daño
 * en una pantalla de métricas: **qué se enseña cuando no hay dato**.
 *
 * La regla, en una línea: *ausencia de dato nunca se pinta como cero*. Una
 * media de «0,0 ★» no existe (la escala empieza en 1) y un «0 %» de resolución
 * se lee como un desastre operativo. Ambos son mentiras distintas del mismo
 * error, así que `null` sale siempre como «Sin datos».
 */

/* ── Tipos que llegan del servidor ───────────────────────────────────────── */

export type Media = { media: number | null; respuestas: number };
export type Distribucion = { estrella: number; n: number; pct: number }[];

export type PuntoTendencia = {
  desdeMs: number;
  driver: Media;
  customer: Media;
  casos: number;
  criticos: number;
};

export type Granularidad = "dia" | "semana" | "mes";

/* ── Constantes de presentación ──────────────────────────────────────────── */

export const SIN_DATOS = "Sin datos";

/** Debajo de esto una media no se comenta: es ruido, no una señal. */
export const MUESTRA_MINIMA = 5;

export const ROL = { DRIVER: "Conductor", CUSTOMER: "Cliente" } as const;

/* ── Números ─────────────────────────────────────────────────────────────── */

/**
 * Una media de estrellas: `4.25` → `«4,25»`. Coma decimal, que es lo que se
 * lee en España, y dos decimales porque con muestras pequeñas un solo decimal
 * esconde el movimiento.
 */
export function formatearMedia(m: Media | null | undefined): string {
  if (!m || m.media == null || m.respuestas <= 0) return SIN_DATOS;
  return m.media.toFixed(2).replace(".", ",");
}

/** `12.5` → `«12,5 %»`; `null` → `«Sin datos»`. */
export function formatearPct(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return SIN_DATOS;
  return `${p.toFixed(1).replace(".", ",")} %`;
}

/** Un entero con separador de miles. El cero SÍ se pinta: aquí sí es un dato. */
export function formatearEntero(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return SIN_DATOS;
  return new Intl.NumberFormat("es-ES").format(Math.round(n));
}

/** «sobre 37 respuestas», o vacío si no hay ninguna. */
export function textoMuestra(m: Media | null | undefined): string {
  if (!m || m.respuestas <= 0) return "";
  return m.respuestas === 1 ? "sobre 1 respuesta" : `sobre ${formatearEntero(m.respuestas)} respuestas`;
}

/**
 * ¿Se puede sacar una conclusión de esta media?
 *
 * Con tres respuestas, un 3,0 y un 5,0 son el mismo dato. Se sigue enseñando
 * —esconderlo tampoco ayuda— pero marcado, para que nadie llame a un proveedor
 * a raíz de dos valoraciones.
 */
export function muestraSuficiente(m: Media | null | undefined): boolean {
  return !!m && m.respuestas >= MUESTRA_MINIMA;
}

/**
 * Duración larga en palabras: `9_000_000` → `«2 h 30 min»`.
 *
 * Los tiempos de gestión de un expediente van en horas y días, no en segundos.
 */
export function formatearDuracion(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return SIN_DATOS;
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const restoMin = min % 60;
  if (h < 24) return restoMin ? `${h} h ${restoMin} min` : `${h} h`;
  const d = Math.floor(h / 24);
  const restoH = h % 24;
  return restoH ? `${d} d ${restoH} h` : `${d} d`;
}

/* ── Barras ──────────────────────────────────────────────────────────────── */

/**
 * Anchos en porcentaje para un grupo de barras.
 *
 * Relativos al mayor del grupo, no al total: con cinco categorías donde la
 * mayor se lleva el 30 %, escalar sobre el total dejaría todas las barras
 * aplastadas contra la izquierda y no se compararía nada.
 *
 * Si todo vale cero, todas las barras salen a cero. Nada de dividir por cero
 * ni de repartir a partes iguales, que insinuaría un empate que no existe.
 */
export function anchosDeBarras(valores: number[]): number[] {
  const max = valores.reduce((m, v) => (Number.isFinite(v) && v > m ? v : m), 0);
  if (max <= 0) return valores.map(() => 0);
  return valores.map((v) => (Number.isFinite(v) && v > 0 ? Number(((v / max) * 100).toFixed(1)) : 0));
}

/**
 * La distribución de estrellas, siempre con las cinco filas.
 *
 * El servidor devuelve solo las estrellas que alguien votó. Si faltara la fila
 * del 1★ porque nadie puso un 1, la pantalla parecería tener una escala de
 * cuatro y el hueco pasaría desapercibido. Se rellenan a cero.
 */
export function distribucionCompleta(d: Distribucion | null | undefined): Distribucion {
  const porEstrella = new Map<number, { n: number; pct: number }>();
  for (const f of d ?? []) porEstrella.set(Number(f.estrella), { n: Number(f.n) || 0, pct: Number(f.pct) || 0 });
  return [5, 4, 3, 2, 1].map((estrella) => ({
    estrella,
    n: porEstrella.get(estrella)?.n ?? 0,
    pct: porEstrella.get(estrella)?.pct ?? 0,
  }));
}

/* ── Series temporales ───────────────────────────────────────────────────── */

export type PuntoSerie = {
  desdeMs: number;
  etiqueta: string;
  /** `null` cuando ese tramo no tuvo respuestas: se dibuja como hueco. */
  valor: number | null;
  respuestas: number;
  /** Altura en % dentro del área del gráfico. `0` si no hay valor. */
  altura: number;
};

export const ESCALA_ESTRELLAS = { min: 1, max: 5 };

/**
 * Convierte la tendencia en algo dibujable con CSS.
 *
 * Dos decisiones que importan:
 *
 *  · **La escala va de 1 a 5 fija**, no del mínimo al máximo de la serie.
 *    Autoescalar convierte un bajón de 4,7 a 4,5 en un precipicio visual.
 *  · **Los tramos sin respuestas son `null`**, no cero. Una semana de agosto
 *    sin encuestas no es una semana de valoraciones pésimas.
 */
export function construirSerie(
  puntos: PuntoTendencia[] | null | undefined,
  rol: "driver" | "customer",
  granularidad: Granularidad,
): PuntoSerie[] {
  const { min, max } = ESCALA_ESTRELLAS;
  return (puntos ?? []).map((p) => {
    const m = p[rol];
    const valor = m && m.respuestas > 0 && m.media != null ? m.media : null;
    const altura = valor == null
      ? 0
      : Number((((Math.min(max, Math.max(min, valor)) - min) / (max - min)) * 100).toFixed(1));
    return {
      desdeMs: p.desdeMs,
      etiqueta: etiquetaTramo(p.desdeMs, granularidad),
      valor,
      respuestas: m?.respuestas ?? 0,
      altura,
    };
  });
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** El nombre del tramo según lo que agrupe: un día, una semana o un mes. */
export function etiquetaTramo(ms: number, granularidad: Granularidad): string {
  const d = new Date(ms);
  const dia = d.getUTCDate();
  const mes = MESES[d.getUTCMonth()];
  if (granularidad === "mes") return `${mes} ${String(d.getUTCFullYear()).slice(2)}`;
  if (granularidad === "semana") return `sem. ${dia} ${mes}`;
  return `${dia} ${mes}`;
}

/** «del 1 ene al 30 ene 26», para el encabezado del periodo. */
export function etiquetaPeriodo(desdeMs: number, hastaMs: number): string {
  const a = new Date(desdeMs);
  const b = new Date(hastaMs);
  const corto = (d: Date) => `${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`;
  return `del ${corto(a)} al ${corto(b)} ${String(b.getUTCFullYear()).slice(2)}`;
}

/* ── Textos de contexto ──────────────────────────────────────────────────── */

/**
 * Qué decir de la tasa de respuesta.
 *
 * Mientras no se haya entregado ni una encuesta, la tasa no mide nada: el
 * denominador son encuestas que nadie ha mandado. Se enseña el motivo que
 * manda el servidor en vez de un porcentaje que se leería como rendimiento.
 */
export function textoTasaRespuesta(
  tasaPct: number | null | undefined,
  envio: { hayEntregas: boolean; motivo: string | null } | null | undefined,
): { valor: string; nota: string | null } {
  if (!envio?.hayEntregas || tasaPct == null) {
    return { valor: SIN_DATOS, nota: envio?.motivo ?? null };
  }
  return { valor: formatearPct(tasaPct), nota: null };
}

/** «3,4 casos por cada 100 respuestas» — o nada si no hay denominador. */
export function textoPorCada100(n: number | null | undefined, unidad: string): string {
  if (n == null || !Number.isFinite(n)) return SIN_DATOS;
  return `${n.toFixed(1).replace(".", ",")} por cada 100 ${unidad}`;
}

/**
 * El bloque de daños, redactado sin dar nada por hecho.
 *
 * `alegados` es lo que dijo quien contestó; `confirmados` es lo que decidió un
 * supervisor al cerrar. Juntarlos en un solo número —«Daños: 12»— convertiría
 * doce quejas en doce culpas.
 */
export function textoDanos(d: {
  alegados: number; confirmados: number; descartados: number; sinCerrar: number;
} | null | undefined): { etiqueta: string; valor: string }[] {
  const x = d ?? { alegados: 0, confirmados: 0, descartados: 0, sinCerrar: 0 };
  return [
    { etiqueta: "Daños alegados", valor: formatearEntero(x.alegados) },
    { etiqueta: "Confirmados tras revisión", valor: formatearEntero(x.confirmados) },
    { etiqueta: "Descartados tras revisión", valor: formatearEntero(x.descartados) },
    { etiqueta: "Pendientes de cerrar", valor: formatearEntero(x.sinCerrar) },
  ];
}
