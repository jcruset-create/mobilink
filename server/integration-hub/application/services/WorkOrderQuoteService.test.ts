/**
 * Tests del paso "OT real de Mobilink → presupuesto en el ERP".
 *
 * Simulan la base de datos (tablas otf / otf_trabajos), los mapeos y el conector,
 * para verificar la parte que decide QUÉ se envía: qué líneas entran, cómo se
 * identifican, y qué pasa cuando falta un mapeo.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let otfRows: any[] = [];
let trabajoRows: any[] = [];
const mapeos = new Map<string, string>();
/** Última entrada recibida por el servicio de presupuestos. */
let quoteInput: any = null;

vi.mock("../../../db.ts", () => ({
  default: {
    query: async (sql: string) => {
      if (sql.includes("FROM otf_trabajos")) return { rows: trabajoRows };
      if (sql.includes("FROM otf")) return { rows: otfRows };
      return { rows: [] };
    },
  },
}));

vi.mock("../../infrastructure/repositories.ts", () => ({
  findExternalCode: async ({ entityType, mobilinkId }: any) => mapeos.get(`${entityType}:${mobilinkId}`) ?? null,
}));

vi.mock("../../connectors/ConnectorRegistry.ts", () => ({
  resolveErpConnector: async () => ({ key: "business-central", usingDefault: false, config: {} }),
}));

vi.mock("./SalesQuoteService.ts", () => ({
  createQuoteFromWorkOrder: async (input: any) => {
    quoteInput = input;
    return {
      status: "COMPLETED",
      mobilinkQuoteId: "MQ-000002",
      businessCentralQuoteNumber: "1020",
      correlationId: "COR-2",
      simulated: false,
      totalAmount: 120,
      currency: "EUR",
    };
  },
}));

const { previewQuoteFromWorkOrder, createQuoteFromWorkOrderId } = await import("./WorkOrderQuoteService.ts");

const TENANT = "default";

beforeEach(() => {
  otfRows = [{ id: 548, clientName: "Transportes Pérez", clientId: 125, status: "finalizada", notas: null }];
  trabajoRows = [
    {
      id: 1,
      plate: "1234ABC",
      trabajoPlantilla: "CAMBIO-PASTILLAS",
      detalleManual: "Eje delantero",
      trabajo: "Cambio de pastillas",
      observaciones: null,
      status: "hecho",
    },
  ];
  mapeos.clear();
  quoteInput = null;
});

describe("previewQuoteFromWorkOrder", () => {
  it("propone una línea por trabajo y avisa de lo que falta por mapear", async () => {
    const preview = await previewQuoteFromWorkOrder({ tenantId: TENANT, otfId: 548 });

    expect(preview.workOrderId).toBe("OTF-548");
    expect(preview.lines).toHaveLength(1);
    expect(preview.lines[0].mobilinkId).toBe("CAMBIO-PASTILLAS");
    expect(preview.listo).toBe(false);
    expect(preview.sinMapear).toEqual(["cliente '125'", "trabajo 'CAMBIO-PASTILLAS'"]);
  });

  it("marca listo cuando cliente y trabajos están mapeados", async () => {
    mapeos.set("customer:125", "10000");
    mapeos.set("product:CAMBIO-PASTILLAS", "1896-S");

    const preview = await previewQuoteFromWorkOrder({ tenantId: TENANT, otfId: 548 });

    expect(preview.customer.externalCode).toBe("10000");
    expect(preview.lines[0].externalCode).toBe("1896-S");
    expect(preview.sinMapear).toEqual([]);
    expect(preview.listo).toBe(true);
  });

  it("excluye los trabajos cancelados, que no se facturan", async () => {
    trabajoRows.push({ ...trabajoRows[0], id: 2, trabajoPlantilla: "OTRO", status: "cancelado" });

    const preview = await previewQuoteFromWorkOrder({ tenantId: TENANT, otfId: 548 });

    expect(preview.lines.map((l) => l.mobilinkId)).toEqual(["CAMBIO-PASTILLAS"]);
  });

  it("compone la descripción con el trabajo y su detalle", async () => {
    const preview = await previewQuoteFromWorkOrder({ tenantId: TENANT, otfId: 548 });

    expect(preview.lines[0].description).toBe("Cambio de pastillas · Eje delantero");
  });

  it("recorta descripciones largas para que no las corte el ERP", async () => {
    trabajoRows[0].detalleManual = "x".repeat(200);

    const preview = await previewQuoteFromWorkOrder({ tenantId: TENANT, otfId: 548 });

    expect(preview.lines[0].description.length).toBeLessThanOrEqual(100);
    expect(preview.lines[0].description.endsWith("…")).toBe(true);
  });

  it("falla si la OT no existe", async () => {
    otfRows = [];

    await expect(previewQuoteFromWorkOrder({ tenantId: TENANT, otfId: 999 })).rejects.toMatchObject({
      code: "OTF_NOT_FOUND",
      kind: "NOT_FOUND",
    });
  });

  it("falla si la OT no tiene cliente", async () => {
    otfRows[0].clientId = null;
    otfRows[0].clientName = "";

    await expect(previewQuoteFromWorkOrder({ tenantId: TENANT, otfId: 548 })).rejects.toMatchObject({
      code: "OTF_SIN_CLIENTE",
    });
  });
});

describe("createQuoteFromWorkOrderId", () => {
  it("no envía nada al ERP si falta algún mapeo", async () => {
    await expect(createQuoteFromWorkOrderId({ tenantId: TENANT, otfId: 548 })).rejects.toMatchObject({
      code: "OTF_SIN_MAPEAR",
      kind: "MAPPING",
    });
    expect(quoteInput).toBeNull();
  });

  it("crea el presupuesto cuando todo está mapeado", async () => {
    mapeos.set("customer:125", "10000");
    mapeos.set("product:CAMBIO-PASTILLAS", "1896-S");

    const r = await createQuoteFromWorkOrderId({ tenantId: TENANT, otfId: 548 });

    expect(r.businessCentralQuoteNumber).toBe("1020");
    expect(r.preview.listo).toBe(true);
  });

  it("envía identificadores de Mobilink, no códigos ya traducidos", async () => {
    mapeos.set("customer:125", "10000");
    mapeos.set("product:CAMBIO-PASTILLAS", "1896-S");

    await createQuoteFromWorkOrderId({ tenantId: TENANT, otfId: 548 });

    // La traducción debe ocurrir en un único sitio (el Mapping Engine del
    // SalesQuoteService); traducir dos veces rompería el modo estricto.
    expect(quoteInput.customerId).toBe("125");
    expect(quoteInput.lines[0].externalProductId).toBe("CAMBIO-PASTILLAS");
    expect(quoteInput.workOrderId).toBe("OTF-548");
  });

  it("permite forzar el envío sin mapeos cuando los códigos ya coinciden", async () => {
    const r = await createQuoteFromWorkOrderId({ tenantId: TENANT, otfId: 548, permitirSinMapear: true });

    expect(r.businessCentralQuoteNumber).toBe("1020");
    expect(quoteInput.lines[0].externalProductId).toBe("CAMBIO-PASTILLAS");
  });

  it("falla si la OT no tiene trabajos facturables", async () => {
    trabajoRows = [];

    await expect(createQuoteFromWorkOrderId({ tenantId: TENANT, otfId: 548 })).rejects.toMatchObject({
      code: "OTF_SIN_TRABAJOS",
    });
  });
});
