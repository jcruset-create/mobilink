/**
 * CommunicationService — casos de uso del Communication Hub.
 *
 * El llamante pide "envía este presupuesto/cita/estado al cliente" con un destinatario
 * y datos de negocio; el Hub elige el canal (explícito, o según los datos del
 * destinatario: teléfono → whatsapp, email → email), ejecuta el conector y lo deja
 * todo trazado como operación COMM_*.
 */

import type { OperationContext } from "../../domain/identifiers.ts";
import type { CommChannel, CommKind, CommRecipient, CommData, CommSendResult } from "../../domain/communication.ts";
import type { ICommunicationConnector } from "../../domain/connectors.ts";
import type { OperationType } from "../../domain/operation.ts";
import { IntegrationError } from "../../domain/errors.ts";
import { resolveCommunicationConnector } from "../../connectors/ConnectorRegistry.ts";
import { runOperation } from "./IntegrationOperationsService.ts";
import { nextCorrelationId } from "../../infrastructure/repositories.ts";

const KIND_TO_OPERATION: Record<CommKind, OperationType> = {
  quote: "COMM_SEND_QUOTE",
  appointment: "COMM_SEND_APPOINTMENT",
  work_order_status: "COMM_SEND_WORK_ORDER_STATUS",
  approval_request: "COMM_REQUEST_APPROVAL",
  signature_request: "COMM_REQUEST_SIGNATURE",
  invoice: "COMM_SEND_INVOICE",
};

const KIND_TO_METHOD: Record<CommKind, keyof ICommunicationConnector> = {
  quote: "sendQuote",
  appointment: "sendAppointment",
  work_order_status: "sendWorkOrderStatus",
  approval_request: "requestApproval",
  signature_request: "requestSignature",
  invoice: "sendInvoiceNotification",
};

export interface SendCommunicationInput {
  tenantId: string;
  kind: CommKind;
  recipient: CommRecipient;
  data?: CommData;
  /** Canal explícito; si falta se decide por los datos del destinatario. */
  channel?: CommChannel;
  workOrderId?: string;
  correlationId?: string;
}

export interface SendCommunicationResult extends CommSendResult {
  correlationId: string;
  connector: string;
  kind: CommKind;
}

export async function sendCommunication(input: SendCommunicationInput): Promise<SendCommunicationResult> {
  if (!input.tenantId) throw IntegrationError.validation("MISSING_TENANT", "tenantId es obligatorio");
  if (!input.kind || !KIND_TO_OPERATION[input.kind]) {
    throw IntegrationError.validation("BAD_KIND", `kind inválido: ${String(input.kind)}`);
  }
  if (!input.recipient?.phone && !input.recipient?.email) {
    throw IntegrationError.validation("MISSING_RECIPIENT", "Se requiere recipient.phone o recipient.email");
  }

  // Canal: explícito, o inferido del destinatario (teléfono → whatsapp; si no, email).
  const channel: CommChannel = input.channel ?? (input.recipient.phone ? "whatsapp" : "email");
  const resolved = await resolveCommunicationConnector(input.tenantId, channel);
  const correlationId = input.correlationId ?? (await nextCorrelationId());
  const ctx: OperationContext = { tenantId: input.tenantId, correlationId, workOrderId: input.workOrderId };

  const { result } = await runOperation(
    ctx,
    {
      operationType: KIND_TO_OPERATION[input.kind],
      connectorKey: resolved.key,
      sourceSystem: "mobilink",
      targetSystem: resolved.key,
      requestPayload: { kind: input.kind, channel, recipient: input.recipient, data: input.data, workOrderId: input.workOrderId },
    },
    async (log) => {
      if (resolved.usingDefault) {
        await log.info(`Conector '${resolved.key}' sin habilitar para el tenant: envío en simulación`);
      }
      const method = KIND_TO_METHOD[input.kind];
      const sent = await (resolved.connector[method] as ICommunicationConnector["sendQuote"])(ctx, {
        kind: input.kind,
        recipient: input.recipient,
        data: input.data ?? {},
      });
      await log.info(
        sent.simulated
          ? `Mensaje ${input.kind} SIMULADO por ${sent.channel} (${sent.providerMessageId})`
          : `Mensaje ${input.kind} enviado por ${sent.channel} (${sent.providerMessageId})`,
        "PROCESSING",
        { renderedBody: sent.renderedBody }
      );
      return { result: sent, responsePayload: sent };
    }
  );

  return { ...result, correlationId, connector: resolved.key, kind: input.kind };
}
