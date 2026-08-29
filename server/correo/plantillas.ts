/**
 * Los correos que el sistema manda sobre una asistencia.
 *
 * Son cinco y cada uno pide UNA cosa. Es deliberado: un correo que pide el
 * albarán y de paso la factura y de paso confirma datos acaba sin contestar,
 * porque quien lo lee no sabe qué se espera de él. Uno que dice «falta el
 * albarán del servicio AST-4210» se contesta.
 *
 * Ninguna plantilla lleva importes internos ni costes. Estos correos salen
 * hacia talleres y proveedores, y lo que cruza por correo no se puede retirar.
 */

import { asuntoConReferencia } from "./referencia.ts";

export const MOTIVOS = [
  "confirmacion",        // te confirmamos que el servicio está en marcha
  "solicitud_aceptacion",
  "solicitud_albaran",
  "solicitud_factura",
  "recordatorio_albaran",
  "recordatorio_factura",
] as const;

export type Motivo = (typeof MOTIVOS)[number];

export function esMotivo(v: unknown): v is Motivo {
  return typeof v === "string" && (MOTIVOS as readonly string[]).includes(v);
}

/** Lo que hace falta saber de la asistencia para escribir el correo. */
export type DatosCorreo = {
  expediente: string;
  matricula?: string | null;
  direccion?: string | null;
  fechaServicio?: number | null;
  descripcion?: string | null;
  /** Quién manda el correo, para la firma. */
  remitente?: string | null;
  /** Cuántas veces se ha pedido ya. Cambia el tono, no el contenido. */
  intento?: number;
};

export type Mensaje = { asunto: string; texto: string };

function fecha(ms: number | null | undefined): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString("es-ES", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

/** La cabecera común: de qué servicio se habla. Siempre la misma, para que se reconozca. */
function encabezado(d: DatosCorreo): string {
  const partes = [
    `Expediente: ${d.expediente}`,
    d.matricula ? `Matrícula: ${d.matricula}` : null,
    d.fechaServicio ? `Fecha del servicio: ${fecha(d.fechaServicio)}` : null,
    d.direccion ? `Lugar: ${d.direccion}` : null,
  ].filter(Boolean);
  return partes.join("\n");
}

function firma(d: DatosCorreo): string {
  return d.remitente ? `\n\n${d.remitente}\nMobilink Assist` : "\n\nMobilink Assist";
}

/**
 * Construye el mensaje.
 *
 * El asunto lleva SIEMPRE la referencia, y por eso pasa por
 * `asuntoConReferencia`: es lo que permite reconocer la respuesta aunque
 * reenvíen el correo a otra persona.
 */
export function construirMensaje(motivo: Motivo, d: DatosCorreo): Mensaje {
  const intento = Math.max(1, Number(d.intento ?? 1));
  const cab = encabezado(d);

  switch (motivo) {
    case "confirmacion":
      return {
        asunto: asuntoConReferencia(`Servicio en marcha · ${d.expediente}`, d.expediente),
        texto: `Hola,\n\nConfirmamos que el servicio está en marcha.\n\n${cab}` +
          (d.descripcion ? `\n\nServicio: ${d.descripcion}` : "") +
          `\n\nSi necesitas algo, responde a este correo sin cambiar el asunto: así la` +
          ` respuesta queda en el expediente.${firma(d)}`,
      };

    case "solicitud_aceptacion":
      return {
        asunto: asuntoConReferencia(`¿Podéis atender este servicio? · ${d.expediente}`, d.expediente),
        texto: `Hola,\n\nTenemos un servicio y queremos saber si podéis atenderlo.\n\n${cab}` +
          (d.descripcion ? `\n\nServicio: ${d.descripcion}` : "") +
          `\n\nContesta a este correo indicando si lo aceptáis y en cuánto tiempo` +
          ` podríais estar allí.${firma(d)}`,
      };

    case "solicitud_albaran":
    case "recordatorio_albaran":
      return {
        asunto: asuntoConReferencia(
          `${intento > 1 ? "Recordatorio: falta" : "Falta"} el albarán · ${d.expediente}`,
          d.expediente,
        ),
        texto: `Hola,\n\n${
          intento > 1
            ? `Volvemos a escribir porque seguimos sin el albarán de este servicio.`
            : `Nos falta el albarán firmado de este servicio para poder cerrarlo.`
        }\n\n${cab}\n\nPuedes responder a este correo con el albarán adjunto; se` +
          ` guarda solo en el expediente.${firma(d)}`,
      };

    case "solicitud_factura":
    case "recordatorio_factura":
      return {
        asunto: asuntoConReferencia(
          `${intento > 1 ? "Recordatorio: falta" : "Falta"} la factura · ${d.expediente}`,
          d.expediente,
        ),
        texto: `Hola,\n\n${
          intento > 1
            ? `Seguimos esperando la factura de este servicio.`
            : `Nos falta vuestra factura de este servicio.`
        }\n\n${cab}\n\nAdjúntala respondiendo a este correo, sin cambiar el asunto.${firma(d)}`,
      };
  }
}

/**
 * Cada cuánto se puede insistir con el mismo motivo.
 *
 * Creciente a propósito: 2 días, luego 4, luego 7. Un recordatorio diario no
 * consigue el albarán antes, consigue que el taller marque el remitente como
 * correo no deseado — y entonces se pierden también los que sí importan.
 */
const ESPERAS_DIAS = [2, 4, 7];

export function esperaHastaSiguienteMs(intentosPrevios: number): number {
  const dias = ESPERAS_DIAS[Math.min(Math.max(0, intentosPrevios - 1), ESPERAS_DIAS.length - 1)];
  return dias * 24 * 60 * 60 * 1000;
}

/** Máximo de recordatorios por motivo antes de dejarlo para una persona. */
export const MAX_RECORDATORIOS = 3;

/**
 * Si toca mandar el recordatorio.
 *
 * Devuelve el motivo por el que NO, cuando no toca: la bandeja de excepciones
 * necesita poder decir «lleva 3 avisos sin respuesta» en vez de callarse.
 */
export function tocaRecordar(
  estado: { intentos: number; ultimoEnvioMs: number | null; resuelto: boolean },
  ahoraMs: number,
): { toca: boolean; motivo?: "resuelto" | "demasiados" | "aun_no" } {
  if (estado.resuelto) return { toca: false, motivo: "resuelto" };
  if (estado.intentos >= MAX_RECORDATORIOS) return { toca: false, motivo: "demasiados" };
  if (estado.ultimoEnvioMs == null) return { toca: true };
  const espera = esperaHastaSiguienteMs(estado.intentos);
  return ahoraMs - estado.ultimoEnvioMs >= espera ? { toca: true } : { toca: false, motivo: "aun_no" };
}
