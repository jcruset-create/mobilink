/**
 * QuoteAcceptanceService — pasos 11-14 del flujo del checklist (§7).
 *
 *   11. Cliente acepta el presupuesto.
 *   12. ERP Hub convierte el presupuesto en pedido de venta.
 *   13. Supplier Hub crea el pedido de compra si la pieza venía de un recambista.
 *   14. Se actualiza el run del checklist (la OT/agenda de Mobilink leerá de aquí).
 *
 * Todo con el MISMO correlationId de la cadena original. La operación es
 * IDEMPOTENTE Y REANUDABLE: si el pedido de venta ya existía (reintento tras un
 * fallo parcial), se reutiliza y se continúa con lo que falte; si todo estaba
 * hecho, se rechaza con ALREADY_ACCEPTED.
 */

import type { OperationContext } from "../../domain/identifiers.ts";
import { IntegrationError } from "../../domain/errors.ts";
import { resolveErpConnector, supplierConnectorKeyForSupplierId } from "../../connectors/ConnectorRegistry.ts";
import { runOperation } from "./IntegrationOperationsService.ts";
import { createPurchaseOrder as createSupplierPurchaseOrder } from "./SupplierService.ts";
import {
  findDocumentLink,
  findDocumentLinkByCorrelation,
  findCompletedOperation,
  findChecklistRun,
  markChecklistRunAccepted,
  linkDocument,
  nextDocumentNumber,
} from "../../infrastructure/repositories.ts";

export interface AcceptQuoteInput {
  tenantId: string;
  /** Id del presupuesto de Mobilink (MQ-000258). */
  mobilinkQuoteId: string;
}

export interface AcceptQuoteResult {
  status: "COMPLETED";
  correlationId: string;
  workOrderId?: string;
  mobilinkQuoteId: string;
  salesOrder: { mobilinkOrderId: string; externalOrderNumber: string; reused: boolean };
  purchaseOrder?: { supplierId: string; supplierOrderId: string; totalCost: number } | null;
  simulated: boolean;
}

