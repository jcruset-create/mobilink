/**
 * Qué forma de cobro propone Mobilink Cash, y con qué derecho.
 *
 * Esta es la pieza que decide dinero, así que es la más conservadora del
 * módulo y la única que no habla con nadie: entra la evidencia que se leyó del
 * papel, entran las reglas de la empresa y entra su catálogo de formas de
 * cobro, y sale una propuesta. Sin base de datos, sin red, sin IA. Por eso se
 * puede probar entera y por eso sus invariantes son de verdad invariantes.
 *
 * La regla que manda sobre todas las demás:
 *
 *     NO HAY TPV  ≠  ES EFECTIVO
 *
 * Que en el papel no venga un resguardo de tarjeta no dice cómo se cobró:
 * pudo ser una transferencia, un TPV cuyo ticket nadie escaneó, o un cobro que
 * todavía está por clasificar. Convertir esa ausencia en una certeza es
 * exactamente el error que este módulo existe para no cometer.
 *
 * La segunda regla, aprendida de las facturas de verdad: las reglas miran
 * CAMPOS, no el texto suelto del recibo. En la factura B0020000580 —cobrada
 * por un TPV de BBVA— el ticket imprime, literalmente, «LBL : Visa CaixaBank».
 * Una regla de «si pone CaixaBank, es CaixaBank» la clasificaría mal. El campo
 * que sí identifica al adquirente es otro, y por eso cada regla dice en qué
 * campo mira.
 */

import type { Centimos } from "../domain/money.ts";

/** En qué dato del recibo mira una regla. */
export type CampoRegla =
  | "ADQUIRENTE"
  | "COMERCIO"
  | "TERMINAL"
  | "RED"
  | "CUENTA"
  | "PLANTILLA"
  | "TEXTO";

/**
 * De dónde ha salido el resguardo, que es más informativo que cualquier
 * palabra suelta:
 *
 * - `INTEGRADO_ERP`: lo imprime la propia factura, con su misma tipografía y
 *   sus mismas columnas. Es el TPV integrado con el ERP.
 * - `TICKET_BANCO`: es el papelito del datáfono, pegado o fotografiado encima
 *   de la factura, con su logotipo y su formato de ticket.
 */
export type PlantillaRecibo = "INTEGRADO_ERP" | "TICKET_BANCO" | "DESCONOCIDA";

/** Una regla del maestro de la empresa. */
export type ReglaFormaCobro = {
  id: number;
  campo: CampoRegla;
  /** Lo que se busca. Se compara sin acentos, sin mayúsculas y por trozos. */
  patron: string;
  /** Código del catálogo de formas de cobro DE ESA EMPRESA. */
  formaPago: string;
  /** Cuánta fe merece esta regla, de 0 a 1. */
  confianza: number;
  /** Si además puede quedar preseleccionada sola en la pantalla. */
  autoSeleccionar: boolean;
  /** Primero las de número más bajo. Empates, por id. */
  prioridad: number;
};

/** La evidencia leída del papel, ya normalizada. */
export type EvidenciaCobro = {
  reciboDetectado: boolean;
  importeReciboCentimos: Centimos | null;
  adquirente: string | null;
  comercio: string | null;
  terminal: string | null;
  red: string | null;
  cuenta: string | null;
  plantilla: PlantillaRecibo;
  /** El recibo entero, para las reglas de tipo TEXTO. */
  textoRecibo: string | null;
  /** Lo que el modelo dice que le merece el propio recibo. */
  confianzaRecibo: number;
};

export type PropuestaFormaCobro = {
  /** Código del catálogo, o null: null es NO LO SÉ, nunca «efectivo». */
  formaPago: string | null;
  confianza: number;
  /** En castellano y para una persona: es lo que se enseña y lo que se audita. */
  motivo: string;
  /** Si la pantalla puede marcar el botón sola. */
  autoSeleccionar: boolean;
  /** Regla que ha decidido, para poder rehacer el camino meses después. */
  reglaId: number | null;
};

/**
 * Umbral propio de la forma de cobro, más exigente que el de los demás campos.
 *
 * Equivocar el concepto de un cobro se arregla escribiéndolo bien. Equivocar
 * la forma de cobro mete dinero en el cajón que no está en el cajón, o al
 * revés, y eso no aparece hasta el arqueo.
 */
export const UMBRAL_FORMA_COBRO = 0.9;

/** Sin acentos, sin mayúsculas y sin espacios de más: como se compara todo. */
function llano(texto: string | null | undefined): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function valorDelCampo(campo: CampoRegla, e: EvidenciaCobro): string | null {
  switch (campo) {
    case "ADQUIRENTE":
      return e.adquirente;
    case "COMERCIO":
      return e.comercio;
    case "TERMINAL":
      return e.terminal;
    case "RED":
      return e.red;
    case "CUENTA":
      return e.cuenta;
    case "PLANTILLA":
      return e.plantilla;
    case "TEXTO":
      return e.textoRecibo;
  }
}

