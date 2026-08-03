/**
 * Tests de la máquina de estados de las operaciones (§2.9).
 *
 * Es la promesa central del Hub: "nunca se pierde una operación". Aquí se
 * verifica el camino que hasta ahora sólo estaba escrito en la documentación:
 * PENDING → reintentos → MANUAL_REVIEW, y qué error acaba en cada estado final.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let operaciones: Record<number, any> = {};
let siguienteId = 1;
const logs: Array<{ level: string; message: string; status?: string }> = [];
/** Estados por los que ha pasado la operación, en orden. */
let transiciones: string[] = [];

const createOperation = vi.fn(async (params: any) => {
  const op = { id: siguienteId++, status: "RECEIVED", retry_count: 0, ...params };
  operaciones[op.id] = op;
  transiciones.push("RECEIVED");
  return op;
});

const updateOperationStatus = vi.fn(async (id: number, status: string, opts: any = {}) => {
  const op = operaciones[id];
  op.status = status;
  if (opts.incrementRetry) op.retry_count++;
  if (opts.errorCode) op.error_code = opts.errorCode;
  transiciones.push(status);
  return op;
});

vi.mock("../../infrastructure/repositories.ts", () => ({
  createOperation: (...a: any[]) => createOperation(...a),
  updateOperationStatus: (...a: any[]) => updateOperationStatus(...a),
  getOperation: async (id: number) => operaciones[id] ?? null,
  appendLog: async (entry: any) => {
    logs.push({ level: entry.level, message: entry.message, status: entry.status });
    return entry;
  },
}));

const { runOperation, OperationFailedError } = await import("./IntegrationOperationsService.ts");
const { IntegrationError } = await import("../../domain/errors.ts");

const CTX = { tenantId: "T1", correlationId: "COR-1" };
const OPTS = {
  operationType: "ERP_CREATE_SALES_QUOTE" as const,
  sourceSystem: "mobilink",
  targetSystem: "business-central",
};

describe("runOperation — máquina de estados", () => {
  beforeEach(() => {
    operaciones = {};
    siguienteId = 1;
    logs.length = 0;
    transiciones = [];
    createOperation.mockClear();
    updateOperationStatus.mockClear();
  });

  it("una operación correcta acaba en COMPLETED", async () => {
    const { result, operation } = await runOperation(CTX, OPTS, async () => ({
      result: { ok: true },
      responsePayload: { numero: "1019" },
    }));

    expect(result).toEqual({ ok: true });
    expect(operation.status).toBe("COMPLETED");
    expect(transiciones).toContain("PROCESSING");
    expect(transiciones.at(-1)).toBe("COMPLETED");
  });

  it("un fallo transitorio se reintenta y, si luego funciona, acaba COMPLETED", async () => {
    let intentos = 0;
    const { operation } = await runOperation(CTX, OPTS, async () => {
      intentos++;
      if (intentos < 3) throw IntegrationError.transient("BC_5XX", "Business Central caído");
      return { result: { ok: true }, responsePayload: {} };
    });

    expect(intentos).toBe(3);
    expect(operation.status).toBe("COMPLETED");
    expect(transiciones.filter((t) => t === "RETRY_PENDING")).toHaveLength(2);
    expect(operation.retry_count).toBe(2);
  });

  it("si el sistema externo no se recupera, acaba en MANUAL_REVIEW y no se pierde", async () => {
    let intentos = 0;
    const promesa = runOperation(CTX, OPTS, async () => {
      intentos++;
      throw IntegrationError.transient("BC_NETWORK", "Business Central no responde");
    });

    await expect(promesa).rejects.toBeInstanceOf(OperationFailedError);

    // 1 intento inicial + 3 reintentos.
    expect(intentos).toBe(4);
    expect(transiciones.filter((t) => t === "RETRY_PENDING")).toHaveLength(3);
    expect(transiciones.at(-1)).toBe("MANUAL_REVIEW");
    expect(operaciones[1].status).toBe("MANUAL_REVIEW");
    expect(operaciones[1].error_code).toBe("BC_NETWORK");
  });

  it("un error de validación falla de inmediato, sin reintentos", async () => {
    let intentos = 0;
    const promesa = runOperation(CTX, OPTS, async () => {
      intentos++;
      throw IntegrationError.validation("EMPTY_LINES", "Se requiere al menos una línea");
    });

    await expect(promesa).rejects.toBeInstanceOf(OperationFailedError);
    expect(intentos).toBe(1);
    expect(transiciones).not.toContain("RETRY_PENDING");
    expect(transiciones.at(-1)).toBe("FAILED");
  });

  it("un mapeo ausente va a MANUAL_REVIEW: lo arregla una persona y se relanza", async () => {
    const promesa = runOperation(CTX, OPTS, async () => {
      throw IntegrationError.mapping("MAPPING_NOT_FOUND", "No hay mapeo del artículo PROD-A");
    });

    await expect(promesa).rejects.toBeInstanceOf(OperationFailedError);
    expect(transiciones.at(-1)).toBe("MANUAL_REVIEW");
  });

  it("unas credenciales caducadas van a MANUAL_REVIEW, no a FAILED", async () => {
    const promesa = runOperation(CTX, OPTS, async () => {
      throw IntegrationError.auth("BC_TOKEN_FAILED", "Secreto caducado");
    });

    await expect(promesa).rejects.toBeInstanceOf(OperationFailedError);
    expect(transiciones.at(-1)).toBe("MANUAL_REVIEW");
  });

  it("un error inesperado no tumba la operación: queda registrado como FAILED", async () => {
    const promesa = runOperation(CTX, OPTS, async () => {
      throw new TypeError("undefined is not a function");
    });

    await expect(promesa).rejects.toBeInstanceOf(OperationFailedError);
    expect(operaciones[1].status).toBe("FAILED");
    expect(operaciones[1].error_code).toBe("UNEXPECTED");
  });

  it("deja rastro en el audit log de cada transición", async () => {
    await runOperation(CTX, OPTS, async () => ({ result: null, responsePayload: {} })).catch(() => {});

    expect(logs.some((l) => l.message.includes("Operación recibida"))).toBe(true);
    expect(logs.some((l) => l.status === "COMPLETED")).toBe(true);
  });
});
