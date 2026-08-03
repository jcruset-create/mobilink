/**
 * Tests del Mapping Engine (§4.3) con el repositorio simulado.
 *
 * Lo que importa verificar aquí es la decisión de diseño: qué ocurre cuando un
 * identificador NO está mapeado, en modo permisivo y en modo estricto.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const findExternalCode = vi.fn();

vi.mock("../../infrastructure/repositories.ts", () => ({
  findExternalCode: (...args: unknown[]) => findExternalCode(...args),
}));

const { resolveExternalId, resolveQuoteIds } = await import("./MappingService.ts");

const BASE = { tenantId: "T1", system: "business-central" };

describe("MappingService", () => {
  beforeEach(() => {
    findExternalCode.mockReset();
  });

  it("traduce un id de Mobilink al código del sistema externo", async () => {
    findExternalCode.mockResolvedValue("10000");

    const r = await resolveExternalId("customer", "CLI-00125", BASE);

    expect(r).toEqual({ externalCode: "10000", mapped: true });
  });

  it("en modo permisivo usa el id tal cual si no hay mapeo", async () => {
    findExternalCode.mockResolvedValue(null);

    const r = await resolveExternalId("product", "1896-S", BASE);

    expect(r).toEqual({ externalCode: "1896-S", mapped: false });
  });

  it("en modo estricto un id sin mapear es un error de MAPPING (→ revisión manual)", async () => {
    findExternalCode.mockResolvedValue(null);

    await expect(resolveExternalId("product", "PAST-VOL-001", { ...BASE, strict: true })).rejects.toMatchObject({
      code: "MAPPING_NOT_FOUND",
      kind: "MAPPING",
    });
  });

  it("resuelve cliente y líneas conservando el orden de las líneas", async () => {
    findExternalCode.mockImplementation(async ({ mobilinkId }: any) => {
      const tabla: Record<string, string> = {
        "CLI-00125": "10000",
        "PROD-A": "1896-S",
        "PROD-B": "1900-S",
      };
      return tabla[mobilinkId] ?? null;
    });

    const ids = await resolveQuoteIds({
      ...BASE,
      customerId: "CLI-00125",
      productIds: ["PROD-A", "PROD-B"],
    });

    expect(ids.customer.externalCode).toBe("10000");
    expect(ids.products.map((p) => p.externalCode)).toEqual(["1896-S", "1900-S"]);
    expect(ids.resumen).toContain("3/3");
  });

  it("mezcla mapeados y no mapeados sin romper el orden", async () => {
    findExternalCode.mockImplementation(async ({ mobilinkId }: any) =>
      mobilinkId === "PROD-A" ? "1896-S" : null
    );

    const ids = await resolveQuoteIds({
      ...BASE,
      customerId: "10000",
      productIds: ["PROD-A", "MO-FRENOS"],
    });

    // El artículo mapeado se traduce; el resto pasa tal cual.
    expect(ids.products[0]).toEqual({ externalCode: "1896-S", mapped: true });
    expect(ids.products[1]).toEqual({ externalCode: "MO-FRENOS", mapped: false });
    expect(ids.resumen).toContain("1/3");
  });

  it("en estricto falla antes de tocar el ERP si falta un solo artículo", async () => {
    findExternalCode.mockImplementation(async ({ mobilinkId }: any) =>
      mobilinkId === "CLI-00125" ? "10000" : null
    );

    await expect(
      resolveQuoteIds({
        ...BASE,
        strict: true,
        customerId: "CLI-00125",
        productIds: ["PROD-A"],
      })
    ).rejects.toMatchObject({ code: "MAPPING_NOT_FOUND" });
  });
});
