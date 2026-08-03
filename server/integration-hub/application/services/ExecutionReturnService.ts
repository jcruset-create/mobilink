/**
 * ExecutionReturnService — devolución del parte de trabajo a Business Central
 * (SPEC §3, It.3). Cierra el círculo: lo ejecutado en campo vuelve al pedido de BC
 * para que el ERP facture.
 *
 * Dos pasos separados a propósito:
 *  1. `registerExecution` — captura LOCAL de consumos y líneas añadidas. No toca BC.
 *     El técnico puede registrar sin cobertura (caso 11): nada se pierde.
 *  2. `confirmReturn` — acción explícita que empuja a BC lo pendiente. Es una
 *     operación del Hub (ERP_RETURN_EXECUTION), auditada, reintentable y reprocesable.
 *
 * Reglas de la devolución:
 *  - Caso 9: antes de escribir se relee el estado del pedido en BC. Si ya no admite
 *    cambios (facturado/cerrado/desaparecido) NO se fuerza nada: BLOCKED → MANUAL_REVIEW
 *    con las salidas manuales (pedido complementario o abono).
 *  - Caso 2: consumo distinto del previsto → PATCH de la cantidad con el etag real.
 *  - Casos 3-4: línea añadida en campo → POST sin precio; BC aplica tarifa e IVA (§6).
 *  - Caso 12: rechazo parcial. Cada línea guarda su resultado; las aceptadas quedan
 *    'returned', las rechazadas 'rejected' con el mensaje de BC. Si hay rechazos, la
 *    operación acaba en MANUAL_REVIEW y reprocesar reintenta SOLO lo no devuelto
 *    (idempotencia: una línea 'returned' no se reenvía jamás).
 *  - Sólo se aceptan artículos del catálogo controlado activo: lo demás es material
 *    pendiente de validar (§5.4) y no viaja a BC.
 */

import { IntegrationError } from "../../domain/errors.ts";
import type { OperationContext } from "../../domain/identifiers.ts";
import { resolveErpConnector } from "../../connectors/ConnectorRegistry.ts";
import { runOperation } from "./IntegrationOperationsService.ts";
import {
  nextCorrelationId,
  getWpOrderWithLines,
  setLineConsumption,
  addWpLine,
  getCatalogItemByNumber,
  setLineReturnResult,
  updateWpOrderPlanning,
} from "../../infrastructure/repositories.ts";

/** Estados de BC que aún admiten cambios de líneas. */
const BC_EDITABLE_STATUSES = new Set(["draft", "open", "in review"]);

export interface RegisterExecutionInput {
  tenantId: string;
  wpOrderId: number;
  /** Consumos sobre líneas existentes (id local de wp_order_lines). */
  lines?: Array<{ lineId: number; qtyConsumida: number }>;
  /** Líneas nuevas de campo, por nº de artículo del catálogo controlado. */
  extraLines?: Array<{ bcItemNumber: string; qty: number; descripcion?: string }>;
  usuario?: string;
}

export async function registerExecution(input: RegisterExecutionInput) {
  const data = await getWpOrderWithLines(input.tenantId, input.wpOrderId);
  if (!data) throw IntegrationError.notFound("WP_ORDER_NOT_FOUND", `La OT ${input.wpOrderId} no existe`);
  if (data.order.wp_status === "cancelada_por_erp") {
    throw IntegrationError.validation("WP_ORDER_CANCELLED", "La OT está cancelada por el ERP");
  }

  const localIds = new Set(data.lines.map((l: any) => l.id));
  for (const c of input.lines ?? []) {
    if (!localIds.has(c.lineId)) {
      throw IntegrationError.validation("WP_LINE_UNKNOWN", `La línea ${c.lineId} no pertenece a la OT`);
    }
    if (!(c.qtyConsumida >= 0)) {
      throw IntegrationError.validation("WP_BAD_QTY", `Cantidad consumida inválida en línea ${c.lineId}`);
    }
    await setLineConsumption({ tenantId: input.tenantId, lineId: c.lineId, qtyConsumida: c.qtyConsumida });
  }

  const anadidas = [];
  for (const extra of input.extraLines ?? []) {
    const item = await getCatalogItemByNumber(input.tenantId, extra.bcItemNumber);
    if (!item || !item.activo) {
      // Material fuera del catálogo controlado: NO viaja a BC (§5.4). El llamante
      // debe registrarlo como material pendiente de validar.
      throw IntegrationError.validation(
        "WP_ITEM_NOT_IN_CATALOG",
        `El artículo '${extra.bcItemNumber}' no está en el catálogo controlado activo. ` +
          `Regístralo como material pendiente de validar o pide su alta en Business Central.`
      );
    }
    if (!(extra.qty > 0)) {
      throw IntegrationError.validation("WP_BAD_QTY", `Cantidad inválida para ${extra.bcItemNumber}`);
    }
    anadidas.push(
      await addWpLine({
        tenantId: input.tenantId,
        wpOrderId: input.wpOrderId,
        bcItemNumber: extra.bcItemNumber,
        tipo: item.tipo === "Service" ? "Item" : item.tipo ?? "Item",
        descripcion: extra.descripcion ?? item.descripcion,
        qty: extra.qty,
        um: item.um_base,
      })
    );
  }

  // Registrar ejecución implica que el trabajo está en curso.
  if (data.order.wp_status === "nueva" || data.order.wp_status === "planificada") {
    await updateWpOrderPlanning({ tenantId: input.tenantId, id: input.wpOrderId, wpStatus: "en_curso" });
  }

  return { ok: true, lineasActualizadas: (input.lines ?? []).length, lineasAnadidas: anadidas.length };
}

