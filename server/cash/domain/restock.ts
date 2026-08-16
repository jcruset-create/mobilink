/**
 * Qué cambio hay que ir a buscar al banco.
 *
 * El problema real del mostrador: se acumulan billetes grandes y se agota la
 * calderilla. Alguien va al banco con 200 € en billetes y tiene que decidir en
 * qué los quiere. Decidirlo a ojo es lo que acaba con tres tubos de 0,01 € que
 * no se gastan nunca y sin monedas de 1 €.
 *
 * Aquí no hay ningún modelo de lenguaje, y es a propósito: el libro mayor
 * registra cada moneda que ha salido al dar cambio, así que el consumo es un
 * dato, no una estimación. Una fórmula da siempre la misma respuesta para los
 * mismos datos, se puede probar y se puede auditar. Un modelo daría respuestas
 * distintas para el mismo caso, y en dinero eso es un defecto.
 *
 * El cálculo, en orden:
 *
 *   1. Consumo medio diario de cada denominación, de las últimas jornadas.
 *   2. Objetivo = consumo diario × días de colchón.
 *   3. Falta = objetivo − lo que hay ahora en caja.
 *   4. Redondeo a cartucho donde lo haya: al banco las monedas se piden en
 *      tubos, no sueltas.
 *   5. Ajuste al importe que se va a cambiar, priorizando lo que más se agota.
 *
 * Cada línea sale con su porqué, porque un cajero que no entiende la propuesta
 * no la corrige: la ignora.
 */

import type { Centimos } from "./money.ts";
import type { Denominacion } from "./denominations.ts";
import type { Inventario, LineaDenominacion } from "./inventory.ts";

/** Piezas de una denominación gastadas en una jornada. */
export type ConsumoDiario = {
  valor: Centimos;
  /** Piezas que salieron de la caja ese día por esa denominación. */
  piezas: number;
};

export type HistorialConsumo = {
  /** Jornadas distintas de las que se ha mirado el consumo. */
  jornadas: number;
  /** Piezas gastadas por denominación, sumadas de todas esas jornadas. */
  consumo: readonly ConsumoDiario[];
};

export type LineaPedido = {
  valor: Centimos;
  /** Piezas a pedir. Si van en tubos, es tubos × piezas del tubo. */
  piezas: number;
  /** Cuántos tubos precintados. 0 = suelto. */
  cartuchos: number;
  importe: Centimos;
  /** Por qué esta línea, en una frase para el cajero. */
  motivo: string;
};

export type PropuestaPedido = {
  lineas: LineaPedido[];
  /** Lo que suman las líneas. Puede no llegar al importe pedido. */
  totalCentimos: Centimos;
  /** Lo que sobra del importe si no hay nada más que reponer. */
  sobranteCentimos: Centimos;
  /** Explicación de por qué la propuesta no llega al importe, si es el caso. */
  aviso: string | null;
};

export type OpcionesPropuesta = {
  /** Días de consumo que se quieren tener en caja. Por defecto, 5. */
  diasColchon?: number;
  /**
   * Denominaciones que NO se piden al banco por ser las que se acumulan: los
   * billetes grandes. Por defecto, todo lo que valga más de 20 €.
   */
  maximoValorPieza?: Centimos;
};

const DIAS_COLCHON = 5;
const MAXIMO_VALOR_PIEZA = 2000; // 20 €

/**
 * Propone qué pedir al banco por `importe`, mirando lo que se gasta y lo que
 * queda.
 *
 * `stock` son las piezas que hay ahora en la caja (sueltas y encartuchadas
 * juntas: para decidir si falta calderilla da igual el formato).
 */
