/**
 * Arqueo y cierre: teórico contra contado, y reparto del efectivo contado
 * entre el cambio del día siguiente y el ingreso bancario.
 *
 * Lo que distingue este arqueo de "sumar lo que hay en el cajón" es el doble
 * cuadre. Una caja puede tener exactamente los 1.000 € que debía tener y estar
 * mal: si faltan dos billetes de 20 € y sobran cuatro de 10 €, el importe
 * cuadra y las piezas no. Eso normalmente significa que alguien dio mal un
 * cambio, y es justo lo que un total no detecta. Aquí se calculan y se muestran
 * las dos cosas por separado.
 */

import { type Centimos } from "./money.ts";
import { calcularCambio } from "./change.ts";
import {
  type Inventario,
  type LineaDenominacion,
  diferenciaPorDenominacion,
  inventarioDesdeLineas,
  restarInventarios,
  totalInventario,
  totalPiezas,
} from "./inventory.ts";

export type DiferenciaDenominacion = {
  valor: Centimos;
  teorico: number;
  contado: number;
  /** Contado − teórico. Positivo = sobran piezas. */
  diferencia: number;
  /** Valor de la diferencia en céntimos. */
  importeDiferencia: Centimos;
};

export type ResultadoArqueo = {
  totalTeorico: Centimos;
  totalContado: Centimos;
  /** Contado − teórico. Positivo = sobrante, negativo = faltante. */
  diferencia: Centimos;
  estado: "CUADRADA" | "SOBRANTE" | "FALTANTE";
  /** El importe total cuadra. */
  cuadraImporte: boolean;
  /** Además, cada denominación cuadra pieza a pieza. */
  cuadranDenominaciones: boolean;
  piezasTeoricas: number;
  piezasContadas: number;
  /** Todas las denominaciones implicadas, cuadren o no. */
  lineas: DiferenciaDenominacion[];
  /** Solo las que no cuadran: lo que hay que mirar. */
  descuadres: DiferenciaDenominacion[];
};

/** Compara el stock teórico con lo que se ha contado físicamente. */
export function compararArqueo(teorico: Inventario, contado: Inventario): ResultadoArqueo {
  const lineas: DiferenciaDenominacion[] = diferenciaPorDenominacion(teorico, contado).map((d) => ({
    ...d,
    importeDiferencia: d.valor * d.diferencia,
  }));

  const totalTeorico = totalInventario(teorico);
  const totalContado = totalInventario(contado);
  const diferencia = totalContado - totalTeorico;
  const descuadres = lineas.filter((l) => l.diferencia !== 0);

  return {
    totalTeorico,
    totalContado,
    diferencia,
    estado: diferencia === 0 ? "CUADRADA" : diferencia > 0 ? "SOBRANTE" : "FALTANTE",
    cuadraImporte: diferencia === 0,
    cuadranDenominaciones: descuadres.length === 0,
    piezasTeoricas: totalPiezas(teorico),
    piezasContadas: totalPiezas(contado),
    lineas,
    descuadres,
  };
}

// ── Reparto del cierre ─────────────────────────────────────────────────────

export type ResultadoReparto =
  | { ok: true; ingresoBancario: LineaDenominacion[]; totalCambio: Centimos; totalIngreso: Centimos }
  | {
      ok: false;
      codigo: "CAMBIO_NO_DISPONIBLE" | "REPARTO_NO_CUADRA";
      mensaje: string;
      detalle?: { valor: Centimos; pedido: number; disponible: number }[];
    };

/**
 * Reparte el efectivo contado entre el cambio que se queda para mañana y el
 * ingreso bancario.
 *
 * La relación tiene que cumplirse también EN PIEZAS, no solo en importe: no se
 * puede asignar el mismo billete al cambio y al banco. Por eso el ingreso no se
 * pide, se calcula restando: lo que no se queda como cambio, se ingresa.
 */
