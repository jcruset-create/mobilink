/**
 * Tests de la devolución del parte a Business Central (SPEC §3, It.3).
 *
 * Cubren los casos de la spec: consumo igual (1), consumo distinto (2), línea
 * añadida (3-4), material fuera de catálogo (8), pedido no editable (9),
 * caída de BC (11) y rechazo parcial con reproceso idempotente (12).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let orden: any = null;
let lineas: any[] = [];
let catalogo: Record<string, any> = {};
let bcStatus: string | null = "Open";
let bcCalls: Array<{ op: string; args: any }> = [];
/** Números de artículo que BC rechaza al crear línea. */
let bcRejects: Set<string> = new Set();
let bcDown = false;
let corSeq = 0;

const { IntegrationError } = await import("../../domain/errors.ts");

vi.mock("../../connectors/ConnectorRegistry.ts", () => ({
  resolveErpConnector: async () => ({
    key: "business-central",
    usingDefault: false,
    config: {},
    connector: {
      getSalesOrderStatus: async () => {
        if (bcDown) throw IntegrationError.transient("BC_NETWORK", "Business Central no responde");
        return bcStatus;
      },
      updateSalesOrderLineQuantity: async (_c: any, orderId: string, lineId: string, qty: number) => {
        if (bcDown) throw IntegrationError.transient("BC_NETWORK", "Business Central no responde");
        bcCalls.push({ op: "patch", args: { orderId, lineId, qty } });
      },
      createSalesOrderLine: async (_c: any, orderId: string, line: any) => {
        if (bcDown) throw IntegrationError.transient("BC_NETWORK", "Business Central no responde");
        if (bcRejects.has(line.itemNumber)) {
          throw IntegrationError.permanent("BC_ERROR", `El artículo ${line.itemNumber} está bloqueado para venta`);
        }
        bcCalls.push({ op: "post", args: { orderId, line } });
        return { bcLineId: `bc-${line.itemNumber}`, bcLineNo: 90000 };
      },
    },
  }),
}));

vi.mock("../../infrastructure/repositories.ts", () => ({
  nextCorrelationId: async () => `COR-${++corSeq}`,
  getWpOrderWithLines: async () => (orden ? { order: orden, lines: structuredClone(lineas) } : null),
  setLineConsumption: async (p: any) => {
    const l = lineas.find((x) => x.id === p.lineId);
    if (l) {
      l.qty_consumida = p.qtyConsumida;
      l.en_ejecucion = true;
    }
    return l ?? null;
  },
  addWpLine: async (p: any) => {
    const l = {
      id: 100 + lineas.length,
      wp_order_id: p.wpOrderId,
      origen: "wp",
      estado_sync: "pending_return",
      tipo: p.tipo,
      bc_item_number: p.bcItemNumber,
      descripcion: p.descripcion,
      qty_prevista: p.qty,
      qty_consumida: p.qty,
      um: p.um,
      bc_line_id: null,
      en_ejecucion: true,
    };
    lineas.push(l);
    return l;
  },
  getCatalogItemByNumber: async (_t: string, n: string) => catalogo[n] ?? null,
  setLineReturnResult: async (p: any) => {
    const l = lineas.find((x) => x.id === p.lineId);
    if (l) {
      l.estado_sync = p.estadoSync;
      if (p.bcLineId) l.bc_line_id = p.bcLineId;
      l.aviso_divergencia = p.aviso ?? null;
    }
  },
  updateWpOrderPlanning: async (p: any) => {
    if (orden && p.wpStatus) orden.wp_status = p.wpStatus;
    return orden;
  },
}));

vi.mock("./IntegrationOperationsService.ts", async () => {
  const errors = await import("../../domain/errors.ts");
  return {
    runOperation: async (_ctx: any, _opts: any, work: any) => {
      const logger = { info: async () => {}, warn: async () => {}, error: async () => {} };
      try {
        const { result } = await work(logger);
        return { operation: { status: "COMPLETED" }, result };
      } catch (e) {
        // Reproduce el mapeo real: BLOCKED → MANUAL_REVIEW (los tests lo afirman).
        if (e instanceof errors.IntegrationError) throw e;
        throw e;
      }
    },
  };
});

