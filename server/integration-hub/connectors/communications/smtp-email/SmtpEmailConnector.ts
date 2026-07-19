/**
 * SmtpEmailConnector — Communication Hub por email (SMTP/nodemailer).
 *
 * Envío REAL solo si el tenant lo habilita con `{"sendReal": true}` Y hay
 * credenciales SMTP (proveedor de secretos con fallback a SMTP_* del monolito).
 */

import nodemailer from "nodemailer";
import type { ConnectorInfo } from "../../../domain/connectors.ts";
import type { OperationContext } from "../../../domain/identifiers.ts";
import type { CommChannel, CommMessage } from "../../../domain/communication.ts";
import { IntegrationError } from "../../../domain/errors.ts";
import { getSecretsProvider } from "../../../infrastructure/secrets.ts";
import { SimulatedCommunicationConnector } from "../SimulatedCommunicationConnector.ts";

export interface SmtpEmailConfig {
  /** Remitente visible, p. ej. "Mobilink <taller@...>". Si falta, cae a SMTP_FROM/SMTP_USER. */
  from?: string;
  sendReal?: boolean;
}

export class SmtpEmailConnector extends SimulatedCommunicationConnector {
  readonly info: ConnectorInfo = {
    key: "smtp-email",
    kind: "communication",
    displayName: "Email (SMTP)",
    capabilities: ["sendQuote", "sendAppointment", "sendWorkOrderStatus", "requestApproval", "requestSignature", "sendInvoiceNotification"],
  };
  protected readonly channel: CommChannel = "email";

  constructor(private readonly config: SmtpEmailConfig = {}) {
    super();
  }

  private async smtpConfig(ctx: OperationContext) {
    const secrets = getSecretsProvider();
    const host = (await secrets.get(ctx.tenantId, this.info.key, "host")) || process.env.SMTP_HOST;
    const user = (await secrets.get(ctx.tenantId, this.info.key, "user")) || process.env.SMTP_USER;
    const pass = (await secrets.get(ctx.tenantId, this.info.key, "pass")) || process.env.SMTP_PASS;
    const port = Number((await secrets.get(ctx.tenantId, this.info.key, "port")) || process.env.SMTP_PORT || 587);
    return host && user && pass ? { host, user, pass, port } : null;
  }

  protected async useSimulation(ctx: OperationContext): Promise<boolean> {
    if (!this.config.sendReal) return true;
    return (await this.smtpConfig(ctx)) === null;
  }

  protected validateRecipient(msg: CommMessage): void {
    if (!msg.recipient.email) {
      throw IntegrationError.validation("COMM_NO_EMAIL", "Email requiere recipient.email");
    }
  }

  protected async realSend(ctx: OperationContext, msg: CommMessage, rendered: { subject: string; body: string }) {
    const smtp = await this.smtpConfig(ctx);
    if (!smtp) throw IntegrationError.auth("SMTP_NO_CREDENTIALS", "Credenciales SMTP no configuradas");
    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: { user: smtp.user, pass: smtp.pass },
    });
    const info = await transport.sendMail({
      from: this.config.from || process.env.SMTP_FROM || smtp.user,
      to: msg.recipient.email,
      subject: rendered.subject,
      text: rendered.body,
    });
    return { providerMessageId: String(info.messageId ?? "") };
  }
}
