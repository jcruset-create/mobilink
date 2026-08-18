/**
 * Cálculos de la pantalla de cambio del banco.
 *
 * Vive fuera de la pantalla por lo mismo que `utils/cierre.ts`: es la cuenta
 * que decide qué se pide y qué se da por recibido, y una cuenta que mueve
 * dinero merece sus propias pruebas.
 */

/**
 * Lo más grande que se le pide al banco como cambio: el billete de 10 €.
 *
 * Pedir cambio es deshacer billetes grandes en pequeños. Un billete de 50 € no
 * es cambio, es lo que se lleva para cambiar; ofrecerlo en la rejilla solo
 * daría pie a pedir lo que ya se tiene.
 */
const VALOR_MAXIMO_CAMBIO = 1000;

/** Los tres formatos en que el banco puede servir una denominación. */
export type Formato = "sueltas" | "cartuchos" | "bolsas";

/** Cuánto se pide de cada formato, en la unidad de ese formato. */
export type CantidadesFormato = Record<Formato, number>;

export type FilaCambio = {
  valor: number;
  /** Piezas por cartucho, 0 si esa denominación no se encartucha. */
  porTubo: number;
  /** Monedas por bolsa, 0 si esa denominación no viene en bolsa. */
  porBolsa: number;
  /** Lo propuesto, ya repartido por formato. Todo a cero = fila manual. */
  cantidades: CantidadesFormato;
  motivo: string | null;
};

const CERO: CantidadesFormato = { sueltas: 0, cartuchos: 0, bolsas: 0 };

/**
 * Todas las denominaciones de cambio, propuestas o no.
 *
 * La rejilla salía solo con lo que el cálculo proponía, así que para pedir una
 * moneda que el algoritmo no había pensado —o que el banco trae sin que se la
 * pidas— no había casilla donde escribirla. Ahora aparecen todas del 10 € al
 * céntimo, a cero las que no hagan falta, y se ajusta a mano lo que se quiera.
 *
 * Cada fila lleva sus tres casillas —sueltas, cartuchos y bolsas— porque el
 * banco sirve en los tres formatos y no siempre en el que uno pediría: con una
 * sola casilla no había forma de pedir «20 monedas sueltas» de algo que el
 * catálogo encartucha.
 */
export function filasDeCambio(
  denominaciones: {
    valor: number;
    activa: boolean;
    piezasPorCartucho: number | null;
    piezasPorBolsa?: number | null;
  }[],
  conocidas: {
    valor: number;
    cantidad: number;
    cartuchos: number;
    bolsas?: number;
    motivo?: string | null;
  }[]
): FilaCambio[] {
  const porValor = new Map(conocidas.map((l) => [l.valor, l]));
  return denominaciones
    .filter((d) => d.activa && d.valor <= VALOR_MAXIMO_CAMBIO)
    .sort((a, b) => b.valor - a.valor)
    .map((d) => {
      const l = porValor.get(d.valor);
      const porTubo = d.piezasPorCartucho ?? 0;
      const porBolsa = d.piezasPorBolsa ?? 0;
      const cartuchos = l?.cartuchos ?? 0;
      const bolsas = l?.bolsas ?? 0;
      // `cantidad` en lo propuesto son SIEMPRE piezas, envases incluidos: lo
      // que va a la casilla de sueltas es lo que sobra tras descontarlos.
      const sueltas = Math.max(
        0,
        (l?.cantidad ?? 0) - cartuchos * porTubo - bolsas * porBolsa
      );
      return {
        valor: d.valor,
        porTubo,
        porBolsa,
        cantidades: { sueltas, cartuchos, bolsas },
        motivo: l?.motivo ?? null,
      };
    });
}

/** Piezas que representa cada formato de una fila. */
export function piezasDeFormato(f: FilaCambio, formato: Formato): number {
  return formato === "sueltas" ? 1 : formato === "cartuchos" ? f.porTubo : f.porBolsa;
}

/**
 * Pasa lo tecleado a líneas de pedido: una por formato con algo.
 *
 * Van separadas a propósito. Un asiento del libro mayor es de un solo formato
 * —la base de datos lo exige— así que fundir «2 cartuchos y 5 sueltas» en una
 * sola línea perdería justo el dato que dice qué precinto hay que romper.
 */
export function lineasDeFila(
  f: FilaCambio,
  tecleado: Partial<Record<Formato, string | undefined>>
): { valor: number; cantidad: number; cartuchos: number; bolsas: number; motivo?: string }[] {
  const lineas = [];
  for (const formato of ["sueltas", "cartuchos", "bolsas"] as const) {
    const n = Number(tecleado[formato] ?? 0);
    if (!Number.isFinite(n) || n <= 0) continue;
    const piezas = piezasDeFormato(f, formato);
    if (piezas <= 0) continue;
    lineas.push({
      valor: f.valor,
      cantidad: n * piezas,
      cartuchos: formato === "cartuchos" ? n : 0,
      bolsas: formato === "bolsas" ? n : 0,
      motivo: f.motivo ?? undefined,
    });
  }
  return lineas;
}

/** Lo que suma una fila entera, para el total de la pantalla. */
export function importeDeFila(
  f: FilaCambio,
  tecleado: Partial<Record<Formato, string | undefined>>
): number {
  return lineasDeFila(f, tecleado).reduce((a, l) => a + l.cantidad * l.valor, 0);
}

export { CERO as CANTIDADES_CERO };
