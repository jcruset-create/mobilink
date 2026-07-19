/**
 * Modelo NORMALIZADO del Communication Hub (§2.3).
 *
 * Los módulos de Mobilink piden "envía este presupuesto al cliente" sin saber si
 * saldrá por WhatsApp, email u otro canal: el Hub elige el conector y normaliza
 * el resultado. Las plantillas de texto viven en la capa de conectores.
 */

export type CommChannel = "whatsapp" | "email" | "sms" | "push" | "teams";

/** Tipos de comunicación soportados (las 6 funciones del §2.3). */
export type CommKind =
  | "quote" // SendQuote
  | "appointment" // SendAppointment
  | "work_order_status" // SendWorkOrderStatus
  | "approval_request" // RequestApproval
  | "signature_request" // RequestSignature
  | "invoice"; // SendInvoiceNotification

export interface CommRecipient {
  name?: string;
  /** Teléfono en formato internacional (+34...). Requerido para whatsapp/sms. */
  phone?: string;
  /** Requerido para email. */
  email?: string;
}

/** Datos de negocio que alimentan la plantilla de cada tipo de mensaje. */
export interface CommData {
  /** Nº de presupuesto/factura/OT según el kind. */
  documentNumber?: string;
  amount?: number;
  currency?: string;
  /** Fecha/hora (ISO) para citas. */
  dateTime?: string;
  /** Estado de la OT para work_order_status. */
  status?: string;
  workOrderId?: string;
  /** Enlace (aceptar presupuesto, firmar, pagar...). */
  link?: string;
  /** Texto libre adicional. */
  notes?: string;
}

/** Mensaje normalizado que recibe un conector. */
export interface CommMessage {
  kind: CommKind;
  recipient: CommRecipient;
  data: CommData;
}

export interface CommSendResult {
  channel: CommChannel;
  /** Id del proveedor (SID de Twilio, messageId SMTP...) o SIM-... en simulación. */
  providerMessageId: string;
  simulated: boolean;
  /** Texto realmente enviado (para el audit log). */
  renderedBody: string;
  renderedSubject?: string;
}