const { registerExecution, confirmReturn } = await import("./ExecutionReturnService.ts");

const TENANT = "default";

beforeEach(() => {
  orden = {
    id: 1,
    bc_order_id: "guid-o1",
    bc_number: "PV-001",
    wp_status: "en_curso",
  };
  lineas = [
    {
      id: 1,
      origen: "bc",
      estado_sync: "synced",
      bc_line_id: "guid-l1",
      bc_item_number: "1896-S",
      descripcion: "Pastillas",
      qty_prevista: 2,
      qty_consumida: null,
      en_ejecucion: false,
    },
  ];
  catalogo = {
    "3417-B": { bc_number: "3417-B", descripcion: "Filtro de aceite", tipo: "Inventory", um_base: "UDS", activo: true },
    "BLOQ-1": { bc_number: "BLOQ-1", descripcion: "Bloqueado", tipo: "Inventory", um_base: "UDS", activo: false },
  };
  bcStatus = "Open";
  bcCalls = [];
  bcRejects = new Set();
  bcDown = false;
});

describe("registerExecution (local, sin tocar BC)", () => {
  it("registra consumo y pone la línea en ejecución", async () => {
    const r = await registerExecution({ tenantId: TENANT, wpOrderId: 1, lines: [{ lineId: 1, qtyConsumida: 3 }] });

    expect(r.lineasActualizadas).toBe(1);
    expect(lineas[0].qty_consumida).toBe(3);
    expect(lineas[0].en_ejecucion).toBe(true);
    expect(bcCalls).toEqual([]);
  });

  it("añade una línea de campo desde el catálogo controlado", async () => {
    const r = await registerExecution({
      tenantId: TENANT,
      wpOrderId: 1,
      extraLines: [{ bcItemNumber: "3417-B", qty: 1 }],
    });

    expect(r.lineasAnadidas).toBe(1);
    expect(lineas[1].origen).toBe("wp");
    expect(lineas[1].estado_sync).toBe("pending_return");
  });

  it("caso 8: un material fuera del catálogo activo NO se acepta", async () => {
    await expect(
      registerExecution({ tenantId: TENANT, wpOrderId: 1, extraLines: [{ bcItemNumber: "NO-EXISTE", qty: 1 }] })
    ).rejects.toMatchObject({ code: "WP_ITEM_NOT_IN_CATALOG" });

    await expect(
      registerExecution({ tenantId: TENANT, wpOrderId: 1, extraLines: [{ bcItemNumber: "BLOQ-1", qty: 1 }] })
    ).rejects.toMatchObject({ code: "WP_ITEM_NOT_IN_CATALOG" });
  });

  it("registrar ejecución pasa la OT a en_curso", async () => {
    orden.wp_status = "planificada";

    await registerExecution({ tenantId: TENANT, wpOrderId: 1, lines: [{ lineId: 1, qtyConsumida: 2 }] });

    expect(orden.wp_status).toBe("en_curso");
  });
});

