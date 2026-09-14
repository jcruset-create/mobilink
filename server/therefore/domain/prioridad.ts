/**
 * Cuánto corre un expediente.
 *
 * Código PURO: entra y sale todo por parámetro, incluidos los pesos. Que los
 * pesos sean un parámetro y no constantes del fichero es lo que permite
 * cambiarlos por empresa desde `thf_config` sin desplegar, y —más importante—
 * lo que permite probar la fórmula con números concretos.
 *
 * ── Por qué la prioridad se GUARDA y no se calcula al leer ──────────────────
 *
 * Porque la bandeja filtra y ordena por ella, y un cálculo por fila obligaría
 * a traerse todos los expedientes abiertos para poder ordenar cuatro. Se
 * recalcula en cada cosa que le pasa al expediente y, además, una vez al día:
 * los días abiertos suben solos aunque nadie toque nada, y un expediente que
 * lleva dos semanas parado tiene que subir en la lista sin esperar a que
 * alguien lo abra.
 *
 * ── Por qué la prioridad manual gana ────────────────────────────────────────
 *
 * Quien gestiona sabe cosas que la fórmula no: que ese proveedor corta el
 * suministro, que esa factura vence el viernes. Si alguien la fija a mano, esa
 * manda; el score se sigue calculando y se sigue enseñando al lado, para que se
 * vea cuándo la automática ya habría llegado sola a lo mismo.
 */

import type { Prioridad } from "./estados.ts";

export type PesosPrioridad = {
  /** Por cada día que lleva abierto. */
  diasAbierto: number;
  /** Por cada reclamación recibida. */
  reclamaciones: number;
  /** Una sola vez, si algún correo venía marcado como urgente. */
  urgente: number;
  /** Una sola vez, si Therefore ha mandado alguna tarea vencida. */
  tareaVencida: number;
};

export type UmbralesPrioridad = {
  /** Por debajo de esto, BAJA. */
  baja: number;
  /** A partir de esto, ALTA. */
  alta: number;
  /** A partir de esto, CRÍTICA. */
  critica: number;
};

export const PESOS_POR_DEFECTO: PesosPrioridad = {
  diasAbierto: 2,
  reclamaciones: 10,
  urgente: 25,
  tareaVencida: 15,
};

export const UMBRALES_POR_DEFECTO: UmbralesPrioridad = {
  baja: 10,
  alta: 40,
  critica: 70,
};

/** Lo que se sabe del expediente y entra en la cuenta. */
export type HechosPrioridad = {
  diasAbierto: number;
  reclamaciones: number;
  urgente: boolean;
  tareaVencida: boolean;
};

/**
 * Días enteros que lleva abierto, contados desde la primera notificación.
 *
 * Nunca negativo: un correo con la fecha en el futuro —pasa cuando el reloj
 * del emisor va adelantado— no puede restar antigüedad.
 */
export function diasAbierto(desde: Date, hasta: Date = new Date()): number {
  const ms = hasta.getTime() - desde.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.floor(ms / 86_400_000);
}

export function calcularScore(
  h: HechosPrioridad,
  pesos: PesosPrioridad = PESOS_POR_DEFECTO
): number {
  const dias = Math.max(0, h.diasAbierto);
  const reclamaciones = Math.max(0, h.reclamaciones);
  return Math.round(
    dias * pesos.diasAbierto +
      reclamaciones * pesos.reclamaciones +
      (h.urgente ? pesos.urgente : 0) +
      (h.tareaVencida ? pesos.tareaVencida : 0)
  );
}

export function prioridadDeScore(
  score: number,
  umbrales: UmbralesPrioridad = UMBRALES_POR_DEFECTO
): Prioridad {
  if (score >= umbrales.critica) return "CRITICA";
  if (score >= umbrales.alta) return "ALTA";
  if (score >= umbrales.baja) return "NORMAL";
  return "BAJA";
}

export type ResultadoPrioridad = {
  score: number;
  /** La que sale de la fórmula, ignorando cualquier ajuste manual. */
  calculada: Prioridad;
  /** La que se guarda y se enseña: la manual si la hay, si no la calculada. */
  prioridad: Prioridad;
  manual: boolean;
};

export function calcularPrioridad(
  h: HechosPrioridad,
  opciones: {
    pesos?: PesosPrioridad;
    umbrales?: UmbralesPrioridad;
    /** Prioridad fijada a mano por alguien. Si está, gana. */
    manual?: Prioridad | null;
  } = {}
): ResultadoPrioridad {
  const score = calcularScore(h, opciones.pesos ?? PESOS_POR_DEFECTO);
  const calculada = prioridadDeScore(score, opciones.umbrales ?? UMBRALES_POR_DEFECTO);
  const manual = opciones.manual ?? null;
  return {
    score,
    calculada,
    prioridad: manual ?? calculada,
    manual: manual != null,
  };
}
