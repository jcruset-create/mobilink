/**
 * Suplementos: kilómetros y tiempo de más, anulaciones, peajes, lo que sea.
 *
 * Todo se calcula con la misma maquinaria y todo es configuración. La "regla
 * del 20 %" del tarifario de referencia —los kilómetros o el tiempo de más
 * solo se cobran cuando superan en un 20 % lo incluido en el forfait— no es
 * una excepción de ningún cliente: es un disparador con un umbral, y otro
 * tarifario puede poner 0 %, 15 % o cobrar siempre sin tocar una línea de
 * código.
 */

import {
  CERO, aCantidad, aDinero, multiplicar, porcentaje, redondearCentimos,
  type Dinero,
} from "./money.ts";

export type TipoCalculo =
  | "FIXED" | "PER_UNIT" | "PER_KM" | "PER_MINUTE" | "PER_HOUR"
  | "PERCENTAGE" | "FORMULA";

export type TipoDisparo = "ALWAYS" | "THRESHOLD_PERCENT" | "THRESHOLD_ABSOLUTE";

export interface Extra {
  id: number;
  code: string;
  name: string;
  calculationType: TipoCalculo;
  /** Importe unitario, en el formato que devuelve la base (texto). */
  amount?: string | number | null;
  percentage?: string | number | null;
  unit?: string | null;
  lineKind?: string | null;
}

export interface LineaExtra {
  extra: Extra;
  cantidad: number;
  unidad: string;
  importeUnitario: Dinero;
  total: Dinero;
}

/**
 * ¿Hay que cobrar el suplemento?
 *
 * - ALWAYS: todo exceso se cobra.
 * - THRESHOLD_PERCENT: solo si el exceso supera ese porcentaje de lo incluido.
 *   Con 100 km incluidos y un umbral del 20 %, se cobra a partir de 120 km.
 * - THRESHOLD_ABSOLUTE: solo si el exceso supera ese número de unidades.
 *
 * Sin nada incluido, un umbral porcentual no significa nada —el 20 % de cero
 * es cero—, así que se cobra cualquier exceso.
 */
export function debeCobrarse(
  tipo: TipoDisparo,
  umbral: number | null,
  incluido: number | null,
  real: number | null,
): boolean {
  if (real == null) return false;
  const base = incluido ?? 0;
  const exceso = real - base;
  if (exceso <= 0) return false;

  switch (tipo) {
    case "ALWAYS":
      return true;
    case "THRESHOLD_PERCENT": {
      if (umbral == null || base <= 0) return true;
      return exceso > (base * umbral) / 100;
    }
    case "THRESHOLD_ABSOLUTE":
      return umbral == null ? true : exceso > umbral;
  }
}

/**
 * Unidades que se facturan: el exceso completo, no solo lo que pasa del
 * umbral. El umbral decide SI se cobra; una vez se cobra, se cobra todo lo que
 * sobra de lo incluido. Es como está escrito el tarifario de referencia.
 */
export function unidadesExcedidas(incluido: number | null, real: number | null): number {
  if (real == null) return 0;
  return Math.max(0, real - (incluido ?? 0));
}

/** Unidades a facturar según el tipo de cálculo del extra. */
function cantidadPara(extra: Extra, unidades: number): number {
  if (extra.calculationType === "PER_HOUR") return unidades / 60;
  return unidades;
}

/**
 * Calcula un suplemento.
 *
 * `baseParaPorcentaje` es sobre qué se aplica un extra porcentual: el forfait
 * en el caso de una anulación.
 */
export function calcularExtra(
  extra: Extra,
  opciones: { unidades?: number; baseParaPorcentaje?: Dinero } = {},
): LineaExtra | { error: string } {
  const importe = aDinero(extra.amount ?? null);
  const pct = aDinero(extra.percentage ?? null);
  const unidades = opciones.unidades ?? 1;

  switch (extra.calculationType) {
    case "FIXED": {
      if (importe == null) return { error: "EXTRA_AMOUNT_MISSING" };
      return linea(extra, 1, extra.unit ?? "servicio", importe, importe);
    }

    case "PER_UNIT":
    case "PER_KM":
    case "PER_MINUTE":
    case "PER_HOUR": {
      if (importe == null) return { error: "EXTRA_AMOUNT_MISSING" };
      const cantidad = cantidadPara(extra, unidades);
      const total = multiplicar(importe, aCantidad(cantidad));
      return linea(extra, cantidad, extra.unit ?? unidadPorDefecto(extra.calculationType), importe, total);
    }

    case "PERCENTAGE": {
      if (pct == null) return { error: "EXTRA_PERCENTAGE_MISSING" };
      const base = opciones.baseParaPorcentaje;
      if (base == null) return { error: "EXTRA_BASE_MISSING" };
      const total = porcentaje(base, pct);
      return linea(extra, 1, "%", total, total);
    }

    case "FORMULA":
      /*
       * Declarado en el modelo pero sin evaluador: un intérprete de
       * expresiones a medio hacer en algo que calcula facturas es peor que no
       * tenerlo. Se avisa y el servicio va a revisión manual.
       */
      return { error: "FORMULA_NOT_SUPPORTED" };
  }
}

function unidadPorDefecto(tipo: TipoCalculo): string {
  return tipo === "PER_KM" ? "km" : tipo === "PER_MINUTE" ? "min"
    : tipo === "PER_HOUR" ? "h" : "ud";
}

function linea(
  extra: Extra, cantidad: number, unidad: string, importeUnitario: Dinero, total: Dinero,
): LineaExtra {
  return {
    extra, cantidad, unidad,
    importeUnitario,
    total: redondearCentimos(total),
  };
}

export const esError = (r: LineaExtra | { error: string }): r is { error: string } =>
  "error" in r;

/** Total de varias líneas de suplemento. */
export function sumarExtras(lineas: LineaExtra[]): Dinero {
  return lineas.reduce((acc, l) => acc + l.total, CERO);
}