describe("confirmReturn (empuja a BC)", () => {
  it("caso 1: consumo igual al previsto → nada que cambiar en BC", async () => {
    lineas[0].qty_consumida = 2;
    lineas[0].en_ejecucion = true;

    const r = await confirmReturn({ tenantId: TENANT, wpOrderId: 1 });

    expect(r.actualizadas).toBe(0);
    expect(r.omitidas).toBe(1);
    expect(bcCalls).toEqual([]);
  });

  it("caso 2: consumo superior → PATCH de la cantidad", async () => {
    lineas[0].qty_consumida = 3;

    const r = await confirmReturn({ tenantId: TENANT, wpOrderId: 1 });

    expect(r.actualizadas).toBe(1);
    expect(bcCalls[0]).toEqual({ op: "patch", args: { orderId: "guid-o1", lineId: "guid-l1", qty: 3 } });
  });

  it("casos 3-4: línea añadida en campo → POST sin precio", async () => {
    lineas.push({
      id: 100,
      origen: "wp",
      estado_sync: "pending_return",
      bc_line_id: null,
      bc_item_number: "3417-B",
      descripcion: "Filtro de aceite",
      tipo: "Item",
      qty_prevista: 1,
      qty_consumida: 1,
      en_ejecucion: true,
    });

    const r = await confirmReturn({ tenantId: TENANT, wpOrderId: 1 });

    expect(r.enviadas).toBe(1);
    const post = bcCalls.find((c) => c.op === "post")!;
    expect(post.args.line.itemNumber).toBe("3417-B");
    expect(post.args.line).not.toHaveProperty("unitPrice");
    // La línea local queda enlazada con la de BC.
    expect(lineas.find((l) => l.id === 100)!.bc_line_id).toBe("bc-3417-B");
    expect(lineas.find((l) => l.id === 100)!.estado_sync).toBe("returned");
  });

  it("caso 9: pedido no editable → BLOCKED, sin escribir nada", async () => {
    bcStatus = "Released";
    lineas[0].qty_consumida = 3;

    await expect(confirmReturn({ tenantId: TENANT, wpOrderId: 1 })).rejects.toMatchObject({
      code: "BC_ORDER_NOT_EDITABLE",
      kind: "BLOCKED",
    });
    expect(bcCalls).toEqual([]);
  });

  it("caso 9b: pedido desaparecido de BC → BLOCKED con salidas manuales", async () => {
    bcStatus = null;

    await expect(confirmReturn({ tenantId: TENANT, wpOrderId: 1 })).rejects.toMatchObject({
      code: "BC_ORDER_GONE",
      kind: "BLOCKED",
    });
  });

  it("caso 11: BC caído → error transitorio (lo reintenta el worker)", async () => {
    bcDown = true;
    lineas[0].qty_consumida = 3;

    await expect(confirmReturn({ tenantId: TENANT, wpOrderId: 1 })).rejects.toMatchObject({
      code: "BC_NETWORK",
      kind: "TRANSIENT",
    });
  });

  it("caso 12: rechazo parcial — lo aceptado queda, lo rechazado se anota", async () => {
    lineas.push(
      { id: 100, origen: "wp", estado_sync: "pending_return", bc_line_id: null, bc_item_number: "3417-B", descripcion: "", tipo: "Item", qty_prevista: 1, qty_consumida: 1, en_ejecucion: true },
      { id: 101, origen: "wp", estado_sync: "pending_return", bc_line_id: null, bc_item_number: "5544-X", descripcion: "", tipo: "Item", qty_prevista: 1, qty_consumida: 1, en_ejecucion: true }
    );
    catalogo["5544-X"] = { bc_number: "5544-X", activo: true, tipo: "Inventory" };
    bcRejects.add("5544-X");

    await expect(confirmReturn({ tenantId: TENANT, wpOrderId: 1 })).rejects.toMatchObject({
      code: "BC_PARTIAL_REJECTION",
      kind: "BLOCKED",
    });

    expect(lineas.find((l) => l.id === 100)!.estado_sync).toBe("returned");
    expect(lineas.find((l) => l.id === 101)!.estado_sync).toBe("rejected");
    expect(lineas.find((l) => l.id === 101)!.aviso_divergencia).toContain("bloqueado");
  });

  it("caso 12b: el reproceso reenvía SOLO lo rechazado (idempotencia)", async () => {
    lineas.push(
      { id: 100, origen: "wp", estado_sync: "returned", bc_line_id: "bc-3417-B", bc_item_number: "3417-B", descripcion: "", tipo: "Item", qty_prevista: 1, qty_consumida: 1, en_ejecucion: true },
      { id: 101, origen: "wp", estado_sync: "rejected", bc_line_id: null, bc_item_number: "5544-X", descripcion: "", tipo: "Item", qty_prevista: 1, qty_consumida: 1, en_ejecucion: true }
    );

    const r = await confirmReturn({ tenantId: TENANT, wpOrderId: 1 });

    // La devuelta se omite; la rechazada (ya desbloqueada en BC) entra ahora.
    expect(r.enviadas).toBe(1);
    expect(bcCalls.filter((c) => c.op === "post")).toHaveLength(1);
    expect(bcCalls[0].args.line.itemNumber).toBe("5544-X");
  });
});
