/**
 * El aviso a quien espera la mercancía: cuándo se manda y qué dice.
 *
 * Código PURO. Aquí NO se habla con Twilio ni con la base: se decide, con lo
 * que se sabe de la recepción, si toca avisar y con qué texto. Así la regla
 * —que es la que puede molestar a una persona de verdad— se prueba sin red.
 *
 * ── Cuándo se avisa ─────────────────────────────────────────────────────────
 *
 * Sólo cuando la recepción sale OK. Con incidencia no se manda nada: «ha
 * llegado tu material» sería mentira si falta la mitad, y quien lo espera
 * merece que se lo cuente una persona, no un automatismo.
 *
 * Y hacen falta, además, las cuatro cosas de `motivoParaNoAvisar`: que esté
 * encendido, que el albarán traiga móvil, y que el módulo tenga con qué
 * escribir. Cada «no» tiene su motivo escrito, porque «no llegó el WhatsApp»
 * sin explicación no se puede diagnosticar.
 *
 * ── Qué dice ────────────────────────────────────────────────────────────────
 *
 * Lo justo: que ha llegado y dónde. El detalle está en Mobilink y en el papel;
 * un WhatsApp con las líneas y los precios es mandar por un canal abierto algo
 * que no hace falta para saber que hay que ir a recogerlo.
 */

export type DatosAviso = {
  /** A quién: lo que decía la observación del albarán, ya sin el teléfono. */
  destinatario: string | null;
  telefono: string | null;
  centroNombre: string;
  resultado: "OK" | "CON_INCIDENCIA";
  /** La empresa que firma el mensaje. */
  empresaNombre: string;
};

export type Ajustes = {
  activado: boolean;
  /** Hay credenciales de Twilio y un número emisor. */
  hayCredenciales: boolean;
};

/**
 * Por qué NO se avisa, o `null` si sí toca.
 *
 * El orden importa, porque sólo se guarda UN motivo y tiene que ser el útil:
 * primero la decisión (está apagado), luego lo propio de ESTA recepción —que
 * no cambiaría por arreglar nada—, y al final la fontanería. Que falten las
 * credenciales se ve de un vistazo en la pantalla de avisos; que este albarán
 * no trajera móvil sólo se puede saber aquí.
 */
export function motivoParaNoAvisar(datos: DatosAviso, ajustes: Ajustes): string | null {
  if (!ajustes.activado) return "El aviso por WhatsApp está apagado.";
  if (datos.resultado !== "OK") return "La recepción tiene incidencia: eso se cuenta a mano, no por WhatsApp.";
  if (!datos.telefono) return "El albarán no trae ningún móvil en sus observaciones.";
  if (!ajustes.hayCredenciales) return "Sin credenciales de Twilio: no hay con qué mandarlo.";
  return null;
}

/** A quién se le habla. Sin nombre, se le trata de usted sin inventarse uno. */
export function saludo(destinatario: string | null): string {
  const nombre = (destinatario ?? "").trim();
  return nombre ? `Hola ${nombre}` : "Hola";
}

/**
 * El texto del aviso. Es el mismo que hay que dar de alta como plantilla en
 * Twilio, con dos variables: {{1}} el saludo y {{2}} el centro.
 *
 * Se usa tal cual cuando se puede escribir libremente (dentro de las 24 horas
 * de una conversación abierta) y como referencia de la plantilla cuando no.
 */
export function textoAviso(datos: DatosAviso): string {
  return `${saludo(datos.destinatario)}: ha llegado tu material a ${datos.centroNombre}. — ${datos.empresaNombre}`;
}

/** Las variables de la plantilla de Twilio, en su orden. */
export function variablesPlantilla(datos: DatosAviso): Record<string, string> {
  return { "1": saludo(datos.destinatario), "2": datos.centroNombre };
}
