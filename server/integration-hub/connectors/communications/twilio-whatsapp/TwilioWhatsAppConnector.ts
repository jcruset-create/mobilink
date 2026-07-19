/**
 * TwilioWhatsAppConnector — Communication Hub por WhatsApp Business (Twilio).
 *
 * Envío REAL solo cuando el tenant tiene el conector habilitado con config
 * (`{"from": "whatsapp:+34..."}` opcional) Y hay credenciales. Credenciales:
 * primero el proveedor de secretos del Hub (IH_SECRET__TWILIO_WHATSAPP__*),
 * con fallback a las TWILIO_* que el monolito ya usa en producción.
 */

import twilio from "twilio";
import type { ConnectorInfo } from "../../../domain/connectors.ts";
import type { OperationContext } from "../../../domain/identifiers.ts";
import type { CommChannel, CommMessage } from "../../../domain/communication.ts";
import { IntegrationError } from "../../../domain/errors.ts";
import { getSecretsProvider } from "../../../infrastructure/secrets.ts";
import { SimulatedCommunicationConnector } from "../SimulatedCommunicationConnector.ts";

export interface TwilioWhatsAppConfig {
  /** Número emisor, p. ej. "whatsapp:+34610473079". Si falta, cae al env del monolito. */
  from?: string;
  /** Debe ponerse a true en la config del tenant para permitir envío real. */
  sendReal?: boolean;
}

export class TwilioWhatsAppConnector extends SimulatedCommunicationConnector {
  readonly info: ConnectorInfo = {
    key: "twilio-whatsapp",
    kind: "communication",
    displayName: "WhatsApp Business (Twilio)",
    capabilities: ["sendQuote", "sendAppointment", "sendWorkOrderStatus", "requestApproval", "requestSignature", "sendInvoiceNotification"],
  };
  protected readonly channel: CommChannel = "whatsapp";

  constructor(private readonly config: TwilioWhatsAppConfig = {}) {
    super();
  }

  private async credentials(ctx: OperationContext) {
    const secrets = getSecretsProvider();
    const sid = (await secrets.get(ctx.tenantId, this.info.key, "account_sid")) || process.env.TWILIO_ACCOUNT_SID;
    const token = (await secrets.get(ctx.tenantId, this.info.key, "auth_token")) || process.env.TWILIO_AUTH_TOKEN;
    return sid && token ? { sid, token } : null;
  }

  protected async useSimulation(ctx: OperationContext): Promise<boolean> {
    // Doble llave: el tenant debe pedir envío real explícitamente Y tener credenciales.
    if (!this.config.sendReal) return true;
    return (await this.credentials(ctx)) === null;
  }

  protected validateRecipient(msg: CommMessage): void {
    if (!msg.recipient.phone) {
      throw IntegrationError.validation("COMM_NO_PHONE", "WhatsApp requiere recipient.phone");
    }
  }

  protected async realSend(ctx: OperationContext, msg: CommMessage, rendered: { subject: string; body: string }) {
    const creds = await this.credentials(ctx);
    if (!creds) throw IntegrationError.auth("TWILIO_NO_CREDENTIALS", "Credenciales de Twilio no configuradas");
    const from = this.config.from || process.env.TWILIO_WHATSAPP_FROM || process.env.TWILIO_WHATSAPP_NUMBER;
    if (!from) throw IntegrationError.validation("TWILIO_NO_FROM", "Falta el número emisor de WhatsApp");
    const client = twilio(creds.sid, creds.token);
    const res = await client.messages.create({
      from,
      to: `whatsapp:${msg.recipient.phone}`,
      body: rendered.body,
    });
    return { providerMessageId: res.sid };
  }
}
