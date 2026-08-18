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

export type FilaCambio = {
  valor: number;
  /** Piezas por tubo, 0 si esa denominación no se encartucha. */
  porTubo: number;
  /** En la unidad en que se pide: tubos si la moneda va en tubo, piezas si no. */
  cantidad: number;
  motivo: string | null;
};

/**
 * Todas las denominaciones de cambio, propuestas o no.
 *
 * La rejilla salía solo con lo que el cálculo proponía, así que para pedir una
 * moneda que el algoritmo no había pensado —o que el banco trae sin que se la
 * pidas— no había casilla donde escribirla. Ahora aparecen todas del 10 € al
 * céntimo, a cero las que no hagan falta, y se ajusta a mano lo que se quiera.
 */
export function filasDeCambio(
  denominaciones: { valor: number; activa: boolean; piezasPorCartucho: number | null }[],
  conocidas: { valor: number; cantidad: number; cartuchos: number; motivo?: string | null }[]
): FilaCambio[] {
  const porValor = new Map(conocidas.map((l) => [l.valor, l]));
  return denominaciones
    .filter((d) => d.activa && d.valor <= VALOR_MAXIMO_CAMBIO)
    .sort((a, b) => b.valor - a.valor)
    .map((d) => {
      const l = porValor.get(d.valor);
      const porTubo = d.piezasPorCartucho ?? 0;
      return {
        valor: d.valor,
        porTubo,
        cantidad: l ? (porTubo > 0 ? l.cartuchos : l.cantidad) : 0,
        motivo: l?.motivo ?? null,
      };
    });
}

/** Pasa la cantidad tecleada a línea de pedido, en piezas y tubos. */
export function aLinea(f: FilaCambio, texto: string | undefined) {
  const n = Number(texto ?? 0);
  if (!Number.isFinite(n) || n <= 0) return null;
  return f.porTubo > 0
    ? { valor: f.valor, cantidad: n * f.porTubo, cartuchos: n, motivo: f.motivo ?? undefined }
    : { valor: f.valor, cantidad: n, cartuchos: 0, motivo: f.motivo ?? undefined };
}
