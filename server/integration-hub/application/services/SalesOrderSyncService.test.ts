/**
 * Tests de la sincronización de pedidos BC → WorkPlanner (SPEC §2, It.2).
 *
 * Verifican las reglas §2.2: la planificación local no se pisa, una línea en
 * ejecución no se sobreescribe (divergencia anotada), y un pedido desaparecido
 * de BC cancela la OT sólo en pasadas full.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let ordenes: Record<string, any> = {};
let lineas: Record<string, any> = {};
let syncState: any = null;
let bcOrders: any[] = [];
let corSeq = 0;

vi.mock("../../connectors/ConnectorRegistry.ts", () => ({
  resolveErpConnector: async () => ({
    key: "business-central",
    usingDefault: false,
    config: {},
    connector: {
      getSalesOrdersForSync: async () => bcOrders,
    },
  }),
}));

vi.mock("../../infrastructure/repositories.ts", () => ({
  nextCorrelationId: async () => `COR-${++corSeq}`,
  upsertWpOrder: async (o: any) => {
    const previa = ordenes[o.bcOrderId];
    ordenes[o.bcOrderId] = {
      ...(previa ?? { id: Object.keys(ordenes).length + 1, wp_status: "nueva", planning: null }),
      ...o,
      bc_order_id: o.bcOrderId,
      bc_number: o.bcNumber,
      sync_run_id: o.syncRunId,
    };
    return ordenes[o.bcOrderId];
  },
  upsertWpOrderLine: async (l: any) => {
    const previa = lineas[l.bcLineId];
    if (previa?.en_ejecucion) {
      const cambio = Number(previa.qty_prevista) !== Number(l.qtyPrevista ?? 0);
      if (cambio) {
        previa.aviso_divergencia = "cambió en BC durante la ejecución";
        return { row: previa, divergencia: true };
      }
      return { row: previa, divergencia: false };
    }
    lineas[l.bcLineId] = { ...l, qty_prevista: l.qtyPrevista, en_ejecucion: false };
    return { row: lineas[l.bcLineId], divergencia: false };
  },
  markWpOrderCancelledByErp: async (_t: string, bcOrderId: string) => {
    if (ordenes[bcOrderId]) ordenes[bcOrderId].wp_status = "cancelada_por_erp";
  },
  listWpOrders: async () => Object.values(ordenes),
  getSyncState: async () => syncState,
  upsertSyncState: async (p: any) => {
    syncState = {
      ...(syncState ?? {}),
      last_sync_ms: p.lastSyncMs ?? syncState?.last_sync_ms ?? null,
      status: p.status,
      detail: p.detail,
    };
  },
}));

vi.mock("./IntegrationOperationsService.ts", () => ({
  runOperation: async (_ctx: any, _opts: any, work: any) => {
    const logger = { info: async () => {}, warn: async () => {}, error: async () => {} };
    const { result } = await work(logger);
    return { operation: { status: "COMPLETED" }, result };
  },
}));

const { runSalesOrderSync } = await import("./SalesOrderSyncService.ts");

const TENANT = "default";

function pedido(id: string, num: string, lines: any[] = []) {
  return {
    id,
    number: num,
    customerNumber: "10000",
    customerName: "Cliente SL",
    status: "Open",
    lastModifiedDateTime: "2026-08-01T10:00:00Z",
    salesOrderLines: lines,
  };
}

function linea(id: string, qty = 1, extra: any = {}) {
  return {
    id,
    sequence: 10000,
    lineType: "Item",
    lineObjectNumber: "1896-S",
    description: "Pastillas",
    quantity: qty,
    unitOfMeasureCode: "UDS",
    unitPrice: 82.5,
    ...extra,
  };
}

beforeEach(() => {
  ordenes = {};
  lineas = {};
  syncState = null;
  bcOrders = [];
});

describe("runSalesOrderSync", () => {
  it("refleja pedido y líneas en las tablas locales", async () => {
    bcOrders = [pedido("o1", "PV-001", [linea("l1", 2), linea("l2", 1.5)])];

    const r = await runSalesOrderSync({ tenantId: TENANT });

    expect(r.pedidos).toBe(1);
    expect(r.lineas).toBe(2);
    expect(ordenes["o1"].bc_number).toBe("PV-001");
    expect(lineas["l1"].qty_prevista).toBe(2);
  });

  it("las líneas de comentario no se reflejan: no son trabajo", async () => {
    bcOrders = [pedido("o1", "PV-001", [linea("l1"), linea("l2", 0, { lineType: "Comment" })])];

    const r = await runSalesOrderSync({ tenantId: TENANT });

    expect(r.lineas).toBe(1);
    expect(lineas["l2"]).toBeUndefined();
  });

  it("una re-sync actualiza la línea no empezada", async () => {
    bcOrders = [pedido("o1", "PV-001", [linea("l1", 2)])];
    await runSalesOrderSync({ tenantId: TENANT, full: true });
    bcOrders = [pedido("o1", "PV-001", [linea("l1", 5)])];

    await runSalesOrderSync({ tenantId: TENANT, full: true });

    expect(lineas["l1"].qty_prevista).toBe(5);
  });

  it("una línea EN EJECUCIÓN no se pisa: queda la divergencia anotada", async () => {
    bcOrders = [pedido("o1", "PV-001", [linea("l1", 2)])];
    await runSalesOrderSync({ tenantId: TENANT, full: true });
    lineas["l1"].en_ejecucion = true;
    bcOrders = [pedido("o1", "PV-001", [linea("l1", 9)])];

    const r = await runSalesOrderSync({ tenantId: TENANT, full: true });

    expect(r.divergencias).toBe(1);
    expect(lineas["l1"].qty_prevista).toBe(2); // intacta
    expect(lineas["l1"].aviso_divergencia).toBeTruthy();
  });

  it("la planificación local sobrevive a la re-sync", async () => {
    bcOrders = [pedido("o1", "PV-001", [linea("l1")])];
    await runSalesOrderSync({ tenantId: TENANT, full: true });
    ordenes["o1"].wp_status = "planificada";
    ordenes["o1"].planning = { tecnicos: ["García"] };

    await runSalesOrderSync({ tenantId: TENANT, full: true });

    expect(ordenes["o1"].wp_status).toBe("planificada");
    expect(ordenes["o1"].planning).toEqual({ tecnicos: ["García"] });
  });

  it("un pedido desaparecido de BC cancela la OT en una pasada full", async () => {
    bcOrders = [pedido("o1", "PV-001", [linea("l1")]), pedido("o2", "PV-002")];
    await runSalesOrderSync({ tenantId: TENANT, full: true });
    bcOrders = [pedido("o1", "PV-001", [linea("l1")])]; // o2 ya no está

    const r = await runSalesOrderSync({ tenantId: TENANT, full: true });

    expect(r.canceladas).toBe(1);
    expect(ordenes["o2"].wp_status).toBe("cancelada_por_erp");
    expect(ordenes["o1"].wp_status).toBe("nueva");
  });

  it("un incremental NO cancela por ausencia (sólo trae lo modificado)", async () => {
    bcOrders = [pedido("o1", "PV-001"), pedido("o2", "PV-002")];
    await runSalesOrderSync({ tenantId: TENANT, full: true });
    syncState.last_sync_ms = Date.now();
    bcOrders = [pedido("o1", "PV-001")];

    const r = await runSalesOrderSync({ tenantId: TENANT });

    expect(r.mode).toBe("incremental");
    expect(r.canceladas).toBe(0);
    expect(ordenes["o2"].wp_status).toBe("nueva");
  });

  it("una OT finalizada no se reactiva ni se cancela por ausencia", async () => {
    bcOrders = [pedido("o1", "PV-001")];
    await runSalesOrderSync({ tenantId: TENANT, full: true });
    ordenes["o1"].wp_status = "finalizada";
    bcOrders = []; // el pedido se facturó y desapareció de salesOrders

    const r = await runSalesOrderSync({ tenantId: TENANT, full: true });

    expect(r.canceladas).toBe(0);
    expect(ordenes["o1"].wp_status).toBe("finalizada");
  });
});