export function proponerPedidoCambio(
  importe: Centimos,
  stock: Inventario,
  historial: HistorialConsumo,
  denominaciones: readonly Denominacion[],
  opciones: OpcionesPropuesta = {}
): PropuestaPedido {
  const dias = Math.max(1, opciones.diasColchon ?? DIAS_COLCHON);
  const maximo = opciones.maximoValorPieza ?? MAXIMO_VALOR_PIEZA;
  const jornadas = Math.max(1, historial.jornadas);

  const consumoPorValor = new Map<Centimos, number>();
  for (const c of historial.consumo) consumoPorValor.set(c.valor, c.piezas);

  /**
   * Candidatas: activas, de valor pequeño y con consumo conocido. Una
   * denominación que nunca se ha gastado no se pide, por mucho que no haya:
   * traer un tubo de 0,01 € porque la caja no tiene ninguna es exactamente el
   * error que esto viene a evitar.
   */
  const candidatas = denominaciones
    .filter((d) => d.activa && d.valor <= maximo)
    .map((d) => {
      const gastadas = consumoPorValor.get(d.valor) ?? 0;
      const porDia = gastadas / jornadas;
      const objetivo = Math.ceil(porDia * dias);
      const hay = stock.get(d.valor) ?? 0;
      return { d, porDia, objetivo, hay, faltan: Math.max(0, objetivo - hay) };
    })
    .filter((c) => c.faltan > 0)
    // Primero lo que más falta en días de autonomía: una denominación con
    // media jornada de reserva es más urgente que otra con cuatro.
    .sort((a, b) => {
      const autonomiaA = a.porDia > 0 ? a.hay / a.porDia : Infinity;
      const autonomiaB = b.porDia > 0 ? b.hay / b.porDia : Infinity;
      if (autonomiaA !== autonomiaB) return autonomiaA - autonomiaB;
      return b.d.valor - a.d.valor;
    });

  const lineas: LineaPedido[] = [];
  let restante = importe;

  for (const c of candidatas) {
    const porTubo = c.d.piezasPorCartucho ?? 0;
    // Con cartucho se pide en tubos enteros: el banco no da 37 monedas sueltas.
    const unidad = porTubo > 0 ? porTubo * c.d.valor : c.d.valor;
    if (unidad > restante) continue;

    const unidadesQueFaltan = porTubo > 0 ? Math.ceil(c.faltan / porTubo) : c.faltan;
    const unidades = Math.min(unidadesQueFaltan, Math.floor(restante / unidad));
    if (unidades <= 0) continue;

    const piezas = porTubo > 0 ? unidades * porTubo : unidades;
    const importeLinea = piezas * c.d.valor;
    restante -= importeLinea;

    lineas.push({
      valor: c.d.valor,
      piezas,
      cartuchos: porTubo > 0 ? unidades : 0,
      importe: importeLinea,
      motivo: motivoDe(c.porDia, c.hay, c.d.etiqueta),
    });
  }

  const total = importe - restante;

  return {
    lineas,
    totalCentimos: total,
    sobranteCentimos: restante,
    aviso:
      restante > 0
        ? candidatas.length === 0
          ? "Con el consumo de los últimos días no falta calderilla: la caja va sobrada."
          : "No se ha podido repartir todo el importe en piezas completas. Ajusta a mano lo que falte o cambia menos."
        : null,
  };
}

function motivoDe(porDia: number, hay: number, etiqueta: string): string {
  if (porDia <= 0) return `No queda casi nada de ${etiqueta} y conviene tener reserva.`;
  const gasto = porDia >= 10 ? Math.round(porDia) : Math.round(porDia * 10) / 10;
  if (hay === 0) return `Se gastan unas ${gasto} piezas de ${etiqueta} al día y no queda ninguna.`;
  const dias = Math.round((hay / porDia) * 10) / 10;
  return `Se gastan unas ${gasto} piezas de ${etiqueta} al día y quedan ${hay}: para ${dias} días.`;
}

/**
 * Qué billetes salen de la caja para pagar el pedido.
 *
 * Es el mismo problema que dar un cambio, pero al revés: interesa soltar las
 * piezas MÁS grandes, que son precisamente las que sobran y las que hay que
 * quitarse de encima. Por eso no se reutiliza `calcularCambio`, que minimiza
 * piezas del lado del cliente.
 */
export function composicionSalida(
  importe: Centimos,
  stock: Inventario,
  minimoValorPieza: Centimos = 500
): { ok: true; lineas: LineaDenominacion[] } | { ok: false; mensaje: string } {
  const valores = [...stock.keys()]
    .filter((v) => v >= minimoValorPieza && (stock.get(v) ?? 0) > 0)
    .sort((a, b) => b - a);

  const lineas: LineaDenominacion[] = [];
  let resto = importe;

  for (const valor of valores) {
    if (resto <= 0) break;
    const disponibles = stock.get(valor) ?? 0;
    const usar = Math.min(disponibles, Math.floor(resto / valor));
    if (usar > 0) {
      lineas.push({ valor, cantidad: usar });
      resto -= usar * valor;
    }
  }

  if (resto !== 0) {
    return {
      ok: false,
      mensaje:
        "No se puede componer ese importe con los billetes que hay en caja. Prueba con otra cantidad.",
    };
  }
  return { ok: true, lineas };
}
