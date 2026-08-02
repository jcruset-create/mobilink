/**
 * SalesOrderSyncService — pedidos de venta de BC → órdenes de trabajo de WorkPlanner
 * (SPEC §2, It.2).
 *
 * El pedido nace en Business Central (maestro). Aquí se refleja en `wp_orders` /
 * `wp_order_lines` para que WorkPlanner planifique y ejecute. La planificación local
 * (técnicos, fechas, vehículos) nunca viaja a BC ni se pisa desde la sincronización.
 *
 * Reglas de re-sincronización (§2.2):
 *  - línea no empezada → se actualiza con lo que diga BC;
 *  - línea EN EJECUCIÓN → no se pisa: se anota divergencia y lo resuelve una persona;
 *  - pedido desaparecido de BC estando la OT viva → 'cancelada_por_erp' (en BC, un
 *    pedido de venta cancelado se borra; la ausencia ES la señal). Se conserva todo
 *    lo ejecutado.
 *
 * Con la API estándar (hasta la extensión AL, It.4) bajan todos los pedidos no
 * facturados: WorkPlanner decide cuáles planificar.
 */

import { IntegrationError } from "../../domain/errors.ts";
import type { OperationContext } from "../../domain/identifiers.ts";
import { resolveErpConnector } from "../../connectors/ConnectorRegistry.ts";
import type { BcSalesOrder } from "../../connectors/erp/business-central/BusinessCentralConnector.ts";
import { runOperation } from "./IntegrationOperationsService.ts";
import {
  nextCorrelationId,
  upsertWpOrder,
  upsertWpOrderLine,
  markWpOrderCancelledByErp,
  listWpOrders,
  getSyncState,
  upsertSyncState,
} from "../../infrastructure/repositories.ts";

const ENTITY = "sales_orders";
const OVERLAP_MS = 5 * 60 * 1000;

export interface SalesOrderSyncResult {
  mode: "full" | "incremental";
  correlationId: string;
  simulated: boolean;
  pedidos: number;
  lineas: number;
  divergencias: number;
  canceladas: number;
}

export async function runSalesOrderSync(params: {
  tenantId: string;
  full?: boolean;
  correlationId?: string;
}): Promise<SalesOrderSyncResult> {
  if (!params.tenantId) throw IntegrationError.validation("MISSING_TENANT", "tenantId es obligatorio");

  const resolved = await resolveErpConnector(params.tenantId);
  const connector = resolved.connector as unknown as {
    getSalesOrdersForSync?: (ctx: OperationContext, opts?: { modifiedSince?: Date }) => Promise<BcSalesOrder[]>;
  };
  if (typeof connector.getSalesOrdersForSync !== "function") {
    throw IntegrationError.validation(
      "ORDERS_SYNC_UNSUPPORTED",
      `El conector ERP '${resolved.key}' no soporta sincronización de pedidos`
    );
  }

  const state = await getSyncState(params.tenantId, ENTITY);
  const mode: "full" | "incremental" = params.full || !state?.last_sync_ms ? "full" : "incremental";
  const modifiedSince =
    mode === "incremental" ? new Date(Number(state.last_sync_ms) - OVERLAP_MS) : undefined;

  const correlationId = params.correlationId ?? (await nextCorrelationId());
  const ctx: OperationContext = { tenantId: params.tenantId, correlationId };
  const syncRunId = `${mode}-${correlationId}`;
  const inicioMs = Date.now();

  try {
    const { result } = await runOperation(
      ctx,
      {
        operationType: "ERP_SYNC_SALES_ORDERS",
        connectorKey: resolved.key,
        sourceSystem: resolved.key,
        targetSystem: "workplanner",
        requestPayload: { mode, modifiedSince: modifiedSince?.toISOString() ?? null },
      },
      async (log) => {
        const orders = await connector.getSalesOrdersForSync!(ctx, { modifiedSince });
        await log.info(`${orders.length} pedidos recibidos de ${resolved.key} (${mode})`);

        let lineas = 0;
        let divergencias = 0;
        for (const order of orders) {
          const cabecera = await upsertWpOrder({
            tenantId: params.tenantId,
            bcOrderId: order.id,
            bcNumber: order.number,
            customerNumber: order.customerNumber,
            customerName: order.customerName,
            shipToAddress: order.shipToAddressLine1,
            requestedDate: order.requestedDeliveryDate,
            bcStatus: order.status,
            bcLastModifiedMs: order.lastModifiedDateTime ? Date.parse(order.lastModifiedDateTime) : undefined,
            externalDocumentNumber: order.externalDocumentNumber,
            syncRunId,
          });

          for (const line of order.salesOrderLines ?? []) {
            // Las líneas de comentario no son trabajo: no se reflejan.
            if ((line.lineType ?? "").toLowerCase() === "comment") continue;
            const { divergencia } = await upsertWpOrderLine({
              wpOrderId: cabecera.id,
              tenantId: params.tenantId,
              bcLineId: line.id,
              bcLineNo: line.sequence,
              tipo: line.lineType,
              bcItemNumber: line.lineObjectNumber,
              descripcion: line.description,
              qtyPrevista: line.quantity,
              um: line.unitOfMeasureCode,
              precioBc: line.unitPrice,
              descuentoBc: line.discountPercent,
              importeBc: line.netAmount,
            });
            lineas++;
            if (divergencia) {
              divergencias++;
              await log.warn(
                `Pedido ${order.number}: la línea ${line.sequence} cambió en BC con trabajo en ejecución`
              );
            }
          }
        }

        // Cancelaciones: sólo detectables en una pasada full (la ausencia es la señal).
        let canceladas = 0;
        if (mode === "full") {
          const vivas = await listWpOrders({ tenantId: params.tenantId, limit: 500 });
          const idsEnBc = new Set(orders.map((o) => o.id));
          for (const row of vivas) {
            const activa = row.wp_status !== "cancelada_por_erp" && row.wp_status !== "finalizada";
            if (activa && !idsEnBc.has(row.bc_order_id)) {
              await markWpOrderCancelledByErp(params.tenantId, row.bc_order_id);
              canceladas++;
              await log.warn(`Pedido ${row.bc_number} ya no existe en BC → OT cancelada_por_erp`);
            }
          }
        }

        const resumen: SalesOrderSyncResult = {
          mode,
          correlationId,
          simulated: resolved.usingDefault,
          pedidos: orders.length,
          lineas,
          divergencias,
          canceladas,
        };
        return { result: resumen, responsePayload: resumen };
      }
    );

    await upsertSyncState({
      tenantId: params.tenantId,
      entity: ENTITY,
      lastSyncMs: inicioMs,
      lastFullSyncMs: mode === "full" ? inicioMs : undefined,
      status: "ok",
      detail: `${result.pedidos} pedidos, ${result.lineas} líneas`,
    });
    return result;
  } catch (e: any) {
    await upsertSyncState({
      tenantId: params.tenantId,
      entity: ENTITY,
      status: "error",
      detail: e?.message ?? String(e),
    });
    throw e;
  }
}
