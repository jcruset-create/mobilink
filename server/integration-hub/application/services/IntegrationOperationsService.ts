/**
 * IntegrationOperationsService.
 *
 * Envuelve la ejecución de CUALQUIER acción del Hub en una operación trazable:
 *  - crea el registro (RECEIVED),
 *  - escribe el audit log en cada transición,
 *  - aplica la máquina de estados (§2.9),
 *  - decide reintento vs. revisión manual según el tipo de error.
 *
 * El Hub nunca pierde una operación: si algo falla, queda persistido con su estado y motivo.
 */

import { canTransition, isTerminal } from "../../domain/operation.ts";
import type { OperationStatus, OperationType } from "../../domain/operation.ts";
import { IntegrationError } from "../../domain/errors.ts";
import type { OperationContext } from "../../domain/identifiers.ts";
import {
  createOperation,
  updateOperationStatus,
  appendLog,
  getOperation,
  type OperationRow,
} from "../../infrastructure/repositories.ts";

const MAX_RETRIES = 3;

export interface RunOptions {
  operationType: OperationType;
  connectorKey?: string;
  sourceSystem: string;
  targetSystem: string;
  requestPayload?: unknown;
}

export interface RunResult<T> {
  operation: OperationRow;
  result: T;
}

/**
 * Ejecuta `work` dentro de una operación trazable.
 * `work` recibe el contexto y un logger, y devuelve el resultado normalizado.
 */
export async function runOperation<T>(
  ctx: OperationContext,
  options: RunOptions,
  work: (log: OperationLogger) => Promise<{ result: T; responsePayload: unknown }>
): Promise<RunResult<T>> {
  const op = await createOperation({
    tenantId: ctx.tenantId,
    connectorKey: options.connectorKey,
    operationType: options.operationType,
    sourceSystem: options.sourceSystem,
    targetSystem: options.targetSystem,
    correlationId: ctx.correlationId,
    workOrderId: ctx.workOrderId,
    requestPayload: options.requestPayload,
  });

  const logger = new OperationLogger(op.id, ctx);
  await logger.info("Operación recibida", "RECEIVED", { operationType: options.operationType });

  await transition(op.id, ctx, "PROCESSING", logger);

  let attempt = 0;
  // Reintentos ante errores transitorios (sistema externo caído, timeouts...).
  while (true) {
    attempt++;
    try {
      const { result, responsePayload } = await work(logger);
      const completed = await updateOperationStatus(op.id, "COMPLETED", {
        responsePayload,
        completed: true,
      });
      await logger.info("Operación completada", "COMPLETED");
      return { operation: completed, result };
    } catch (err) {
      const ie = normalizeError(err);
      await logger.error(`Error: ${ie.message}`, undefined, { code: ie.code, kind: ie.kind });

      if (ie.retryable && attempt <= MAX_RETRIES) {
        await updateOperationStatus(op.id, "RETRY_PENDING", {
          errorCode: ie.code,
          errorMessage: ie.message,
          incrementRetry: true,
        });
        await logger.warn(`Reintento ${attempt}/${MAX_RETRIES}`, "RETRY_PENDING");
        await transition(op.id, ctx, "PROCESSING", logger);
        continue;
      }

      // Sin más reintentos o error no recuperable → estado final.
      const finalStatus: OperationStatus = ie.retryable ? "MANUAL_REVIEW" : "FAILED";
      const failed = await updateOperationStatus(op.id, finalStatus, {
        errorCode: ie.code,
        errorMessage: ie.message,
        completed: true,
      });
      await logger.error(
        ie.retryable ? "Agotados los reintentos → revisión manual" : "Operación fallida",
        finalStatus
      );
      throw new OperationFailedError(failed, ie);
    }
  }
}

async function transition(
  operationId: number,
  ctx: OperationContext,
  to: OperationStatus,
  logger: OperationLogger
): Promise<void> {
  const current = await getOperation(operationId);
  if (!current) return;
  if (current.status === to) return;
  if (isTerminal(current.status)) return;
  if (!canTransition(current.status, to)) {
    // No abortamos por una transición no canónica, pero lo dejamos registrado.
    await logger.warn(`Transición no canónica ${current.status} → ${to}`);
  }
  await updateOperationStatus(operationId, to, {});
}

function normalizeError(err: unknown): IntegrationError {
  if (err instanceof IntegrationError) return err;
  if (err instanceof Error) {
    return IntegrationError.permanent("UNEXPECTED", err.message, { stack: err.stack });
  }
  return IntegrationError.permanent("UNEXPECTED", "Error desconocido", err);
}

/** Error lanzado cuando una operación termina en FAILED/MANUAL_REVIEW. */
export class OperationFailedError extends Error {
  constructor(public readonly operation: OperationRow, public readonly cause: IntegrationError) {
    super(cause.message);
    this.name = "OperationFailedError";
  }
}

/** Logger ligado a una operación; escribe en integration_operation_logs. */
export class OperationLogger {
  constructor(private readonly operationId: number, private readonly ctx: OperationContext) {}

  private write(level: "info" | "warn" | "error", message: string, status?: OperationStatus, data?: unknown) {
    return appendLog({
      operationId: this.operationId,
      tenantId: this.ctx.tenantId,
      correlationId: this.ctx.correlationId,
      level,
      status,
      message,
      data,
    });
  }
  info(message: string, status?: OperationStatus, data?: unknown) {
    return this.write("info", message, status, data);
  }
  warn(message: string, status?: OperationStatus, data?: unknown) {
    return this.write("warn", message, status, data);
  }
  error(message: string, status?: OperationStatus, data?: unknown) {
    return this.write("error", message, status, data);
  }
}