/**
 * Cómo se compara el patrón con el valor del campo.
 *
 * Los campos identificativos —comercio, terminal— se comparan ENTEROS: el
 * comercio «702» no puede casar con «17023», que es de otro sitio. Los campos
 * descriptivos —adquirente, red, y el texto entero— se comparan por trozos,
 * porque lo que se imprime alrededor cambia de un ticket a otro.
 */
function casa(campo: CampoRegla, patron: string, valor: string): boolean {
  const p = llano(patron);
  const v = llano(valor);
  if (!p || !v) return false;
  if (campo === "COMERCIO" || campo === "TERMINAL" || campo === "PLANTILLA") return p === v;
  return v.includes(p);
}

/**
 * La propuesta de forma de cobro.
 *
 * `catalogo` son los códigos que la empresa tiene dados de alta AHORA. Se pasa
 * entero a propósito: una regla que apunta a una forma que se dio de baja no
 * puede proponer un código que la pantalla no sabe dibujar ni el servidor
 * aceptar, así que se salta y se dice por qué.
 */
export function clasificar(
  evidencia: EvidenciaCobro,
  reglas: readonly ReglaFormaCobro[],
  catalogo: ReadonlySet<string>
): PropuestaFormaCobro {
  /*
   * Puerta 1: sin resguardo no hay nada que clasificar.
   *
   * Ni siquiera se miran las reglas. Aunque alguien configurara una regla que
   * casara con el texto de la factura, sin recibo no hay evidencia de cómo se
   * pagó, y una regla no puede fabricarla.
   */
  if (!evidencia.reciboDetectado) {
    return {
      formaPago: null,
      confianza: 0,
      motivo:
        "No se ha encontrado ningún justificante de pago en el documento. " +
        "Eso no quiere decir que se cobrara en efectivo: elige tú la forma de cobro.",
      autoSeleccionar: false,
      reglaId: null,
    };
  }

  const ordenadas = [...reglas].sort((a, b) => a.prioridad - b.prioridad || a.id - b.id);

  const descartadas: string[] = [];
  for (const regla of ordenadas) {
    const valor = valorDelCampo(regla.campo, evidencia);
    if (!valor || !casa(regla.campo, regla.patron, valor)) continue;

    if (!catalogo.has(regla.formaPago)) {
      // Se apunta y se sigue: puede haber otra regla buena detrás, y callarse
      // esto dejaría al usuario sin entender por qué no se propone nada.
      descartadas.push(regla.formaPago);
      continue;
    }

    /*
     * La confianza de la propuesta es la MENOR entre la de la regla y la que
     * el modelo le da a haber leído bien el recibo. Una regla infalible sobre
     * un recibo que el modelo apenas ha podido leer no es una certeza.
     */
    const confianza = Math.min(regla.confianza, evidencia.confianzaRecibo);
    return {
      formaPago: regla.formaPago,
      confianza,
      motivo: `Regla «${regla.patron}» sobre ${etiquetaCampo(regla.campo)}: ${valor}`,
      autoSeleccionar: regla.autoSeleccionar && confianza >= UMBRAL_FORMA_COBRO,
      reglaId: regla.id,
    };
  }

  /*
   * Puerta 2: hay recibo pero ninguna regla lo reconoce.
   *
   * Se dice que hay un pago con tarjeta —eso SÍ se ha visto— pero no de quién
   * es el TPV, que es lo que hace falta para elegir el botón. Proponer «la
   * primera forma de tarjeta del catálogo» sería inventar.
   */
  return {
    formaPago: null,
    confianza: 0,
    motivo:
      descartadas.length > 0
        ? `Hay un justificante de pago, y una regla lo reconoce, pero apunta a una forma de cobro que ya no está en el catálogo (${descartadas.join(", ")}).`
        : "Hay un justificante de pago, pero ninguna regla configurada reconoce este TPV. Configúrala en Configuración → Formas de cobro para que la próxima vez se proponga sola.",
    autoSeleccionar: false,
    reglaId: null,
  };
}

function etiquetaCampo(campo: CampoRegla): string {
  switch (campo) {
    case "ADQUIRENTE":
      return "el adquirente";
    case "COMERCIO":
      return "el número de comercio";
    case "TERMINAL":
      return "el terminal";
    case "RED":
      return "la red";
    case "CUENTA":
      return "la cuenta";
    case "PLANTILLA":
      return "el tipo de resguardo";
    case "TEXTO":
      return "el texto del resguardo";
  }
}
