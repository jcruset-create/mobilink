/**
 * Denominaciones de euro y cartuchos de monedas.
 *
 * Los valores viven en la tabla `cash_denominations` (son configurables: mañana
 * puede desaparecer la moneda de 1 c, o cambiar cuántas piezas trae un
 * cartucho). Lo que hay aquí es la SEMILLA con la que se crea esa tabla y los
 * tipos con los que trabaja el motor.
 *
 * Regla que evita el problema clásico de este tipo de módulos: ningún
 * componente ni servicio escribe la lista de denominaciones a mano. Todos
 * reciben el catálogo cargado de base de datos; esta semilla solo se usa en la
 * migración y en las pruebas.
 */

import type { Centimos } from "./money.ts";

export type TipoDenominacion = "BILLETE" | "MONEDA";

export type Denominacion = {
  /** Id estable de base de datos. */
  id: number;
  /** Valor unitario en céntimos. Es también la clave natural. */
  valor: Centimos;
  tipo: TipoDenominacion;
  /** Etiqueta corta para pantalla: "500 €", "0,50 €". */
  etiqueta: string;
  /** Piezas que trae un cartucho de esta denominación; null = sin cartucho. */
  piezasPorCartucho: number | null;
  /**
   * Piezas que trae una bolsa precintada de esta denominación; null = sin
   * bolsa. Una bolsa es el envase grande con el que llega el cambio del banco:
   * contiene monedas SUELTAS, no cartuchos. Se configura en pantalla porque
   * cada banco sirve bolsas de tamaños distintos.
   */
  piezasPorBolsa: number | null;
  /** Foto del billete o de la moneda; null = se pinta solo la etiqueta. */
  imagenUrl: string | null;
  activa: boolean;
  orden: number;
};

/** Semilla del catálogo, de mayor a menor valor. */
export const DENOMINACIONES_SEMILLA: Omit<Denominacion, "id">[] = [
  { valor: 50000, tipo: "BILLETE", etiqueta: "500 €", piezasPorCartucho: null, piezasPorBolsa: null, imagenUrl: null, activa: true, orden: 1 },
  { valor: 20000, tipo: "BILLETE", etiqueta: "200 €", piezasPorCartucho: null, piezasPorBolsa: null, imagenUrl: null, activa: true, orden: 2 },
  { valor: 10000, tipo: "BILLETE", etiqueta: "100 €", piezasPorCartucho: null, piezasPorBolsa: null, imagenUrl: null, activa: true, orden: 3 },
  { valor: 5000, tipo: "BILLETE", etiqueta: "50 €", piezasPorCartucho: null, piezasPorBolsa: null, imagenUrl: null, activa: true, orden: 4 },
  { valor: 2000, tipo: "BILLETE", etiqueta: "20 €", piezasPorCartucho: null, piezasPorBolsa: null, imagenUrl: null, activa: true, orden: 5 },
  { valor: 1000, tipo: "BILLETE", etiqueta: "10 €", piezasPorCartucho: null, piezasPorBolsa: null, imagenUrl: null, activa: true, orden: 6 },
  { valor: 500, tipo: "BILLETE", etiqueta: "5 €", piezasPorCartucho: null, piezasPorBolsa: null, imagenUrl: null, activa: true, orden: 7 },
  { valor: 200, tipo: "MONEDA", etiqueta: "2 €", piezasPorCartucho: 25, piezasPorBolsa: null, imagenUrl: null, activa: true, orden: 8 },
  { valor: 100, tipo: "MONEDA", etiqueta: "1 €", piezasPorCartucho: 25, piezasPorBolsa: null, imagenUrl: null, activa: true, orden: 9 },
  { valor: 50, tipo: "MONEDA", etiqueta: "0,50 €", piezasPorCartucho: 25, piezasPorBolsa: null, imagenUrl: null, activa: true, orden: 10 },
  { valor: 20, tipo: "MONEDA", etiqueta: "0,20 €", piezasPorCartucho: 25, piezasPorBolsa: null, imagenUrl: null, activa: true, orden: 11 },
  { valor: 10, tipo: "MONEDA", etiqueta: "0,10 €", piezasPorCartucho: 50, piezasPorBolsa: null, imagenUrl: null, activa: true, orden: 12 },
  { valor: 5, tipo: "MONEDA", etiqueta: "0,05 €", piezasPorCartucho: 50, piezasPorBolsa: null, imagenUrl: null, activa: true, orden: 13 },
  { valor: 2, tipo: "MONEDA", etiqueta: "0,02 €", piezasPorCartucho: 50, piezasPorBolsa: null, imagenUrl: null, activa: true, orden: 14 },
  { valor: 1, tipo: "MONEDA", etiqueta: "0,01 €", piezasPorCartucho: 50, piezasPorBolsa: null, imagenUrl: null, activa: true, orden: 15 },
];

/** Valor de un cartucho lleno: 25 monedas de 2 € = 50 €. */
export function valorCartucho(d: Denominacion): Centimos | null {
  return d.piezasPorCartucho == null ? null : d.valor * d.piezasPorCartucho;
}

/** Valor de una bolsa llena: 500 monedas de 1 € = 500 €. */
export function valorBolsa(d: Denominacion): Centimos | null {
  return d.piezasPorBolsa == null ? null : d.valor * d.piezasPorBolsa;
}

/**
 * Ordena de mayor a menor valor. El motor de cambio y las pantallas dependen de
 * este orden, así que se normaliza en un único sitio en lugar de confiar en
 * cómo venga la consulta.
 */
export function ordenarPorValorDesc(denominaciones: Denominacion[]): Denominacion[] {
  return [...denominaciones].sort((a, b) => b.valor - a.valor);
}

/** Índice por valor, que es como llegan las líneas desde la interfaz. */
export function indexarPorValor(denominaciones: Denominacion[]): Map<Centimos, Denominacion> {
  return new Map(denominaciones.map((d) => [d.valor, d]));
}

/** Índice por id, que es como se guardan los movimientos. */
export function indexarPorId(denominaciones: Denominacion[]): Map<number, Denominacion> {
  return new Map(denominaciones.map((d) => [d.id, d]));
}
