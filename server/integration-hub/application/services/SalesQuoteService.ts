/**
 * SalesQuoteService — caso de la PRIMERA ENTREGA FUNCIONAL (§4).
 *
 * Desde una OT de Mobilink se crea un presupuesto de venta en el ERP (Business Central),
 * se recupera el número de presupuesto y se guarda la relación entre ambos sistemas.
 *
 * Todo el flujo pasa por el Hub (principio §2.2): el llamante NO conoce Business Central.
 */

import type { OperationContext } from "../../domain/identifiers.ts";
import type { QuoteLineInput } from "../../domain/models.ts";
import { IntegrationError } from "../../domain/errors.ts";
import { resolveErpConnector } from "../../connectors/ConnectorRegistry.ts";
import { runOperation, OperationFailedError } from "./IntegrationOperationsService.ts";
import { nextCorrelationId, nextDocumentNumber, linkDocument } from "../../infrastructure/repositories.ts";

export interface CreateQuoteFromWorkOrderInput {
  tenantId: string;
  workOrderId: string;
  customerId: string; // id de cliente en el sistema externo (o mapeable)
  vehicleId?: string;
  reference?: string;
  currency?: string;
  lines: QuoteLineInput[];
  /** CorrelationId externo (orquestación Fase 4). Si no viene, se genera uno. */
  correlationId?: string;
}

export interface CreateQuoteFromWorkOrderResult {
  status: "COMPLETED";
  mobilinkQuoteId: string;
  businessCentralQuoteNumber: string;
  correlationId: string;
  simulated: boolean;
  totalAmount: number;
  currency: string;
}

export async function createQuoteFromWorkOrder(
  input: CreateQuoteFromWorkOrderInput
): Promise<CreateQuoteFromWorkOrderResult> {
  // Validación de entrada (VALIDATION → no reintentable).
  if (!input.tenantId) throw IntegrationError.validation("MISSING_TENANT", "tenantId es obligatorio");
  if (!input.customerId) throw IntegrationError.validation("MISSING_CUSTOMER", "customerId es obligatorio");
  if (!input.lines?.length) throw IntegrationError.validation("EMPTY_LINES", "Se requiere al menos una línea");
  for (const [i, l] of input.lines.entries()) {
    if (!l.externalProductId) throw IntegrationError.validation("LINE_NO_PRODUCT", `Línea ${i}: falta externalProductId`);
    if (!(l.quantity > 0)) throw IntegrationError.validation("LINE_BAD_QTY", `Línea ${i}: cantidad debe ser > 0`);
  }

  const correlationId = input.correlationId ?? (await nextCorrelationId());
  const resolved = await resolveErpConnector(input.tenantId);
  const ctx: OperationContext = {
    tenantId: input.tenantId,
    correlationId,
    customerId: input.customerId,
    vehicleId: input.vehicleId,
    workOrderId: input.workOrderId,
  };

  try {
    const { result } = await runOperation(
      ctx,
      {
        operationType: "ERP_CREATE_SALES_QUOTE",
        connectorKey: resolved.key,
        sourceSystem: "mobilink",
        targetSystem: resolved.key,
        requestPayload: input,
      },
      async (log) => {
        await log.info(
          resolved.usingDefault
            ? "ERP no configurado para el tenant: usando conector por defecto en simulación"
            : `Usando conector ERP '${resolved.key}'`
        );

        const quote = await resolved.connector.createSalesQuote(ctx, {
          externalCustomerId: input.customerId,
          currency: input.currency,
          reference: input.reference ?? input.workOrderId,
          lines: input.lines,
        });

        // Documento interno de Mobilink + enlace con el documento externo.
        const mobilinkQuoteId = await nextDocumentNumber("sales_quote", "MQ");
        await linkDocument({
          tenantId: input.tenantId,
          correlationId,
          workOrderId: input.workOrderId,
          mobilinkDocType: "sales_quote",
          mobilinkDocId: mobilinkQuoteId,
          targetSystem: resolved.key,
          externalDocType: "sales_quote",
          externalDocNumber: quote.externalQuoteNumber,
          externalDocId: quote.externalQuoteId,
        });

        await log.info("Presupuesto creado y enlazado", "PROCESSING", {
          mobilinkQuoteId,
          externalQuoteNumber: quote.externalQuoteNumber,
        });

        const responsePayload = {
          mobilinkQuoteId,
          businessCentralQuoteNumber: quote.externalQuoteNumber,
          correlationId,
          totalAmount: quote.totalAmount,
          currency: quote.currency,
          lines: quote.lines,
        };

        return {
          result: {
            status: "COMPLETED" as const,
            mobilinkQuoteId,
            businessCentralQuoteNumber: quote.externalQuoteNumber,
            correlationId,
            simulated: resolved.usingDefault,
            totalAmount: quote.totalAmount,
            currency: quote.currency,
          },
          responsePayload,
        };
      }
    );
    return result;
  } catch (e) {
    if (e instanceof OperationFailedError) {
      // Re-exponemos con el correlationId para trazar desde el llamante.
      throw new IntegrationError({
        kind: e.cause.kind,
        code: e.cause.code,
        message: e.cause.message,
        details: { correlationId, operationId: e.operation.id, status: e.operation.status },
      });
    }
    throw e;
  }
}
