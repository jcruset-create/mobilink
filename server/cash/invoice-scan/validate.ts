/**
 * La aduana entre lo que ha leído el modelo y lo que se le enseña al operario.
 *
 * Aquí no se lee nada nuevo: se comprueba. Que el documento sea una factura,
 * que tenga un total, que el resguardo del TPV sume lo mismo que la factura, y
 * que cada campo venga con confianza suficiente para ponerlo en el formulario.
 *
 * Es la última puerta antes de la pantalla, y la que degrada la propuesta
 * cuando algo no cuadra: por bien que una regla reconozca el TPV, si la
 * factura pone 195,10 y el resguardo 190,00 no hay nada preseleccionable —hay
 * algo que mirar—.
 *
 * Sin red, sin base de datos, sin IA: entra y sale todo por parámetro.
 */

import type { Centimos } from "../domain/money.ts";
import { formatearEuros } from "../domain/money.ts";
import type { PropuestaFormaCobro } from "./classifier.ts";
import type {
  Aviso,
  CampoPropuesto,
  ExtraccionNormalizada,
  PropuestaCobro,
} from "./types.ts";

/**
 * Umbrales de confianza por campo.
 *
 * Por encima de `RELLENAR` el dato entra en el formulario sin ruido; entre los
 * dos, entra pero marcado; por debajo de `REVISAR` no entra: un campo mal
 * relleno cuesta más de arreglar que uno vacío, porque hay que darse cuenta
 * primero.
 *
 * La forma de cobro NO usa estos: tiene el suyo, más exigente, en
 * `classifier.ts`.
 */
export const UMBRALES = { rellenar: 0.9, revisar: 0.7 } as const;

/**
 * Cuánto puede separarse el resguardo de la factura.
 *
 * Cero. Un cobro con tarjeta se hace por el importe exacto de la factura, y
 * cualquier diferencia es algo que hay que mirar: un pago parcial, una
 * propina, un resguardo de otra factura. Existe como constante y no como
 * número suelto porque alguna integración futura podría necesitar holgura, y
 * entonces se cambia aquí y se ve en los tests.
 */
export const TOLERANCIA_CENTIMOS = 0;

function campo<T>(valor: T, confianza: number, vacio: T): CampoPropuesto<T> {
  if (valor === vacio || valor == null) return { valor: vacio, confianza, estado: "VACIO" };
  if (confianza >= UMBRALES.rellenar) return { valor, confianza, estado: "RELLENAR" };
  if (confianza >= UMBRALES.revisar) return { valor, confianza, estado: "REVISAR" };
  return { valor: vacio, confianza, estado: "VACIO" };
}

/**
 * Convierte la extracción en lo que ve la pantalla, con sus avisos.
 *
 * `propuesta` entra ya calculada por el clasificador y puede salir degradada:
 * esta función nunca ASCIENDE una propuesta, solo la baja.
 */
