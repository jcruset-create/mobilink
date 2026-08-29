/**
 * Elegir partner: puntuación explicada.
 *
 * ── Qué problema resuelve ───────────────────────────────────────────────────
 *
 * `acuerdos/dominio.ts` contesta QUIÉN PUEDE. Esto contesta A QUIÉN SE MANDA,
 * que es otra pregunta: entre cinco que pueden, uno está más cerca, otro es
 * más barato, otro acepta antes y otro no ha fallado nunca. Elegir es ponderar
 * esas cosas, y ponderarlas es una decisión de negocio que cambia por central:
 * a una le importa el precio y a otra el tiempo de llegada.
 *
 * ── Por qué se explica y no solo se ordena ──────────────────────────────────
 *
 * Un número del 0 al 100 sin desglose no se puede discutir. Cuando el
 * responsable pregunte por qué se mandó al segundo más caro, la respuesta
 * tiene que ser «porque llegaba 40 minutos antes y el primero había fallado
 * dos veces este mes», no «lo dijo el algoritmo». Por eso cada criterio
 * devuelve su nota y su peso, y el motivo se compone de los dos criterios que
 * más pesaron.
 *
 * ── Por qué es código puro ──────────────────────────────────────────────────
 *
 * Ni base de datos ni red: entra una lista de candidatos con sus números y
 * sale ordenada. Así el motor se prueba con casos concretos —el barato lejos
 * contra el caro cerca— en vez de sembrando media base. Y por eso mismo no
 * está en el frontend: la pantalla enseña el orden, no lo calcula, o cada
 * cliente ordenaría distinto.
 */

/** Lo que se sabe de un candidato en el momento de elegir. */
export type Medidas = {
  /** Distancia hasta el punto, en km. `null` = no se ha podido calcular. */
  distanciaKm: number | null;
  /** Precio estimado con la tarifa pactada. `null` = sin tarifa. */
  precio: number | null;
  /** SLA de llegada comprometido en el acuerdo, en minutos. */
  slaLlegadaMin: number | null;
  /** 0..1 — de cuántos encargos aceptó. */
  ratioAceptacion: number | null;
  /** Minutos medios en contestar. */
  tiempoAceptacionMin: number | null;
  /** 0..100 — la nota de calidad, misma escala que el score de talleres. */
  calidad: number | null;
  /** Servicios terminados en la ventana: mide el rodaje, no la calidad. */
  volumen: number;
  /** Incidencias por cada 100 servicios. */
  incidenciasPor100: number | null;
  /** Marcado como preferente en el acuerdo. */
  preferente: boolean;
};

export const MEDIDAS_VACIAS: Medidas = {
  distanciaKm: null, precio: null, slaLlegadaMin: null, ratioAceptacion: null,
  tiempoAceptacionMin: null, calidad: null, volumen: 0, incidenciasPor100: null,
  preferente: false,
};

export const CRITERIOS = [
  "distancia", "precio", "sla", "aceptacion", "rapidez", "calidad", "historial", "preferencia",
] as const;

export type Criterio = (typeof CRITERIOS)[number];

export type Pesos = Record<Criterio, number>;

/**
 * Reparto por defecto.
 *
 * Llegar pronto pesa más que costar poco, y es una postura, no un descuido:
 * en asistencia en carretera hay alguien esperando en el arcén, y veinte euros
 * de diferencia no valen media hora más de espera. Una central que opine lo
 * contrario cambia los pesos; para eso son configurables.
 */
export const PESOS_POR_DEFECTO: Pesos = {
  distancia: 25,
  sla: 15,
  aceptacion: 15,
  calidad: 15,
  precio: 12,
  rapidez: 8,
  historial: 5,
  preferencia: 5,
};

export function normalizarPesos(entrada: unknown): Pesos {
  let o: any = entrada;
  if (typeof entrada === "string") { try { o = JSON.parse(entrada); } catch { o = null; } }
  if (!o || typeof o !== "object") return { ...PESOS_POR_DEFECTO };
  const p = { ...PESOS_POR_DEFECTO };
  for (const c of CRITERIOS) {
    const v = Number(o[c]);
    // Un peso negativo invertiría el criterio sin decirlo: se ignora.
    if (Number.isFinite(v) && v >= 0) p[c] = v;
  }
  return p;
}

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }

/**
 * Nota de cada criterio, de 0 a 1.
 *
 * El neutro cuando falta el dato es 0,6 y no 0 ni 1: un partner del que no
 * sabemos el precio no puede ganar por barato ni perder por caro. Con 0 se
 * hundiría cualquier partner nuevo y el sistema no lo probaría nunca; con 1
 * ganaría siempre justo por no tener historial.
 */
const NEUTRO = 0.6;

export type Notas = Record<Criterio, number>;