export interface ConfirmReturnResult {
  status: "COMPLETED";
  correlationId: string;
  simulated: boolean;
  enviadas: number;
  actualizadas: number;
  omitidas: number;
}

export async function confirmReturn(params: {
  tenantId: string;
  wpOrderId: number;
  correlationId?: string;
}): Promise<ConfirmReturnResult> {
  const data = await getWpOrderWithLines(params.tenantId, params.wpOrderId);
  if (!data) throw IntegrationError.notFound("WP_ORDER_NOT_FOUND", `La OT ${params.wpOrderId} no existe`);
  const { order, lines } = data;

  const resolved = await resolveErpConnector(params.tenantId);
  const connector = resolved.connector as any;
  if (
    typeof connector.getSalesOrderStatus !== "function" ||
    typeof connector.createSalesOrderLine !== "function" ||
    typeof connector.updateSalesOrderLineQuantity !== "function"
  ) {
    throw IntegrationError.validation(
      "RETURN_UNSUPPORTED",
      `El conector ERP '${resolved.key}' no soporta devolución de ejecución`
    );
  }

  const correlationId = params.correlationId ?? (await nextCorrelationId());
  const ctx: OperationContext = {
    tenantId: params.tenantId,
    correlationId,
    workOrderId: `WP-${params.wpOrderId}`,
  };

  const { result } = await runOperation(
    ctx,
    {
      operationType: "ERP_RETURN_EXECUTION",
      connectorKey: resolved.key,
      sourceSystem: "workplanner",
      targetSystem: resolved.key,
      requestPayload: { wpOrderId: params.wpOrderId, bcOrder: order.bc_number },
    },
    async (log) => {
      // Caso 9: ¿el pedido aún admite cambios?
      const bcStatus = await connector.getSalesOrderStatus(ctx, order.bc_order_id);
      if (bcStatus === null) {
        throw IntegrationError.blocked(
          "BC_ORDER_GONE",
          `El pedido ${order.bc_number} ya no existe en Business Central (¿facturado o cancelado?). ` +
            `Salidas: crear pedido complementario o abono/cargo manual.`
        );
      }
      if (!BC_EDITABLE_STATUSES.has(String(bcStatus).toLowerCase())) {
        throw IntegrationError.blocked(
          "BC_ORDER_NOT_EDITABLE",
          `El pedido ${order.bc_number} está en estado '${bcStatus}' y no admite cambios. ` +
            `Salidas: crear pedido complementario o abono/cargo manual.`
        );
      }

      let enviadas = 0;
      let actualizadas = 0;
      let omitidas = 0;
      const rechazos: string[] = [];

      for (const line of lines) {
        // Idempotencia (caso 12 + reproceso): lo ya devuelto no se reenvía jamás.
        if (line.estado_sync === "returned") {
          omitidas++;
          continue;
        }

        try {
          if (line.origen === "wp") {
            // Línea añadida en campo → alta en el pedido, sin precio (§6).
            const created = await connector.createSalesOrderLine(ctx, order.bc_order_id, {
              lineType: line.tipo || "Item",
              itemNumber: line.bc_item_number,
              quantity: Number(line.qty_consumida ?? line.qty_prevista ?? 0),
              description: line.descripcion || undefined,
            });
            await setLineReturnResult({
              tenantId: params.tenantId,
              lineId: line.id,
              estadoSync: "returned",
              bcLineId: created.bcLineId,
              bcLineNo: created.bcLineNo,
              aviso: null,
            });
            enviadas++;
          } else if (
            line.qty_consumida != null &&
            Number(line.qty_consumida) !== Number(line.qty_prevista ?? 0)
          ) {
            // Consumo distinto del previsto → cantidad actualizada en BC (caso 2).
            await connector.updateSalesOrderLineQuantity(
              ctx,
              order.bc_order_id,
              line.bc_line_id,
              Number(line.qty_consumida)
            );
            await setLineReturnResult({
              tenantId: params.tenantId,
              lineId: line.id,
              estadoSync: "returned",
              aviso: null,
            });
            actualizadas++;
          } else {
            // Consumo igual al previsto (caso 1): nada que cambiar en BC.
            omitidas++;
          }
        } catch (e: any) {
          // Transitorio (BC caído, caso 11): se corta aquí y la operación entera
          // reintenta luego — lo ya devuelto quedó marcado y no se duplicará.
          if (e instanceof IntegrationError && e.retryable) throw e;
          const msg = e?.message ?? String(e);
          await setLineReturnResult({
            tenantId: params.tenantId,
            lineId: line.id,
            estadoSync: "rejected",
            aviso: `BC rechazó la línea: ${msg}`,
          });
          rechazos.push(`línea ${line.id} (${line.bc_item_number ?? "?"}): ${msg}`);
          await log.warn(`Línea ${line.id} rechazada por BC: ${msg}`);
        }
      }

      if (rechazos.length > 0) {
        // Caso 12: parcial. Lo aceptado está en BC y marcado; lo rechazado, anotado.
        throw IntegrationError.blocked(
          "BC_PARTIAL_REJECTION",
          `Business Central rechazó ${rechazos.length} línea(s). Corrige y reprocesa: sólo se reenviará lo rechazado.`,
          { rechazos }
        );
      }

      const resumen: ConfirmReturnResult = {
        status: "COMPLETED",
        correlationId,
        simulated: resolved.usingDefault,
        enviadas,
        actualizadas,
        omitidas,
      };
      await log.info(
        `Devolución completada: ${enviadas} líneas nuevas, ${actualizadas} cantidades actualizadas, ${omitidas} sin cambios`
      );
      return { result: resumen, responsePayload: resumen };
    }
  );

  return result;
}