export function validar(
  extraccion: ExtraccionNormalizada,
  propuesta: PropuestaFormaCobro,
  toleranciaCentimos: Centimos = TOLERANCIA_CENTIMOS
): PropuestaCobro {
  const avisos: Aviso[] = [];

  if (!extraccion.esFactura) {
    avisos.push({
      codigo: "NO_ES_FACTURA",
      mensaje:
        "Este documento no parece una factura. Revísalo antes de usar nada de lo que se ha rellenado.",
      grave: true,
    });
  }

  if (extraccion.facturasDetectadas > 1) {
    avisos.push({
      codigo: "VARIAS_FACTURAS",
      mensaje: `El documento trae ${extraccion.facturasDetectadas} facturas. Solo se ha leído la primera: sepáralas o rellena a mano.`,
      grave: true,
    });
  }

  if (!extraccion.numeroFactura) {
    avisos.push({
      codigo: "SIN_NUMERO_FACTURA",
      mensaje: "No se ha podido leer el número de factura. Escríbelo tú.",
      grave: false,
    });
  }

  if (extraccion.totales.totalCentimos == null) {
    avisos.push({
      codigo: "SIN_TOTAL",
      mensaje: "No se ha podido leer el total de la factura. Escríbelo tú.",
      grave: true,
    });
  }

  /*
   * Que la base más el IVA sumen el total.
   *
   * Es una comprobación de la propia factura, no del cobro, y por eso no es
   * grave: un céntimo de redondeo no invalida nada. Pero si no cuadra de lejos,
   * lo más probable es que se haya leído mal alguno de los tres, y entonces el
   * total tampoco es de fiar.
   */
  const { baseCentimos, ivaCentimos, totalCentimos } = extraccion.totales;
  if (baseCentimos != null && ivaCentimos != null && totalCentimos != null) {
    const desvio = Math.abs(baseCentimos + ivaCentimos - totalCentimos);
    if (desvio > 1) {
      avisos.push({
        codigo: "TOTALES_NO_CUADRAN",
        mensaje: `La base (${formatearEuros(baseCentimos)} €) más el IVA (${formatearEuros(ivaCentimos)} €) no dan el total (${formatearEuros(totalCentimos)} €). Comprueba el importe.`,
        grave: true,
      });
    }
  }

  if (extraccion.recibo.recibosDetectados > 1) {
    avisos.push({
      codigo: "VARIOS_RECIBOS",
      mensaje: `El documento trae ${extraccion.recibo.recibosDetectados} justificantes de pago. Comprueba cuál corresponde a esta factura.`,
      grave: true,
    });
  }

  /*
   * El cuadre entre la factura y el resguardo.
   *
   * `null` cuando no hay resguardo: no es que no cuadre, es que no hay nada
   * con lo que comparar. Distinguirlo importa, porque «no cuadra» es un aviso
   * y «no hay» es solo la ausencia de una comprobación.
   */
  let importeCuadra: boolean | null = null;
  const importeRecibo = extraccion.recibo.importeCentimos;
  if (extraccion.recibo.detectado && importeRecibo != null && totalCentimos != null) {
    importeCuadra = Math.abs(importeRecibo - totalCentimos) <= toleranciaCentimos;
    if (!importeCuadra) {
      avisos.push({
        codigo: "PAYMENT_AMOUNT_MISMATCH",
        mensaje: `La factura son ${formatearEuros(totalCentimos)} € y el justificante ${formatearEuros(importeRecibo)} €. No coinciden: comprueba antes de cobrar.`,
        grave: true,
      });
    }
  }

  if (!extraccion.recibo.detectado) {
    avisos.push({
      codigo: "SIN_EVIDENCIA_DE_PAGO",
      mensaje:
        "No se ha encontrado justificante de pago. Que no lo haya NO quiere decir que sea efectivo: elige tú la forma de cobro.",
      grave: false,
    });
  }

  /*
   * La degradación. Cualquier aviso grave quita la preselección: la pantalla
   * puede seguir proponiendo la forma —es información útil— pero no la marca
   * sola, porque marcarla es justo lo que hace que nadie la mire.
   */
  const hayGraves = avisos.some((a) => a.grave);
  const formaCobro: PropuestaFormaCobro = hayGraves
    ? { ...propuesta, autoSeleccionar: false }
    : propuesta;

  const nombreCliente = extraccion.cliente.nombre;

  return {
    referencia: campo(extraccion.numeroFactura, extraccion.confianza.numeroFactura, null),
    importeCentimos: campo(totalCentimos, extraccion.confianza.total, null),
    cliente: campo(nombreCliente, extraccion.confianza.cliente, null),
    concepto: campo(extraccion.concepto, extraccion.confianza.concepto, null),
    formaCobro,
    importeCuadra,
    avisos,
    // Lo rellena el servicio si el histórico dice que ya se cobró: aquí no se
    // consulta nada, que es lo que permite probar esta pieza sin base de datos.
    cobroPrevio: null,
    extra: extraccion,
  };
}