export function notasDe(m: Medidas, referencia: { precioMedio: number | null }): Notas {
  return {
    // 0 km → 1; 100 km → 0. Más allá de 100 km ya es un viaje, no una diferencia.
    distancia: m.distanciaKm == null ? NEUTRO : clamp01(1 - m.distanciaKm / 100),

    /*
     * El precio se puntúa CONTRA LA MEDIA de los candidatos, no contra una
     * escala fija: 200 € es caro para una batería y barato para un rescate,
     * y una escala absoluta se quedaría mal a la primera subida de tarifas.
     */
    precio: (() => {
      if (m.precio == null || referencia.precioMedio == null || referencia.precioMedio <= 0) return NEUTRO;
      const ratio = m.precio / referencia.precioMedio;
      return clamp01(1.5 - ratio);   // la mitad de la media → 1; el doble → 0
    })(),

    // 20 min o menos → 1; 120 min → 0. Es la escala del score de talleres.
    sla: m.slaLlegadaMin == null ? NEUTRO : clamp01(1 - (m.slaLlegadaMin - 20) / 100),

    aceptacion: m.ratioAceptacion == null ? NEUTRO : clamp01(m.ratioAceptacion),

    // Contestar en 0 min → 1; en 30 → 0.
    rapidez: m.tiempoAceptacionMin == null ? NEUTRO : clamp01(1 - m.tiempoAceptacionMin / 30),

    calidad: m.calidad == null ? NEUTRO : clamp01(m.calidad / 100),

    /*
     * El historial mide rodaje, no calidad, y por eso pesa poco y se aplasta
     * con un logaritmo: entre 0 y 10 servicios hay mucha diferencia; entre 200
     * y 400, ninguna que importe.
     */
    historial: (() => {
      const base = clamp01(Math.log10(1 + m.volumen) / 2);
      if (m.incidenciasPor100 == null) return base;
      return clamp01(base * clamp01(1 - m.incidenciasPor100 / 20));
    })(),

    preferencia: m.preferente ? 1 : 0,
  };
}

export type Puntuado<T> = {
  candidato: T;
  puntos: number;              // 0..100
  notas: Notas;
  aportacion: Record<Criterio, number>;
  motivo: string;
};

const ETIQUETA: Record<Criterio, string> = {
  distancia: "cercanía",
  precio: "precio",
  sla: "SLA de llegada",
  aceptacion: "ratio de aceptación",
  rapidez: "rapidez en contestar",
  calidad: "calidad",
  historial: "historial",
  preferencia: "es preferente",
};

/**
 * Ordena los candidatos y explica por qué cada uno está donde está.
 *
 * El desempate es por nombre y no por id ni por azar: con dos partners
 * empatados, un orden estable hace que la misma consulta dé siempre la misma
 * respuesta, y eso es lo que permite reproducir una queja.
 */
export function ordenar<T extends { medidas: Medidas; nombre: string }>(
  candidatos: T[], pesos: Pesos = PESOS_POR_DEFECTO,
): Puntuado<T>[] {
  const precios = candidatos.map((c) => c.medidas.precio).filter((p): p is number => p != null && p > 0);
  const precioMedio = precios.length > 0 ? precios.reduce((a, b) => a + b, 0) / precios.length : null;

  const total = CRITERIOS.reduce((s, c) => s + pesos[c], 0);
  // Todos los pesos a cero: se ordena por nombre y se dice, en vez de dividir
  // por cero o fingir un orden con sentido.
  const divisor = total > 0 ? total : 1;

  const puntuados = candidatos.map((candidato) => {
    const notas = notasDe(candidato.medidas, { precioMedio });
    const aportacion = {} as Record<Criterio, number>;
    let puntos = 0;
    for (const c of CRITERIOS) {
      const a = (notas[c] * pesos[c]) / divisor;
      aportacion[c] = Math.round(a * 1000) / 10;   // en puntos sobre 100
      puntos += a;
    }
    return {
      candidato, notas, aportacion,
      puntos: Math.round(puntos * 1000) / 10,
      motivo: explicar(notas, pesos, total),
    };
  });

  return puntuados.sort((a, b) =>
    b.puntos - a.puntos || a.candidato.nombre.localeCompare(b.candidato.nombre));
}

/**
 * Los dos criterios que más lo empujaron, en castellano.
 *
 * Dos y no ocho: una frase que enumera los ocho criterios no explica nada,
 * y lo que hace falta es poder contestar una pregunta concreta.
 */
function explicar(notas: Notas, pesos: Pesos, total: number): string {
  if (total <= 0) return "Sin criterios ponderados: orden alfabético";
  const ordenados = [...CRITERIOS]
    .map((c) => ({ c, peso: (notas[c] * pesos[c]) / total }))
    .sort((a, b) => b.peso - a.peso)
    .filter((x) => x.peso > 0)
    .slice(0, 2);
  if (ordenados.length === 0) return "Ningún criterio a favor";
  return `Por ${ordenados.map((x) => ETIQUETA[x.c]).join(" y ")}`;
}
