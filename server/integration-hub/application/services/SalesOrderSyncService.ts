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

/*
 * Una pasada incremental SIN pedidos no escribe nada en la base.
 *
 * Cada 5 minutos creaba una operación, tres líneas de log, un número de
 * correlación y el estado de la sincronización, para decir «0 pedidos»: unas
 * 2.300 escrituras al día por empresa, y las tablas de operaciones y logs
 * creciendo sin parar con entradas vacías. Ahora se pregunta primero a BC y,
 * si no hay nada, solo se apunta EN MEMORIA cuándo se miró, para que la
 * pantalla pueda decir que el proceso está vivo.
 *
 * `last_sync_ms` no avanza en esas pasadas, y no hace falta: la siguiente
 * pregunta «modificados desde la última vez que hubo algo», que sigue siendo
 * la pregunta correcta.
 */
const ultimaComprobacion = new Map<string, number>();

/** Cuándo se miró BC por última vez sin encontrar pedidos nuevos. `null` desde el arranque. */
export function ultimaComprobacionDePedidos(tenantId: string): number | null {
  return ultimaComprobacion.get(tenantId) ?? null;
}

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

  /*
   * Incremental: primero se pregunta, sin abrir operación. Si BC falla aquí,
   * se sigue por el camino de siempre, que vuelve a preguntar dentro de la
   * operación y deja el error registrado y reintentable.
   */
  let precargados: BcSalesOrder[] | undefined;
  if (mode === "incremental") {
    try {
      precargados = await connector.getSalesOrdersForSync(
        { tenantId: params.tenantId, correlationId: params.correlationId ?? "comprobacion" } as OperationContext,
        { modifiedSince }
      );
    } catch {
      precargados = undefined;
    }
    if (precargados && precargados.length === 0) {
      ultimaComprobacion.set(params.tenantId, Date.now());
      return {
        mode,
        correlationId: "",
        simulated: resolved.usingDefault,
        pedidos: 0,
        lineas: 0,
        divergencias: 0,
        canceladas: 0,
      };
    }
  }

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
        const orders = precargados ?? (await connector.getSalesOrdersForSync!(ctx, { modifiedSince }));
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
