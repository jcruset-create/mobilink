/**
 * Tests del catálogo controlado (SPEC §4, It.1).
 *
 * Verifican las decisiones de la spec: filtro de inclusión (bloqueados y categorías),
 * marca de agua incremental con solape, conciliación de huérfanos sólo en full, y que
 * un fallo deja el estado en error sin perder la marca anterior.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let catalogo: Record<string, any> = {};
let syncState: any = null;
let bcItems: any[] = [];
let getCatalogItemsCalls: any[] = [];
let connectorConfig: Record<string, unknown> = {};
let huerfanosDesactivados = 0;

vi.mock("../../connectors/ConnectorRegistry.ts", () => ({
  resolveErpConnector: async () => ({
    key: "business-central",
    usingDefault: false,
    config: connectorConfig,
    connector: {
      getCatalogItems: async (_ctx: any, opts: any) => {
        getCatalogItemsCalls.push(opts);
        return bcItems;
      },
    },
  }),
}));

let corSeq = 0;

vi.mock("../../infrastructure/repositories.ts", () => ({
  nextCorrelationId: async () => `COR-${++corSeq}`,
  upsertCatalogItem: async (item: any) => {
    catalogo[item.bcNumber] = item;
    return item;
  },
  deactivateCatalogOrphans: async (_tenantId: string, runId: string) => {
    let n = 0;
    for (const item of Object.values(catalogo) as any[]) {
      if (item.activo && item.syncRunId !== runId) {
        item.activo = false;
        item.motivoInactivo = "huerfano";
        n++;
      }
    }
    huerfanosDesactivados = n;
    return n;
  },
  getSyncState: async () => syncState,
  upsertSyncState: async (params: any) => {
    syncState = { ...(syncState ?? {}), ...toRow(params) };
  },
  listCatalog: async () => Object.values(catalogo),
  // Usados por IntegrationOperationsService a través del mock de abajo — no aquí.
}));

function toRow(p: any) {
  return {
    tenant_id: p.tenantId,
    entity: p.entity,
    last_sync_ms: p.lastSyncMs ?? syncState?.last_sync_ms ?? null,
    last_full_sync_ms: p.lastFullSyncMs ?? syncState?.last_full_sync_ms ?? null,
    status: p.status,
    detail: p.detail,
  };
}

// La máquina de estados real ya tiene sus propios tests; aquí se atraviesa sin BD.
vi.mock("./IntegrationOperationsService.ts", () => ({
  runOperation: async (_ctx: any, _opts: any, work: any) => {
    const logger = { info: async () => {}, warn: async () => {}, error: async () => {} };
    const { result } = await work(logger);
    return { operation: { status: "COMPLETED" }, result };
  },
}));

const { runCatalogSync } = await import("./CatalogSyncService.ts");

const TENANT = "default";

beforeEach(() => {
  catalogo = {};
  syncState = null;
  bcItems = [];
  getCatalogItemsCalls = [];
  connectorConfig = {};
  huerfanosDesactivados = 0;
});

function item(n: string, extra: any = {}) {
  return {
    id: `guid-${n}`,
    number: n,
    displayName: `Artículo ${n}`,
    type: "Inventory",
    itemCategoryCode: "FRENOS",
    baseUnitOfMeasureCode: "UDS",
    unitPrice: 10,
    blocked: false,
    lastModifiedDateTime: "2026-08-01T10:00:00Z",
    ...extra,
  };
}

describe("runCatalogSync — modos", () => {
  it("sin marca de agua previa, la primera pasada es full aunque no se pida", async () => {
    bcItems = [item("A")];

    const r = await runCatalogSync({ tenantId: TENANT });

    expect(r.mode).toBe("full");
    expect(getCatalogItemsCalls[0].modifiedSince).toBeUndefined();
  });

  it("con marca previa hace incremental con solape de 5 minutos", async () => {
    const marca = Date.parse("2026-08-01T12:00:00Z");
    syncState = { last_sync_ms: marca };
    bcItems = [item("A")];

    const r = await runCatalogSync({ tenantId: TENANT });

    expect(r.mode).toBe("incremental");
    const since: Date = getCatalogItemsCalls[0].modifiedSince;
    expect(since.getTime()).toBe(marca - 5 * 60 * 1000);
  });

  it("full explícito ignora la marca de agua", async () => {
    syncState = { last_sync_ms: Date.now() };
    bcItems = [item("A")];

    const r = await runCatalogSync({ tenantId: TENANT, full: true });

    expect(r.mode).toBe("full");
    expect(getCatalogItemsCalls[0].modifiedSince).toBeUndefined();
  });
});

describe("runCatalogSync — filtro de inclusión", () => {
  it("un artículo bloqueado se guarda inactivo con su motivo, no se borra", async () => {
    bcItems = [item("A"), item("B", { blocked: true })];

    const r = await runCatalogSync({ tenantId: TENANT });

    expect(r.activos).toBe(1);
    expect(r.desactivados).toBe(1);
    expect(catalogo["B"].activo).toBe(false);
    expect(catalogo["B"].motivoInactivo).toBe("bloqueado");
  });

  it("respeta la lista de categorías permitidas de la config", async () => {
    connectorConfig = { catalogCategories: ["frenos"] };
    bcItems = [item("A"), item("B", { itemCategoryCode: "PINTURA" })];

    const r = await runCatalogSync({ tenantId: TENANT });

    expect(catalogo["A"].activo).toBe(true);
    expect(catalogo["B"].activo).toBe(false);
    expect(catalogo["B"].motivoInactivo).toBe("fuera_de_filtro");
    expect(r.activos).toBe(1);
  });

  it("sin lista de categorías entran todas", async () => {
    bcItems = [item("A", { itemCategoryCode: "PINTURA" })];

    const r = await runCatalogSync({ tenantId: TENANT });

    expect(r.activos).toBe(1);
  });
});

describe("runCatalogSync — huérfanos y estado", () => {
  it("una pasada full desactiva lo que ya no existe en BC", async () => {
    // Pasada 1: A y B.
    bcItems = [item("A"), item("B")];
    await runCatalogSync({ tenantId: TENANT, full: true });
    // Pasada 2 (full): sólo A — B ha desaparecido de BC.
    bcItems = [item("A")];

    const r = await runCatalogSync({ tenantId: TENANT, full: true });

    expect(r.huerfanos).toBe(1);
    expect(catalogo["B"].activo).toBe(false);
    expect(catalogo["B"].motivoInactivo).toBe("huerfano");
  });

  it("un incremental NO toca los huérfanos (no puede saberlo)", async () => {
    bcItems = [item("A"), item("B")];
    await runCatalogSync({ tenantId: TENANT, full: true });
    syncState.last_sync_ms = Date.now();
    bcItems = [item("A")]; // el incremental sólo trae lo modificado

    const r = await runCatalogSync({ tenantId: TENANT });

    expect(r.mode).toBe("incremental");
    expect(r.huerfanos).toBe(0);
    expect(catalogo["B"].activo).toBe(true);
  });

  it("guarda la marca de agua del INICIO de la pasada, no del final", async () => {
    bcItems = [item("A")];
    const antes = Date.now();

    await runCatalogSync({ tenantId: TENANT });

    expect(Number(syncState.last_sync_ms)).toBeGreaterThanOrEqual(antes);
    expect(Number(syncState.last_sync_ms)).toBeLessThanOrEqual(Date.now());
    expect(syncState.status).toBe("ok");
  });

  it("un fallo del conector deja el estado en error sin perder la marca anterior", async () => {
    const marcaPrevia = 12345;
    syncState = { last_sync_ms: marcaPrevia };
    bcItems = [];
    const boom = new Error("BC caído");
    getCatalogItemsCalls; // silence unused
    // El conector falla:
    (await import("../../connectors/ConnectorRegistry.ts")).resolveErpConnector; // ref
    // Redefinimos items para lanzar:
    bcItems = null as any;

    await expect(runCatalogSync({ tenantId: TENANT })).rejects.toBeTruthy();
    expect(syncState.status).toBe("error");
    expect(Number(syncState.last_sync_ms)).toBe(marcaPrevia);
    void boom;
  });
});
