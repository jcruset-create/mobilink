/**
 * Base de conector de comunicaciones (Fase Communication Hub).
 *
 * Renderiza las plantillas en castellano por tipo de mensaje y aplica el patrón de
 * simulación del Hub: si el conector no está habilitado/configurado para el tenant,
 * NO envía nada real — devuelve un resultado simulado determinista y lo deja claro
 * en la respuesta y el audit log.
 */

import type { ICommunicationConnector, ConnectorInfo } from "../../domain/connectors.ts";
import type { OperationContext } from "../../domain/identifiers.ts";
import type { CommChannel, CommKind, CommMessage, CommSendResult } from "../../domain/communication.ts";
import { IntegrationError } from "../../domain/errors.ts";

function fmtEur(amount?: number, currency?: string): string {
  if (amount == null) return "";
  const cur = currency === undefined || currency === "EUR" ? "€" : ` ${currency}`;
  return `${amount.toFixed(2).replace(".", ",")}${cur}`;
}

/** Plantillas por tipo de mensaje: asunto (email) + cuerpo (todos los canales). */
export function renderTemplate(msg: CommMessage): { subject: string; body: string } {
  const d = msg.data;
  const nombre = msg.recipient.name || "cliente";
  const link = d.link ? `\n${d.link}` : "";
  const notas = d.notes ? `\n${d.notes}` : "";

  switch (msg.kind) {
    case "quote":
      return {
        subject: `Presupuesto ${d.documentNumber ?? ""} — Mobilink`.trim(),
        body:
          `Hola ${nombre}, te enviamos el presupuesto ${d.documentNumber ?? ""}` +
          (d.amount != null ? ` por importe de ${fmtEur(d.amount, d.currency)}` : "") +
          `.${link}${notas}\nResponde a este mensaje para aceptarlo o si tienes dudas. — Mobilink`,
      };
    case "appointment":
      return {
        subject: `Cita confirmada — Mobilink`,
        body:
          `Hola ${nombre}, tu cita está confirmada` +
          (d.dateTime ? ` para el ${new Date(d.dateTime).toLocaleString("es-ES")}` : "") +
          `.${link}${notas} — Mobilink`,
      };
    case "work_order_status":
      return {
        subject: `Actualización de tu orden de trabajo ${d.workOrderId ?? ""} — Mobilink`.trim(),
        body:
          `Hola ${nombre}, tu orden de trabajo ${d.workOrderId ?? ""} ha cambiado a: ${d.status ?? "actualizada"}.` +
          `${link}${notas} — Mobilink`,
      };
    case "approval_request":
      return {
        subject: `Aprobación necesaria ${d.documentNumber ?? ""} — Mobilink`.trim(),
        body:
          `Hola ${nombre}, necesitamos tu aprobación para ${d.documentNumber ?? "una operación"}` +
          (d.amount != null ? ` (${fmtEur(d.amount, d.currency)})` : "") +
          `.${link}${notas} — Mobilink`,
      };
    case "signature_request":
      return {
        subject: `Firma pendiente ${d.documentNumber ?? ""} — Mobilink`.trim(),
        body: `Hola ${nombre}, tienes un documento pendiente de firma${d.documentNumber ? ` (${d.documentNumber})` : ""}.${link}${notas} — Mobilink`,
      };
    case "invoice":
      return {
        subject: `Factura ${d.documentNumber ?? ""} — Mobilink`.trim(),
        body:
          `Hola ${nombre}, ya está disponible tu factura ${d.documentNumber ?? ""}` +
          (d.amount != null ? ` por ${fmtEur(d.amount, d.currency)}` : "") +
          `.${link}${notas} — Mobilink`,
      };
  }
}

/** Id simulado estable derivado del correlationId + kind (reproducible). */
function simulatedId(channel: CommChannel, kind: CommKind, correlationId: string): string {
  const digits = correlationId.replace(/\D/g, "").slice(-6).padStart(6, "0");
  return `SIM-${channel.toUpperCase()}-${kind.toUpperCase()}-${digits}`;
}

export abstract class SimulatedCommunicationConnector implements ICommunicationConnector {
  abstract readonly info: ConnectorInfo;
  protected abstract readonly channel: CommChannel;

  /** true → no se envía nada real. Las subclases lo afinan (config + credenciales). */
  protected async useSimulation(_ctx: OperationContext): Promise<boolean> {
    return true;
  }

  /** Valida que el destinatario tiene el dato que el canal necesita. */
  protected abstract validateRecipient(msg: CommMessage): void;

  /** Envío real; las subclases lo implementan. */
  protected abstract realSend(
    ctx: OperationContext,
    msg: CommMessage,
    rendered: { subject: string; body: string }
  ): Promise<{ providerMessageId: string }>;

  async testConnection(ctx: OperationContext): Promise<{ ok: boolean; message: string }> {
    if (await this.useSimulation(ctx)) {
      return { ok: true, message: `Modo simulación (${this.info.displayName} no configurado)` };
    }
    return { ok: true, message: `${this.info.displayName} configurado` };
  }

  private async send(ctx: OperationContext, msg: CommMessage): Promise<CommSendResult> {
    this.validateRecipient(msg);
    const rendered = renderTemplate(msg);
    if (await this.useSimulation(ctx)) {
      return {
        channel: this.channel,
        providerMessageId: simulatedId(this.channel, msg.kind, ctx.correlationId),
        simulated: true,
        renderedBody: rendered.body,
        renderedSubject: rendered.subject,
      };
    }
    try {
      const { providerMessageId } = await this.realSend(ctx, msg, rendered);
      return {
        channel: this.channel,
        providerMessageId,
        simulated: false,
        renderedBody: rendered.body,
        renderedSubject: rendered.subject,
      };
    } catch (e: any) {
      // Errores del proveedor de mensajería → transitorios (reintentables por el worker).
      throw IntegrationError.transient("COMM_SEND_FAILED", `${this.info.displayName}: ${e?.message ?? e}`, e);
    }
  }

  sendQuote(ctx: OperationContext, msg: CommMessage) {
    return this.send(ctx, { ...msg, kind: "quote" });
  }
  sendAppointment(ctx: OperationContext, msg: CommMessage) {
    return this.send(ctx, { ...msg, kind: "appointment" });
  }
  sendWorkOrderStatus(ctx: OperationContext, msg: CommMessage) {
    return this.send(ctx, { ...msg, kind: "work_order_status" });
  }
  requestApproval(ctx: OperationContext, msg: CommMessage) {
    return this.send(ctx, { ...msg, kind: "approval_request" });
  }
  requestSignature(ctx: OperationContext, msg: CommMessage) {
    return this.send(ctx, { ...msg, kind: "signature_request" });
  }
  sendInvoiceNotification(ctx: OperationContext, msg: CommMessage) {
    return this.send(ctx, { ...msg, kind: "invoice" });
  }
}
