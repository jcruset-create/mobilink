/**
 * Textos de las notificaciones al cliente. Puros: reciben los datos y
 * devuelven asunto y cuerpo. El envío lo hace `service.ts` por el canal común
 * de correo de Mobilink (`server/mail.ts`), sin un sistema paralelo.
 */

export const PLANTILLAS = [
  "contract.generated",
  "contract.accepted",
  "invoice.issued",
  "payment.succeeded",
  "payment.failed",
  "invoice.overdue",
  "dunning.first_notice",
  "dunning.second_notice",
  "dunning.suspended",
  "staff.subscription_cancelled",
] as const;
export type Plantilla = (typeof PLANTILLAS)[number];

export type DatosPlantilla = {
  cliente?: string;
  contrato?: string;
  trastero?: string;
  factura?: string;
  importe?: string;
  vencimiento?: string;
  motivo?: string;
  empresa?: string;
};

export function componer(p: Plantilla, d: DatosPlantilla): { subject: string; body: string } {
  const hola = `Hola${d.cliente ? ` ${d.cliente}` : ""},`;
  const firma = `\n\n${d.empresa ?? "Mobilink Self Storage"}`;
  switch (p) {
    case "contract.generated":
      return { subject: `Tu contrato ${d.contrato} está listo para revisar`, body: `${hola}\n\nHemos preparado el contrato ${d.contrato} del trastero ${d.trastero}. Puedes revisarlo y aceptarlo desde tu portal de cliente.${firma}` };
    case "contract.accepted":
      return { subject: `Contrato ${d.contrato} aceptado`, body: `${hola}\n\nHemos registrado la aceptación del contrato ${d.contrato}. Encontrarás una copia en tu portal de cliente.${firma}` };
    case "invoice.issued":
      return { subject: `Factura ${d.factura}`, body: `${hola}\n\nSe ha emitido la factura ${d.factura} por ${d.importe}${d.vencimiento ? `, con vencimiento el ${d.vencimiento}` : ""}. Puedes descargarla desde tu portal de cliente.${firma}` };
    case "payment.succeeded":
      return { subject: `Pago recibido · ${d.factura}`, body: `${hola}\n\nHemos recibido el pago de ${d.importe} de la factura ${d.factura}. Gracias.${firma}` };
    case "payment.failed":
      return { subject: `No hemos podido cobrar la factura ${d.factura}`, body: `${hola}\n\nEl cobro de ${d.importe} de la factura ${d.factura} no se ha podido completar${d.motivo ? ` (${d.motivo})` : ""}. Puedes pagarla desde tu portal de cliente.${firma}` };
    case "invoice.overdue":
      return { subject: `Factura ${d.factura} vencida`, body: `${hola}\n\nLa factura ${d.factura} por ${d.importe} está vencida y pendiente de pago.${firma}` };
    case "dunning.first_notice":
      return { subject: `Recordatorio: factura ${d.factura} pendiente`, body: `${hola}\n\nTe recordamos que la factura ${d.factura} por ${d.importe} sigue pendiente de pago.${firma}` };
    case "dunning.second_notice":
      return { subject: `Segundo aviso: factura ${d.factura} pendiente`, body: `${hola}\n\nLa factura ${d.factura} por ${d.importe} sigue pendiente. Si no se regulariza, el acceso al trastero quedará suspendido.${firma}` };
    case "dunning.suspended":
      return { subject: `Acceso suspendido · contrato ${d.contrato}`, body: `${hola}\n\nPor el impago de la factura ${d.factura}, el contrato ${d.contrato} ha quedado suspendido. En cuanto se pague, se restablecerá.${firma}` };
    case "staff.subscription_cancelled":
      return { subject: `Stripe ha cancelado la suscripción del contrato ${d.contrato}`, body: `La suscripción de Stripe del contrato ${d.contrato} se ha cancelado sin que Mobilink lo pidiera. El contrato NO se ha finalizado: revísalo y decide qué hacer.` };
  }
}
