/**
 * Integration Worker (§4 — operaciones asíncronas / Queue Manager §2.5).
 *
 * Cierra el ciclo de reproceso: las operaciones marcadas RETRY_PENDING (desde el
 * panel o el endpoint /admin/operations/:id/reprocess) se reejecutan en segundo
 * plano a partir de su `request_payload` persistido.
 *
 * Modelo de cola: PostgreSQL como cola de trabajo (sin infra nueva), con claim
 * atómico (UPDATE ... WHERE status='RETRY_PENDING' RETURNING) para que ninguna
 * operación se procese dos veces aunque hubiera varias instancias.
 *
 * Semántica de reintento (auditable):
 *  - El reintento REUTILIZA el servicio original con el MISMO correlationId, por lo
 *    que genera una NUEVA operación (= nuevo intento, trazable de principio a fin).
 *  - La operación original se cierra:
 *      · reintento OK      → CANCELLED  (sustituida; log enlaza a la nueva operación)
 *      · reintento falla   → MANUAL_REVIEW (log con el motivo y la operación del intento)
 *      · sin handler       → MANUAL_REVIEW (tipo no reprocesable automáticamente)
 *
 * Nota de idempotencia: reprocesar tipos de ESCRITURA (presupuestos, pedidos) puede
 * crear un documento nuevo en el sistema externo si el intento original llegó a
 * crearlo parcialmente. El audit log deja constancia de cada intento para detectarlo.
 */

import pool from "../../db.ts";
import { appendLog, updateOperationStatus, type OperationRow } from "../infrastructure/repositories.ts";
import { createQuoteFromWorkOrder } from "../application/services/SalesQuoteService.ts";
import { identifyVehicle, getCompatibleParts, getOeReferences } from "../application/services/TechnicalService.ts";
import { searchOffers, createPurchaseOrder as createSupplierPurchaseOrder } from "../application/services/SupplierService.ts";
import { processNonConformity } from "../application/services/ChecklistAutomationService.ts";
import { sendCommunication } from "../application/services/CommunicationService.ts";

const DEFAULT_INTERVAL_MS = 30_000;
const BATCH_SIZE = 5;

/**
 * Handlers de reproceso por tipo de operación. Cada uno reejecuta el servicio real
 * con el payload persistido y el correlationId original.
 */
type RetryHandler = (op: OperationRow, payload: any) => Promise<unknown>;

const HANDLERS: Record<string, RetryHandler> = {
  ERP_CREATE_SALES_QUOTE: (op, p) =>
    createQuoteFromWorkOrder({ ...p, tenantId: op.tenant_id, correlationId: op.correlation_id }),

  TECH_IDENTIFY_VEHICLE: (op, p) =>
    identifyVehicle(op.tenant_id, p ?? {}, { correlationId: op.correlation_id }),

  TECH_GET_COMPATIBLE_PARTS: (op, p) =>
    getCompatibleParts(op.tenant_id, p?.vehicleRef, p?.category, { correlationId: op.correlation_id }),

  TECH_GET_OE_REFERENCES: (op, p) =>
    getOeReferences(op.tenant_id, p?.partRef, { correlationId: op.correlation_id }),

  SUPPLIER_SEARCH_PART: (op, p) =>
    searchOffers(op.tenant_id, p ?? {}, { correlationId: op.correlation_id }),

  SUPPLIER_CREATE_PURCHASE_ORDER: (op, p) =>
    createSupplierPurchaseOrder(op.tenant_id, op.connector_key ?? "", p?.lines ?? [], p?.reference, {
      correlationId: op.correlation_id,
    }),

  CHECKLIST_PROCESS_NON_CONFORMITY: (op, p) => processNonConformity({ ...p, tenantId: op.tenant_id }),
};

// Handlers de comunicaciones: todos reejecutan sendCommunication desde el payload.
const commRetry: RetryHandler = (op, p) =>
  sendCommunication({
    tenantId: op.tenant_id,
    kind: p?.kind,
    channel: p?.channel,
    recipient: p?.recipient,
    data: p?.data,
    workOrderId: p?.workOrderId ?? undefined,
    correlationId: op.correlation_id,
  });
for (const t of [
  "COMM_SEND_QUOTE",
  "COMM_SEND_APPOINTMENT",
  "COMM_SEND_WORK_ORDER_STATUS",
  "COMM_REQUEST_APPROVAL",
  "COMM_REQUEST_SIGNATURE",
  "COMM_SEND_INVOICE",
]) {
  HANDLERS[t] = commRetry;
}

