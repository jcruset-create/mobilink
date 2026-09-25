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
import type { PropuestaSeccion } from "./seccion.ts";
import type { TipoDocumento } from "./types.ts";
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
/**
 * La propuesta de sección cuando no hay ninguna: NO LO SÉ.
 *
 * Es el valor por defecto a propósito, y no «la sección de siempre». Un escaneo
 * rehecho de una fila anterior a que esto existiera no propuso sección, y
 * fabricarle una ahora sería inventar una decisión que nadie tomó.
 */
const SIN_SECCION: PropuestaSeccion = {
  sectionId: null,
  confianza: 0,
  motivo: "",
  autoSeleccionar: false,
  reglaId: null,
};

/**
 * Cómo se llama cada tipo en castellano, para el aviso.
 *
 * FACTURA no está, y por eso el aviso no salta con una factura: la tabla ES la
 * condición. Un `if (tipo !== "FACTURA")` habría que mantenerlo en dos sitios.
 */
const NOMBRE_TIPO: Partial<Record<TipoDocumento, string>> = {
  FACTURA_SIMPLIFICADA: "una factura simplificada",
  ALBARAN: "un albarán",
  TICKET: "un ticket",
  PARTE: "un parte de trabajo",
  OTRO: "otro tipo de documento",
};

export function validar(
  extraccion: ExtraccionNormalizada,
  propuesta: PropuestaFormaCobro,
  seccion: PropuestaSeccion = SIN_SECCION,
  toleranciaCentimos: Centimos = TOLERANCIA_CENTIMOS
): PropuestaCobro {
  const avisos: Aviso[] = [];

  if (!extraccion.esFactura) {
    avisos.push({
      codigo: "NO_ES_FACTURA",
      /*
       * «Justificante» y no «factura»: un albarán, un parte de trabajo o un
       * ticket valen igual para cobrar, y en un taller se cobra contra el
       * albarán a menudo. El mensaje decía «no parece una factura» delante de
       * un albarán perfectamente bueno, y un aviso que salta cuando no toca es
       * un aviso que la gente aprende a saltarse.
       */
      mensaje:
        "Este documento no parece un justificante de cobro. Revísalo antes de usar nada de lo " +
        "que se ha rellenado.",
      grave: true,
    });
  }

  /*
   * Qué es el papel, cuando NO es una factura.
   *
   * Aviso leve y no grave: un albarán vale igual para cobrar —en un taller se
   * cobra contra el albarán a menudo y la factura se emite después— así que no
   * apaga ninguna preselección. Pero se dice, porque cobrar contra un albarán
   * no es lo mismo que cobrar contra una factura y quien lo registra tiene
   * derecho a saber qué está firmando.
   *
   * `DESCONOCIDO` no avisa: es «no se ha podido saber», que incluye los
   * análisis anteriores a que existiera este campo. Avisar ahí sería poner un
   * cartel sobre algo que nadie ha mirado.
   */
  if (extraccion.esFactura && NOMBRE_TIPO[extraccion.tipoDocumento]) {
    avisos.push({
      codigo: "TIPO_DE_DOCUMENTO",
      mensaje: `Esto no es una factura: es ${NOMBRE_TIPO[extraccion.tipoDocumento]}. Vale igual para cobrar, pero la factura se emitirá después.`,
      grave: false,
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
  /*
   * ── El abono ─────────────────────────────────────────────────────────────
   *
   * Dos señales independientes y basta con una: el total impreso en negativo,
   * o el papel diciendo ser un abono. A partir de aquí se trabaja con el valor
   * ABSOLUTO —la aritmética, el cuadre con el recibo, la casilla— y el signo
   * lo lleva `esAbono`. Un −59,90 en la casilla del importe es justo lo que el
   * motor rechaza: en la caja el dinero es un importe positivo más una
   * dirección, y la dirección aquí es «sale».
   */
  const totalCrudo = extraccion.totales.totalCentimos;
  const esAbono = (totalCrudo != null && totalCrudo < 0) || extraccion.tipoDocumento === "ABONO";
  const abs = (c: Centimos | null): Centimos | null => (c == null ? null : Math.abs(c));
  const baseCentimos = abs(extraccion.totales.baseCentimos);
  const ivaCentimos = abs(extraccion.totales.ivaCentimos);
  const totalCentimos = abs(totalCrudo);

  if (esAbono && extraccion.esFactura) {
    avisos.push({
      codigo: "ES_ABONO",
      mensaje:
        "Esto es un ABONO: el dinero se devuelve al cliente, no se cobra. Se registra como abono, " +
        "con la forma de pago por la que se devuelve.",
      grave: false,
    });
  }
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
  const importeRecibo = abs(extraccion.recibo.importeCentimos);
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
   * ── El total CORROBORADO manda sobre lo que el modelo opine de sí mismo ───
   *
   * La confianza que devuelve el modelo es una sola fuente, y es la suya. Pero
   * en este papel hay hasta dos comprobaciones independientes del total:
   *
   *   · El resguardo de la tarjeta dice el mismo importe.
   *   · La base más el IVA lo suman.
   *
   * Dos lecturas que coinciden valen más que una que se declara segura. Sin
   * esto pasaba lo que tenía que pasar: un albarán donde el total se leyó bien
   * Y cuadraba con el ticket al céntimo dejaba la casilla del importe VACÍA
   * —porque el modelo se había puesto un 0,6— y el botón decía «Confirmar
   * cobro de 0,00 €». La pantalla tenía la prueba delante y la tiraba.
   *
   * Solo SUBE la confianza hasta el umbral de rellenar, nunca la baja: lo que
   * ya venía por debajo por otros motivos sigue su camino.
   */
  const cuadraConElRecibo =
    extraccion.recibo.detectado &&
    importeRecibo != null &&
    totalCentimos != null &&
    Math.abs(importeRecibo - totalCentimos) <= toleranciaCentimos;

  const cuadraElIva =
    baseCentimos != null &&
    ivaCentimos != null &&
    totalCentimos != null &&
    Math.abs(baseCentimos + ivaCentimos - totalCentimos) <= 1;

  const totalCorroborado = cuadraConElRecibo || cuadraElIva;
  const confianzaDelTotal = totalCorroborado
    ? Math.max(extraccion.confianza.total, UMBRALES.rellenar)
    : extraccion.confianza.total;

  /*
   * Y lo que se lee pero NO se rellena, se dice.
   *
   * Un campo que el modelo leyó y que se descarta por poca seguridad dejaba la
   * casilla vacía y ningún aviso: quien mira ve un hueco y no sabe si es que
   * no había nada en el papel o que no nos fiamos. Son dos cosas distintas y
   * la segunda se arregla mirando el papel un segundo.
   *
   * No se rellena igualmente —un número inventado en un campo que luego
   * controla duplicados es peor que un hueco— pero se enseña lo que se leyó
   * para que se pueda copiar si es bueno.
   */
  if (extraccion.numeroFactura && extraccion.confianza.numeroFactura < UMBRALES.revisar) {
    avisos.push({
      codigo: "LEIDO_SIN_SEGURIDAD",
      mensaje: `El número del documento se ha leído como «${extraccion.numeroFactura}», pero con poca seguridad, así que no se ha rellenado. Compruébalo y escríbelo.`,
      grave: false,
    });
  }
  if (totalCentimos != null && !totalCorroborado && extraccion.confianza.total < UMBRALES.revisar) {
    avisos.push({
      codigo: "LEIDO_SIN_SEGURIDAD",
      mensaje: `El total se ha leído como ${formatearEuros(totalCentimos)} €, pero con poca seguridad y sin nada con qué contrastarlo, así que no se ha rellenado. Compruébalo y escríbelo.`,
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

  /*
   * La sección se degrada igual, y con más motivo: un aviso grave dice que hay
   * algo raro en el papel, y cambiar solo el negocio al que va el dinero es
   * precisamente lo que nadie miraría después.
   *
   * Se conserva la PROPUESTA —sigue siendo información útil— y lo que se apaga
   * es que se marque sola. Misma degradación, mismo motivo.
   */
  const seccionPropuesta: PropuestaSeccion = hayGraves
    ? { ...seccion, autoSeleccionar: false }
    : seccion;

  const nombreCliente = extraccion.cliente.nombre;

  return {
    referencia: campo(extraccion.numeroFactura, extraccion.confianza.numeroFactura, null),
    importeCentimos: campo(totalCentimos, confianzaDelTotal, null),
    cliente: campo(nombreCliente, extraccion.confianza.cliente, null),
    proveedor: campo(extraccion.emisor.nombre, extraccion.confianza.emisor, null),
    concepto: campo(extraccion.concepto, extraccion.confianza.concepto, null),
    formaCobro,
    seccion: seccionPropuesta,
    esAbono,
    importeCuadra,
    avisos,
    // Lo rellena el servicio si el histórico dice que ya se cobró: aquí no se
    // consulta nada, que es lo que permite probar esta pieza sin base de datos.
    cobroPrevio: null,
    extra: extraccion,
  };
}
