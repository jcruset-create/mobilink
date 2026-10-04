/**
 * Proveedor de TELEFONÍA (Twilio Voice, Telnyx, SIP…): sólo TRANSPORTA la
 * llamada. Traduce sus webhooks a un formato común y nuestras órdenes a su
 * formato. Nada de reglas: quién atiende lo decide el Call Center.
 *
 *   llamada → TelephonyProvider → Call Center (registro + enrutado) → humano | IA | híbrido
 *
 * Fase B: interfaz + simulado. No hay endpoint público: se expondrá
 * `/api/self-storage/webhooks/telephony/:proveedor` cuando se conecte uno real,
 * siempre con `verificarFirma` antes de leer nada.
 */

export type LlamadaEntrante = {
  /** Id de la llamada en el proveedor (idempotencia: un reintento no duplica). */
  externalCallId: string;
  /** Número de quien llama, tal cual llega (puede ser oculto). */
  from: string | null;
  /** Número marcado (identifica a la empresa / centro). */
  to: string;
  direction: "incoming" | "outgoing";
};

/** Órdenes que el Call Center da a la telefonía. Cada proveedor las traduce (TwiML, TeXML…). */
export type OrdenTelefonia =
  | { tipo: "decir"; texto: string; idioma: string }
  | { tipo: "transferir"; destino: string }
  | { tipo: "colgar" };

export interface TelephonyProvider {
  readonly nombre: string;
  /** Comprueba la firma del webhook. Sin firma válida, no se procesa nada. */
  verificarFirma(cabeceras: Record<string, string | undefined>, cuerpoCrudo: string, url: string): boolean;
  parsearEntrante(cuerpo: Record<string, unknown>): LlamadaEntrante | null;
  /** Respuesta para el proveedor (cuerpo + content-type). */
  responder(ordenes: OrdenTelefonia[]): { contentType: string; cuerpo: string };
}