export async function acceptQuote(input: AcceptQuoteInput): Promise<AcceptQuoteResult> {
  if (!input.tenantId) throw IntegrationError.validation("MISSING_TENANT", "tenantId es obligatorio");
  if (!input.mobilinkQuoteId) throw IntegrationError.validation("MISSING_QUOTE", "mobilinkQuoteId es obligatorio");

  // Contexto: enlace del presupuesto → correlationId + OT + nº externo.
  const quoteLink = await findDocumentLink(input.tenantId, "sales_quote", input.mobilinkQuoteId);
  if (!quoteLink) {
    throw IntegrationError.notFound("QUOTE_NOT_FOUND", `No existe el presupuesto ${input.mobilinkQuoteId}`);
  }
  const correlationId: string = quoteLink.correlation_id;
  const workOrderId: string | undefined = quoteLink.work_order_id ?? undefined;

  // Operación original del presupuesto → cliente y líneas.
  const quoteOp = await findCompletedOperation(input.tenantId, correlationId, "ERP_CREATE_SALES_QUOTE");
  if (!quoteOp) {
    throw IntegrationError.notFound("QUOTE_OP_NOT_FOUND", "No se encontró la operación original del presupuesto");
  }
  const quoteRequest: any = quoteOp.request_payload ?? {};
  const customerId: string | undefined = quoteRequest.customerId;
  const lines: any[] = quoteRequest.lines ?? [];
  if (!customerId || lines.length === 0) {
    throw IntegrationError.validation("QUOTE_PAYLOAD_INCOMPLETE", "El payload original no tiene cliente o líneas");
  }

  // Idempotencia: ¿ya hay pedido de venta y (si tocaba) pedido de compra?
  const existingOrderLink = await findDocumentLinkByCorrelation(input.tenantId, correlationId, "sales_order");
  const run = await findChecklistRun(input.tenantId, correlationId);
  const bestOffer: any = run?.best_offer ?? null;
  const existingPoLink = await findDocumentLinkByCorrelation(input.tenantId, correlationId, "purchase_order");
  if (existingOrderLink && (!bestOffer || existingPoLink)) {
    throw IntegrationError.validation("ALREADY_ACCEPTED", `El presupuesto ${input.mobilinkQuoteId} ya estaba aceptado`, {
      salesOrderNumber: existingOrderLink.external_doc_number,
    });
  }

  const resolved = await resolveErpConnector(input.tenantId);
  const ctx: OperationContext = {
    tenantId: input.tenantId,
    correlationId,
    customerId,
    workOrderId,
    quoteId: input.mobilinkQuoteId,
  };

  const { result } = await runOperation(
    ctx,
    {
      operationType: "ERP_CREATE_SALES_ORDER",
      connectorKey: resolved.key,
      sourceSystem: "mobilink",
      targetSystem: resolved.key,
      requestPayload: { mobilinkQuoteId: input.mobilinkQuoteId, workOrderId, customerId },
    },
    async (log) => {
      // 12) Pedido de venta (o reutilizar el ya creado en un intento anterior).
      let externalOrderNumber: string;
      let mobilinkOrderId: string;
      let reused = false;
      if (existingOrderLink) {
        externalOrderNumber = existingOrderLink.external_doc_number;
        mobilinkOrderId = existingOrderLink.mobilink_doc_id;
        reused = true;
        await log.info(`Pedido de venta ya existente (${externalOrderNumber}): se reutiliza y se continúa`);
      } else {
        const order = await resolved.connector.createSalesOrder(ctx, {
          externalCustomerId: customerId,
          externalQuoteId: quoteLink.external_doc_id ?? undefined,
          reference: workOrderId ?? input.mobilinkQuoteId,
          lines,
        });
        mobilinkOrderId = await nextDocumentNumber("sales_order", "MPV");
        await linkDocument({
          tenantId: input.tenantId,
          correlationId,
          workOrderId,
          mobilinkDocType: "sales_order",
          mobilinkDocId: mobilinkOrderId,
          targetSystem: resolved.key,
          externalDocType: "sales_order",
          externalDocNumber: order.externalOrderNumber,
          externalDocId: order.externalOrderId,
        });
        externalOrderNumber = order.externalOrderNumber;
        await log.info(`Pedido de venta creado: ${externalOrderNumber}`, "PROCESSING", { mobilinkOrderId });
      }

      // 13) Pedido de compra al recambista de la mejor oferta (si la hubo y falta).
      let purchaseOrder: AcceptQuoteResult["purchaseOrder"] = null;
      if (bestOffer && !existingPoLink) {
        const connectorKey = supplierConnectorKeyForSupplierId(bestOffer.supplierId);
        if (!connectorKey) {
          await log.warn(`Sin conector para el proveedor ${bestOffer.supplierId}: pedido de compra manual`);
        } else {
          const quantity = Number(lines[0]?.quantity ?? 1);
          const po = await createSupplierPurchaseOrder(
            input.tenantId,
            connectorKey,
            [{ supplierPartNumber: bestOffer.supplierPartNumber, quantity, unitCost: bestOffer.unitCost }],
            workOrderId ?? input.mobilinkQuoteId,
            { correlationId }
          );
          const mobilinkPoId = await nextDocumentNumber("purchase_order", "MPC");
          await linkDocument({
            tenantId: input.tenantId,
            correlationId,
            workOrderId,
            mobilinkDocType: "purchase_order",
            mobilinkDocId: mobilinkPoId,
            targetSystem: connectorKey,
            externalDocType: "purchase_order",
            externalDocNumber: po.order.supplierOrderId,
          });
          purchaseOrder = {
            supplierId: po.order.supplierId,
            supplierOrderId: po.order.supplierOrderId,
            totalCost: po.order.totalCost,
          };
          await log.info(`Pedido de compra creado: ${po.order.supplierOrderId}`, "PROCESSING", { mobilinkPoId });
        }
      } else if (bestOffer && existingPoLink) {
        purchaseOrder = {
          supplierId: bestOffer.supplierId,
          supplierOrderId: existingPoLink.external_doc_number,
          totalCost: 0,
        };
        await log.info(`Pedido de compra ya existente (${existingPoLink.external_doc_number}): se reutiliza`);
      } else {
        await log.info("Sin oferta de proveedor en el run (stock local): no se crea pedido de compra");
      }

      // 14) Actualizar el run del checklist. La OT/agenda de Mobilink lee de aquí;
      //     la integración con la agenda del monolito queda para su propio módulo.
      if (run) {
        await markChecklistRunAccepted({
          tenantId: input.tenantId,
          correlationId,
          salesOrderNumber: externalOrderNumber,
          purchaseOrderNumber: purchaseOrder?.supplierOrderId,
        });
        await log.info("Run del checklist marcado como aceptado", "PROCESSING");
      }

      const out: AcceptQuoteResult = {
        status: "COMPLETED",
        correlationId,
        workOrderId,
        mobilinkQuoteId: input.mobilinkQuoteId,
        salesOrder: { mobilinkOrderId, externalOrderNumber, reused },
        purchaseOrder,
        simulated: resolved.usingDefault,
      };
      return { result: out, responsePayload: out };
    }
  );

  return result;
}
