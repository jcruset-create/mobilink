/**
 * El adaptador del ERP, con un Hub de mentira.
 *
 * Lo que se fija es la traducción y, sobre todo, las tres respuestas que no
 * son lo mismo: «no lo sé» (null), «no consta» (existe: false) y «aquí está».
 * Confundir las dos primeras es lo que haría que la pantalla dijera que el
 * albarán falta del ERP cuando lo que pasa es que nadie ha podido preguntar.
 */

import { describe, expect, it, vi } from "vitest";
import type { PurchaseReceipt } from "../../integration-hub/domain/connectors.ts";
import { aEstadoAlbaran, claveCompany, consultaErpDe, type ResolverConector } from "./hub.ts";

vi.mock("../config.ts", () => ({
  leerTextoConfig: async (_empresa: string, clave: string) => (clave === "erp.company.007" ? "GUID-007" : null),
}));

const recibo: PurchaseReceipt = {
  externalId: "x",
  number: "REC-1",
  vendorShipmentNumber: "0501234",
  vendorNumber: "V8",
  vendorName: "PROVEEDOR EJEMPLO SL",
  postingDate: "2026-09-02",
  posted: true,
  invoiceNumber: "F-2026-0001",
  totalExcludingTax: 213.9,
  lines: [
    { itemNumber: "4400111222333", description: "PASTILLA", quantity: 1, unitCost: 77.5, amountExcludingTax: 27.9 },
    { itemNumber: "4400111222444", description: "DISCO", quantity: 2, unitCost: 155, amountExcludingTax: 186 },
  ],
};

const ctx = { empresaId: "tenant", empresaCodigo: "007" };

describe("el adaptador del ERP", () => {
  it("sin conector, o sin el método, contesta «sin ERP» y la pantalla no ofrece la consulta", async () => {
    expect((await consultaErpDe("t", async () => null)).disponible()).toBe(false);
    expect((await consultaErpDe("t", async () => ({ key: "otro", connector: {} }))).disponible()).toBe(false);
  });

  it("traduce el albarán a céntimos y conserva quién contestó", async () => {
    const resolver: ResolverConector = async () => ({
      key: "business-central",
      connector: { getPurchaseReceipt: async () => ({ found: true, receipt: recibo }) },
    });
    const c = await consultaErpDe("tenant", resolver);
    expect(c.disponible()).toBe(true);
    const e = await c.consultarAlbaran(ctx, "0501234");
    expect(e).not.toBeNull();
    expect(e!.existe).toBe(true);
    expect(e!.importeCentimos).toBe(21390);
    expect(e!.lineas![0].precioUnitarioCentimos).toBe(7750);
    expect(e!.lineas![1].importeCentimos).toBe(18600);
    expect(e!.facturaAsociada).toBe("F-2026-0001");
    expect(e!.fuente).toBe("business-central");
  });

  it("la sociedad del correo decide la company del ERP", async () => {
    const llamadas: unknown[] = [];
    const resolver: ResolverConector = async () => ({
      key: "bc",
      connector: {
        getPurchaseReceipt: async (_c, q) => {
          llamadas.push(q);
          return { found: false };
        },
      },
    });
    const c = await consultaErpDe("tenant", resolver);
    const e = await c.consultarAlbaran(ctx, "0501234");
    expect(llamadas[0]).toEqual({ vendorShipmentNumber: "0501234", companyId: "GUID-007" });
    // «No consta» es una respuesta: existe en false, no null.
    expect(e).toEqual(expect.objectContaining({ existe: false, lineas: null }));
    expect(claveCompany(" 007 ")).toBe("erp.company.007");
  });

  it("«no lo sé» (simulación) y un ERP caído son null, nunca «no consta»", async () => {
    const simulado = await consultaErpDe("t", async () => ({ key: "bc", connector: { getPurchaseReceipt: async () => null } }));
    expect(await simulado.consultarAlbaran(ctx, "1")).toBeNull();
    const caido = await consultaErpDe("t", async () => ({
      key: "bc",
      connector: {
        getPurchaseReceipt: async () => {
          throw new Error("503");
        },
      },
    }));
    expect(await caido.consultarAlbaran(ctx, "1")).toBeNull();
  });

  it("aEstadoAlbaran suma las líneas cuando el ERP no da total", () => {
    const e = aEstadoAlbaran({ found: true, receipt: { ...recibo, totalExcludingTax: null } }, "bc");
    expect(e.importeCentimos).toBeNull();
    expect(e.lineas).toHaveLength(2);
  });
});
