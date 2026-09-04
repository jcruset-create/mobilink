/**
 * Plantillas de cobro.
 *
 * Un enlace de pago casi nunca viaja solo: va dentro de un mensaje que dice al
 * cliente qué está pagando y bajo qué condiciones. Ese texto no es decoración.
 * En la paga y señal de neumáticos es lo que sostiene que el importe no sea
 * reembolsable, así que tiene que salir siempre igual, sin que dependa de lo
 * que recuerde escribir quien esté en el mostrador.
 *
 * De ahí la separación entre `condiciones` y `mensaje`: lo que el cliente
 * acepta al pagar son las condiciones, y es eso —no el saludo ni el enlace— lo
 * que se guarda junto al cobro como prueba. El mensaje es el envoltorio para
 * WhatsApp y puede cambiar de forma sin tocar lo que se aceptó.
 *
 * Se calcula en céntimos enteros y solo se formatea al pintar, como en el resto
 * de la casa: un `parseFloat` en medio de una resta convierte los 200 € de
 * resto en 199,99999999999997.
 */

export type IdPlantilla = "libre" | "senal-neumaticos";

/** Datos con los que se rellena una plantilla. */
export type DatosPlantilla = {
  cliente: string;
  /** Lo que se cobra ahora (el enlace de Stripe), en céntimos. */
  senalCentimos: number;
  /** Presupuesto total, en céntimos. Cero en plantillas que no lo piden. */
  totalCentimos: number;
  /** Concepto escrito en el formulario. */
  concepto: string;
  /** URL de Stripe ya creada. */
  enlace: string;
};

export type Plantilla = {
  id: IdPlantilla;
  nombre: string;
  /** Ayuda de una línea para el selector. */
  descripcion: string;
  /** Lo que se propone en "Descripción / Concepto" al elegirla. */
  conceptoPorDefecto: string;
  /** Si necesita el importe total del presupuesto además de la señal. */
  pideTotal: boolean;
  /**
   * Condiciones que el cliente acepta al pagar. Cadena vacía si la plantilla
   * no impone ninguna: entonces no hay nada que guardar como aceptado.
   */
  condiciones(datos: DatosPlantilla): string;
  /** Mensaje completo listo para enviar. */
  mensaje(datos: DatosPlantilla): string;
};

/**
 * "250 €", "50,50 €".
 *
 * Sin los céntimos cuando son cero: las condiciones se leen en el móvil del
 * cliente y "250 €" es lo que esperaría ver en un presupuesto.
 *
 * Es un formateador propio del módulo a propósito. El de caja
 * (`cash/utils/money`) siempre pinta los dos decimales porque allí cuadra un
 * arqueo; aquí el texto es para leer, no para cuadrar.
 */
export function euros(centimos: number): string {
  const enteros = Math.floor(Math.abs(centimos) / 100);
  const resto = Math.abs(centimos) % 100;
  const miles = String(enteros).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const signo = centimos < 0 ? "-" : "";
  return resto === 0
    ? `${signo}${miles} €`
    : `${signo}${miles},${String(resto).padStart(2, "0")} €`;
}

/**
 * Lee un importe escrito por una persona y lo pasa a céntimos. 0 si no es uno.
 *
 * Acepta la coma aunque el `input type="number"` mande punto: en el móvil se
 * pega el importe desde el presupuesto y viene con coma más veces de las que
 * parece.
 */
export function aCentimos(texto: string): number {
  const limpio = String(texto).trim().replace(/\s|€/g, "").replace(",", ".");
  if (!limpio) return 0;
  const n = Number(limpio);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
}

function saludo(cliente: string): string {
  const nombre = cliente.trim();
  return nombre ? `Hola ${nombre}` : "Hola";
}

/**
 * El mensaje que se venía enviando antes de que hubiera plantillas.
 *
 * Se conserva tal cual para que elegir "Sin plantilla" no cambie lo que ya
 * funcionaba: quien solo quiere mandar un enlace no tiene que leerse nada.
 */
const LIBRE: Plantilla = {
  id: "libre",
  nombre: "Sin plantilla",
  descripcion: "Mensaje corto con el enlace y el importe.",
  conceptoPorDefecto: "",
  pideTotal: false,
  condiciones: () => "",
  mensaje: ({ cliente, senalCentimos, concepto, enlace }) => {
    const desc = concepto.trim();
    return `${saludo(cliente)}, para confirmar la asistencia puede realizar la paga y señal aquí:

${enlace}

Importe: ${euros(senalCentimos)}${desc ? `\nConcepto: ${desc}` : ""}`;
  },
};

/**
 * Paga y señal de un pedido de neumáticos.
 *
 * El texto va literal y no se deja editar desde la pantalla: es el que se
 * acordó, y una condición de no reembolso reescrita a mano en cada envío no
 * sirve para nada el día que hay que apoyarse en ella.
 */
const SENAL_NEUMATICOS: Plantilla = {
  id: "senal-neumaticos",
  nombre: "Paga y señal de neumáticos",
  descripcion:
    "Condiciones del pedido: señal no reembolsable una vez pedido al proveedor.",
  conceptoPorDefecto: "Paga y señal pedido de neumáticos",
  pideTotal: true,
  condiciones: ({ senalCentimos, totalCentimos }) => {
    const senal = euros(senalCentimos);
    return `• Importe total del presupuesto: ${euros(totalCentimos)}
• Paga y señal para confirmar el pedido: ${senal}
• Importe restante: ${euros(totalCentimos - senalCentimos)}

La paga y señal de ${senal} se destina a confirmar el pedido y proceder a encargar los neumáticos al proveedor.

Una vez realizado el pedido de los neumáticos al proveedor, la paga y señal de ${senal} no será reembolsable en caso de cancelación o desistimiento por parte del cliente.

En caso de que no podamos suministrar los neumáticos solicitados por una causa imputable a nosotros o a nuestro proveedor, se devolverá íntegramente la cantidad entregada.

Al realizar el pago mediante el siguiente enlace, el cliente declara haber leído y aceptado estas condiciones y autoriza la realización del pedido.`;
  },
  mensaje: (datos) =>
    `${saludo(datos.cliente)}, le enviamos las condiciones para confirmar su pedido de neumáticos:

${SENAL_NEUMATICOS.condiciones(datos)}

${datos.enlace}`,
};

export const PLANTILLAS: Plantilla[] = [LIBRE, SENAL_NEUMATICOS];

/** La plantilla con ese id, o la libre si el id no existe (o viene de una versión vieja). */
export function plantillaPorId(id: string | null | undefined): Plantilla {
  return PLANTILLAS.find((p) => p.id === id) ?? LIBRE;
}

/**
 * Qué impide enviar este cobro, o null si se puede.
 *
 * Vive aquí y no en la pantalla porque son reglas de la plantilla: el resto
 * (importe mínimo de Stripe) ya lo valida el servidor, pero un total menor que
 * la señal produce un "Importe restante: -50 €" que el cliente sí leería.
 */
export function errorDeImportes(
  plantilla: Plantilla,
  senalCentimos: number,
  totalCentimos: number
): string | null {
  if (senalCentimos < 100) return "El importe mínimo es 1 €.";
  if (!plantilla.pideTotal) return null;
  if (totalCentimos < 100) return "Falta el importe total del presupuesto.";
  if (totalCentimos < senalCentimos)
    return "El total del presupuesto no puede ser menor que la paga y señal.";
  return null;
}