export function repartirCierre(
  contado: Inventario,
  cambioFinal: readonly LineaDenominacion[]
): ResultadoReparto {
  const cambio = inventarioDesdeLineas(cambioFinal);

  let resto: Inventario;
  try {
    resto = restarInventarios(contado, cambio);
  } catch {
    const falta = [...cambio.entries()]
      .map(([valor, pedido]) => ({ valor, pedido, disponible: contado.get(valor) ?? 0 }))
      .filter((f) => f.pedido > f.disponible)
      .sort((a, b) => b.valor - a.valor);
    return {
      ok: false,
      codigo: "CAMBIO_NO_DISPONIBLE",
      mensaje:
        "El cambio final incluye piezas que no se han contado en el arqueo. Solo se puede dejar en caja lo que hay.",
      detalle: falta,
    };
  }

  const ingresoBancario = [...resto.entries()]
    .filter(([, cantidad]) => cantidad > 0)
    .map(([valor, cantidad]) => ({ valor, cantidad }))
    .sort((a, b) => b.valor - a.valor);

  const totalCambio = totalInventario(cambio);
  const totalIngreso = totalInventario(resto);

  /* Comprobación redundante a propósito: si la resta pieza a pieza fuera
     correcta pero los importes no sumaran, algo muy raro habría pasado y es
     mejor no cerrar la caja. */
  if (totalCambio + totalIngreso !== totalInventario(contado)) {
    return {
      ok: false,
      codigo: "REPARTO_NO_CUADRA",
      mensaje: "El cambio final más el ingreso bancario no suman el efectivo contado.",
    };
  }

  return { ok: true, ingresoBancario, totalCambio, totalIngreso };
}

/**
 * Propone qué dejar como cambio para el día siguiente a partir de lo contado.
 *
 * Criterio: llegar EXACTAMENTE al objetivo dejando la caja preparada para dar
 * cambio, es decir quedándose con todo el menudo que se pueda y completando con
 * billetes. Es lo contrario que el cambio al cliente (que minimiza piezas) y es
 * a propósito: una caja que abre con un billete de 200 € y nada más no puede
 * devolver 3,40 €.
 *
 * Se resuelve con la misma búsqueda exacta que el cambio, pidiéndole que
 * MAXIMICE las piezas. Un reparto de menor a mayor a ojo no vale: cogiendo
 * primero todo el menudo se llega a 260 € y el resto solo se puede completar
 * con un billete de 100 €, que se pasa. La búsqueda exacta sí encuentra la
 * combinación que cierra en 300 € justos.
 *
 * Si no existe ninguna combinación exacta con lo contado (pasa cuando el
 * objetivo no es alcanzable pieza a pieza), se devuelve el mejor reparto
 * aproximado por debajo del objetivo. Nunca miente sobre su total, y el
 * operador ajusta.
 *
 * Es una propuesta: `repartirCierre` valida lo que finalmente decida.
 */
export function proponerCambioFinal(contado: Inventario, objetivo: Centimos): LineaDenominacion[] {
  if (objetivo <= 0) return [];
  if (objetivo >= totalInventario(contado)) {
    // Se quiere dejar todo (o más de lo que hay): se deja todo.
    return [...contado.entries()]
      .filter(([, cantidad]) => cantidad > 0)
      .map(([valor, cantidad]) => ({ valor, cantidad }))
      .sort((a, b) => b.valor - a.valor);
  }

  const exacto = calcularCambio(objetivo, contado, "mas_piezas");
  if (exacto.ok) return exacto.lineas;

  // Sin combinación exacta: se compone lo más cerca posible por debajo,
  // empezando por el menudo, que es lo que interesa conservar.
  const valores = [...contado.keys()].filter((v) => (contado.get(v) ?? 0) > 0).sort((a, b) => a - b);
  const propuesta: LineaDenominacion[] = [];
  let restante = objetivo;

  for (const valor of valores) {
    if (restante <= 0) break;
    const disponible = contado.get(valor) ?? 0;
    const cabe = Math.min(disponible, Math.floor(restante / valor));
    if (cabe > 0) {
      propuesta.push({ valor, cantidad: cabe });
      restante -= valor * cabe;
    }
  }

  return propuesta.sort((a, b) => b.valor - a.valor);
}
