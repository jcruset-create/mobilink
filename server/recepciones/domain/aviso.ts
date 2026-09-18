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
 * Que ha llegado, dónde, y QUÉ ha llegado: la descripción de cada línea con
 * sus unidades. Sin precios ni importes: para saber que hay que ir a recoger
 * un palé hace falta saber qué hay dentro, no lo que costó.
 *
 * ── Lo que WhatsApp no admite en una variable ───────────────────────────────
 *
 * El valor de una variable de plantilla NO puede llevar saltos de línea, ni
 * tabuladores, ni cuatro espacios seguidos: Meta rechaza el envío entero, no
 * la variable. Así que la lista de material va en UNA sola variable con las
 * líneas separadas por « · », y pasa por `limpiarParaPlantilla` antes de
 * salir. Tampoco puede ir vacía, de ahí el respaldo con el número de albarán.
 *
 * Y el cuerpo de la plantilla tiene un tope de 1.024 caracteres, que se lo
 * come un albarán de veinte líneas: la lista se corta en `LARGO_MATERIAL` y
 * acaba en «y N más», que es información, no un texto truncado a medias.
 */

/** Una línea de lo que ha llegado: qué y cuántas. */
export type LineaAviso = { descripcion: string; cantidad: number };

export type DatosAviso = {
  /** A quién: lo que decía la observación del albarán, ya sin el teléfono. */
  destinatario: string | null;
  telefono: string | null;
  centroNombre: string;
  resultado: "OK" | "CON_INCIDENCIA";
  /** La empresa que firma el mensaje. */
  empresaNombre: string;
  /** El material recibido, para decir QUÉ ha llegado. */
  lineas: LineaAviso[];
  /** El número del albarán del proveedor. Respaldo cuando no hay líneas. */
  albaranNumero: string;
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

/** Cuánto ocupa como máximo la lista de material dentro del mensaje. */
export const LARGO_MATERIAL = 700;

/**
 * Deja un texto en condiciones de viajar como variable de plantilla: sin
 * saltos de línea, sin tabuladores y sin espacios de sobra. Meta rechaza el
 * mensaje completo si una variable los trae, y un albarán mal leído puede
 * meter cualquier cosa en la descripción.
 */
export function limpiarParaPlantilla(valor: string): string {
  return valor.replace(/\s+/g, " ").trim();
}

/** «2», «1,5»: sin decimales cuando es entero, y con coma cuando no. */
function comoCantidad(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n).replace(".", ",");
}

/** «245/70 R17.5 HANKOOK AH35 136M (2 uds.)» */
function unaLinea(l: LineaAviso): string {
  const descripcion = limpiarParaPlantilla(l.descripcion) || "Material";
  const unidad = l.cantidad === 1 ? "ud." : "uds.";
  return `${descripcion} (${comoCantidad(l.cantidad)} ${unidad})`;
}

/**
 * La lista de material para el mensaje, en una sola línea.
 *
 * Se dejan fuera las líneas sin nada recibido: en un aviso de que ha llegado
 * la mercancía, un «(0 uds.)» sólo confunde. Si al final no queda ninguna
 * —o no había—, se dice el albarán, porque la variable no puede ir vacía.
 */
export function textoMaterial(datos: DatosAviso): string {
  const partes = datos.lineas.filter((l) => l.cantidad > 0).map(unaLinea);
  if (partes.length === 0) {
    const albaran = limpiarParaPlantilla(datos.albaranNumero);
    return albaran ? `Albarán ${albaran}` : "Material recibido";
  }

  const cabe: string[] = [];
  let largo = 0;
  for (const parte of partes) {
    const suma = largo + (cabe.length ? 3 : 0) + parte.length;
    if (cabe.length > 0 && suma > LARGO_MATERIAL) break;
    cabe.push(parte);
    largo = suma;
  }
  // Una sola línea larguísima se corta: más vale media descripción que un
  // mensaje que Meta rechaza por pasarse del cuerpo.
  if (cabe.length === 1 && cabe[0].length > LARGO_MATERIAL) cabe[0] = `${cabe[0].slice(0, LARGO_MATERIAL - 1).trimEnd()}…`;

  const faltan = partes.length - cabe.length;
  return faltan > 0 ? `${cabe.join(" · ")} y ${faltan} más` : cabe.join(" · ");
}

/** A quién se le habla. Sin nombre, se le trata de usted sin inventarse uno. */
export function saludo(destinatario: string | null): string {
  const nombre = limpiarParaPlantilla(destinatario ?? "");
  return nombre ? `Hola ${nombre}` : "Hola";
}

/**
 * El texto del aviso. Es el mismo que hay que dar de alta como plantilla en
 * Twilio, con tres variables: {{1}} el saludo, {{2}} el centro y {{3}} el
 * material.
 *
 * Se usa tal cual cuando se puede escribir libremente (dentro de las 24 horas
 * de una conversación abierta) y como referencia de la plantilla cuando no.
 */
export function textoAviso(datos: DatosAviso): string {
  return `${saludo(datos.destinatario)}: ha llegado tu material a ${limpiarParaPlantilla(datos.centroNombre)}.\n${textoMaterial(datos)}\n— ${datos.empresaNombre}`;
}

/** Las variables de la plantilla de Twilio, en su orden. */
export function variablesPlantilla(datos: DatosAviso): Record<string, string> {
  return {
    "1": saludo(datos.destinatario),
    "2": limpiarParaPlantilla(datos.centroNombre) || "el centro",
    "3": textoMaterial(datos),
  };
}

/**
 * El cuerpo EXACTO que hay que dar de alta como plantilla en Twilio. Se sirve
 * a la pantalla de avisos para poder copiarlo sin transcribirlo a mano: si
 * cambia el texto de aquí y no el de Twilio, el mensaje que sale es el de
 * Twilio, y el desajuste no lo avisa nadie.
 */
export function cuerpoPlantilla(empresaNombre: string): string {
  return `{{1}}: ha llegado tu material a {{2}}.\n{{3}}\n— ${empresaNombre}`;
}