/** Claim atómico de un lote de operaciones RETRY_PENDING (nadie más las verá). */
async function claimBatch(limit: number): Promise<OperationRow[]> {
  const { rows } = await pool.query(
    `UPDATE integration_operations SET status = 'PROCESSING', updated_at_ms = $2
      WHERE id IN (
        SELECT id FROM integration_operations
         WHERE status = 'RETRY_PENDING'
         ORDER BY updated_at_ms ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING *`,
    [limit, Date.now()]
  );
  return rows;
}

export interface WorkerCycleResult {
  claimed: number;
  succeeded: number;
  failed: number;
  noHandler: number;
}

/** Ejecuta UN ciclo del worker: reclama un lote y reprocesa cada operación. */
export async function runWorkerCycle(): Promise<WorkerCycleResult> {
  const batch = await claimBatch(BATCH_SIZE);
  const result: WorkerCycleResult = { claimed: batch.length, succeeded: 0, failed: 0, noHandler: 0 };

  for (const op of batch) {
    const logCtx = { operationId: op.id, tenantId: op.tenant_id, correlationId: op.correlation_id };
    const handler = HANDLERS[op.operation_type];

    if (!handler) {
      result.noHandler++;
      await updateOperationStatus(op.id, "MANUAL_REVIEW", {
        errorCode: "NO_RETRY_HANDLER",
        errorMessage: `El tipo ${op.operation_type} no admite reproceso automático`,
        completed: true,
      });
      await appendLog({
        ...logCtx,
        level: "warn",
        status: "MANUAL_REVIEW",
        message: `Worker: sin handler de reproceso para ${op.operation_type}`,
      });
      continue;
    }

    await appendLog({ ...logCtx, message: `Worker: reintentando ${op.operation_type} (intento ${op.retry_count + 1})` });
    try {
      const out: any = await handler(op, op.request_payload);
      // El servicio creó una nueva operación COMPLETED con el mismo correlationId.
      result.succeeded++;
      await updateOperationStatus(op.id, "CANCELLED", {
        errorCode: null,
        errorMessage: null,
        completed: true,
        incrementRetry: true,
      });
      await appendLog({
        ...logCtx,
        status: "CANCELLED",
        message: "Worker: reproceso completado; esta operación queda sustituida por la nueva ejecución (mismo correlationId)",
        data: out && typeof out === "object" ? { resumen: summarize(out) } : undefined,
      });
    } catch (e: any) {
      result.failed++;
      await updateOperationStatus(op.id, "MANUAL_REVIEW", {
        errorCode: e?.code ?? "RETRY_FAILED",
        errorMessage: e?.message ?? "Reintento fallido",
        completed: true,
        incrementRetry: true,
      });
      await appendLog({
        ...logCtx,
        level: "error",
        status: "MANUAL_REVIEW",
        message: `Worker: reintento fallido — ${e?.message ?? e}`,
      });
    }
  }
  return result;
}

/** Resumen compacto del resultado del reintento para el audit log. */
function summarize(out: any): unknown {
  const keys = ["correlationId", "mobilinkQuoteId", "businessCentralQuoteNumber", "status", "incidentId"];
  const s: Record<string, unknown> = {};
  for (const k of keys) if (out[k] !== undefined) s[k] = out[k];
  return Object.keys(s).length ? s : undefined;
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/** Arranca el bucle del worker (patrón de los checkers del monolito). */
export function startIntegrationWorker(): void {
  if (timer) return;
  const interval = Number(process.env.IH_WORKER_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  timer = setInterval(async () => {
    if (running) return; // no solapar ciclos
    running = true;
    try {
      const r = await runWorkerCycle();
      if (r.claimed > 0) {
        console.log(
          `[integration-worker] ciclo: ${r.claimed} reclamadas, ${r.succeeded} ok, ${r.failed} fallidas, ${r.noHandler} sin handler`
        );
      }
    } catch (e) {
      console.error("[integration-worker] error en ciclo:", e);
    } finally {
      running = false;
    }
  }, interval);
  console.log(`Mobilink Integration Hub: worker de reproceso activo (cada ${Math.round(interval / 1000)}s)`);
}

export function stopIntegrationWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
