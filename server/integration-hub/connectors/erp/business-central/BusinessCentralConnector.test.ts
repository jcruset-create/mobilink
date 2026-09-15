/**
 * Tests del BusinessCentralConnector con `fetch` simulado.
 *
 * No tocan Business Central ni Entra ID: comprueban el comportamiento que no se
 * puede verificar a ojo — que el token se cachea, que un 429 se reintenta
 * respetando Retry-After, que la paginación se sigue entera y que los literales
 * OData se escapan bien.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  BusinessCentralConnector,
  clearBusinessCentralTokenCache,
} from "./BusinessCentralConnector.ts";
import { setSecretsProvider } from "../../../infrastructure/secrets.ts";

const CONFIG = {
  baseUrl: "https://api.bc.test/v2.0/tenant/Production/api/v2.0",
  companyId: "COMPANY-GUID",
  aadTenantId: "aad-tenant",
  maxRetries: 2,
};

const CTX = { tenantId: "TENANT-001", correlationId: "COR-1" };

/** Credenciales siempre presentes: así el conector nunca cae en simulación. */
setSecretsProvider({
  async get(_tenantId: string, _connectorKey: string, name: string) {
    return name === "client_id" ? "cid" : name === "client_secret" ? "secret" : "aad-tenant";
  },
});

function tokenResponse(expiresIn = 3600) {
  return new Response(JSON.stringify({ access_token: "TOKEN", expires_in: expiresIn }), { status: 200 });
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), { status: 200, ...init });
}

/** URLs pedidas, para afirmar sobre ellas sin depender del orden de las cabeceras. */
function urlsOf(mock: ReturnType<typeof vi.fn>): string[] {
  return mock.mock.calls.map((c) => String(c[0]));
}

describe("BusinessCentralConnector", () => {
  beforeEach(() => {
    clearBusinessCentralTokenCache();
    vi.restoreAllMocks();
  });

  it("pide el token una sola vez para varias llamadas seguidas", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("login.microsoftonline.com")) return tokenResponse();
      return jsonResponse({ value: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const bc = new BusinessCentralConnector(CONFIG);
    await bc.getCustomers(CTX);
    await bc.getCustomers(CTX);
    await bc.getProducts(CTX);

    const tokenCalls = urlsOf(fetchMock).filter((u) => u.includes("login.microsoftonline.com"));
    expect(tokenCalls).toHaveLength(1);
  });

  it("vuelve a pedir token cuando el cacheado ha caducado", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      // expires_in bajo: con el margen de seguridad, el token nace ya caducado.
      if (String(url).includes("login.microsoftonline.com")) return tokenResponse(10);
      return jsonResponse({ value: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const bc = new BusinessCentralConnector(CONFIG);
    await bc.getCustomers(CTX);
    await bc.getCustomers(CTX);

    const tokenCalls = urlsOf(fetchMock).filter((u) => u.includes("login.microsoftonline.com"));
    expect(tokenCalls).toHaveLength(2);
  });

  it("reintenta ante un 429 y acaba devolviendo los datos", async () => {
    let intentos = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("login.microsoftonline.com")) return tokenResponse();
      intentos++;
      if (intentos === 1) {
        return new Response("", { status: 429, headers: { "retry-after": "0" } });
      }
      return jsonResponse({ value: [{ number: "C1", displayName: "Cliente" }] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const bc = new BusinessCentralConnector(CONFIG);
    const customers = await bc.getCustomers(CTX);

    expect(intentos).toBe(2);
    expect(customers).toHaveLength(1);
    expect(customers[0].externalId).toBe("C1");
  });

  it("da error transitorio si el 429 persiste (lo reintentará el worker)", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("login.microsoftonline.com")) return tokenResponse();
      return new Response("", { status: 429, headers: { "retry-after": "0" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const bc = new BusinessCentralConnector(CONFIG);
    await expect(bc.getCustomers(CTX)).rejects.toMatchObject({
      code: "BC_RATE_LIMITED",
      kind: "TRANSIENT",
    });
  });

  it("sigue la paginación hasta agotar los nextLink", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("login.microsoftonline.com")) return tokenResponse();
      if (u.includes("page=2")) return jsonResponse({ value: [{ number: "C3" }] });
      return jsonResponse({
        value: [{ number: "C1" }, { number: "C2" }],
        "@odata.nextLink": "https://api.bc.test/next?page=2",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const bc = new BusinessCentralConnector(CONFIG);
    const customers = await bc.getCustomers(CTX);

    expect(customers.map((c) => c.externalId)).toEqual(["C1", "C2", "C3"]);
  });

  it("escapa las comillas simples del código de artículo en el $filter", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("login.microsoftonline.com")) return tokenResponse();
      return jsonResponse({ value: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const bc = new BusinessCentralConnector(CONFIG);
    await bc.getStock(CTX, ["O'BRIEN-1"]);

    const consulta = urlsOf(fetchMock).find((u) => u.includes("items"))!;
    // La comilla va duplicada (''), que es como se escapa en OData.
    expect(decodeURIComponent(consulta)).toContain("number eq 'O''BRIEN-1'");
  });

  it("consulta varios artículos en una sola petición, no uno a uno", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("login.microsoftonline.com")) return tokenResponse();
      return jsonResponse({
        value: [
          { number: "A", inventory: 3 },
          { number: "B", inventory: 0 },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const bc = new BusinessCentralConnector(CONFIG);
    const stock = await bc.getStock(CTX, ["A", "B"]);

    const consultas = urlsOf(fetchMock).filter((u) => u.includes("items"));
    expect(consultas).toHaveLength(1);
    expect(stock).toEqual([
      { externalProductId: "A", available: 3 },
      { externalProductId: "B", available: 0 },
    ]);
  });

  it("refresca el token una vez ante un 401 antes de rendirse", async () => {
    let llamadasDatos = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("login.microsoftonline.com")) return tokenResponse();
      llamadasDatos++;
      if (llamadasDatos === 1) return new Response("", { status: 401 });
      return jsonResponse({ value: [{ number: "C1" }] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const bc = new BusinessCentralConnector(CONFIG);
    const customers = await bc.getCustomers(CTX);

    expect(customers).toHaveLength(1);
    const tokenCalls = urlsOf(fetchMock).filter((u) => u.includes("login.microsoftonline.com"));
    expect(tokenCalls).toHaveLength(2); // el inicial y el refresco tras el 401
  });

  it("sin configuración opera en simulación y no llama a la red", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const bc = new BusinessCentralConnector({});
    const resultado = await bc.testConnection(CTX);

    expect(resultado.ok).toBe(true);
    expect(resultado.message).toMatch(/simulaci/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  describe("albaranes de compra", () => {
    const recibo = {
      id: "g-1",
      number: "REC-0001",
      vendorShipmentNumber: "0501234",
      vendorNumber: "V8",
      vendorName: "PROVEEDOR EJEMPLO SL",
      postingDate: "2026-09-02",
      invoiceNumber: "F-2026-0001",
      totalAmountExcludingTax: 213.9,
      purchaseReceiptLines: [
        { lineType: "Item", lineObjectNumber: "4400111222333", description: "PASTILLA", quantity: 1, unitCost: 77.5, amountExcludingTax: 27.9 },
        { lineType: "Comment", description: "Entregar en el muelle" },
        { lineType: "Item", lineObjectNumber: "4400111222444", description: "DISCO", quantity: 2, unitCost: 155, amountExcludingTax: 186 },
      ],
    };

    it("filtra por el número del proveedor, expande las líneas y deja fuera los comentarios", async () => {
      const fetchMock = vi.fn(async (url: string) => {
        if (String(url).includes("login.microsoftonline.com")) return tokenResponse();
        return jsonResponse({ value: [recibo] });
      });
      vi.stubGlobal("fetch", fetchMock);

      const bc = new BusinessCentralConnector(CONFIG);
      const r = await bc.getPurchaseReceipt(CTX, { vendorShipmentNumber: "0501234" });
      expect(r).not.toBeNull();
      expect(r!.found).toBe(true);
      if (!r || !r.found) return;
      expect(r.receipt.vendorShipmentNumber).toBe("0501234");
      expect(r.receipt.lines).toHaveLength(2);
      expect(r.receipt.lines[0].itemNumber).toBe("4400111222333");
      expect(r.receipt.totalExcludingTax).toBe(213.9);

      const url = urlsOf(fetchMock).find((u) => u.includes("purchaseReceipts"))!;
      expect(decodeURIComponent(url)).toContain("vendorShipmentNumber eq '0501234'");
      expect(url).toContain("$expand=purchaseReceiptLines");
      expect(url).toContain("companies(COMPANY-GUID)");
    });

    it("una company distinta y un campo distinto van a la URL, y una comilla se escapa", async () => {
      const fetchMock = vi.fn(async (url: string) => {
        if (String(url).includes("login.microsoftonline.com")) return tokenResponse();
        return jsonResponse({ value: [] });
      });
      vi.stubGlobal("fetch", fetchMock);

      const bc = new BusinessCentralConnector({ ...CONFIG, purchaseReceiptVendorField: "vendorOrderNumber" });
      const r = await bc.getPurchaseReceipt(CTX, { vendorShipmentNumber: "A'B", companyId: "OTRA" });
      expect(r).toEqual({ found: false });
      const url = decodeURIComponent(urlsOf(fetchMock).find((u) => u.includes("purchaseReceipts"))!);
      expect(url).toContain("companies(OTRA)");
      expect(url).toContain("vendorOrderNumber eq 'A''B'");
    });

    it("con dos recepciones con el mismo número se queda con la más reciente", async () => {
      const fetchMock = vi.fn(async (url: string) => {
        if (String(url).includes("login.microsoftonline.com")) return tokenResponse();
        return jsonResponse({ value: [{ ...recibo, id: "vieja", postingDate: "2025-01-01" }, { ...recibo, id: "nueva", postingDate: "2026-09-02" }] });
      });
      vi.stubGlobal("fetch", fetchMock);
      const r = await new BusinessCentralConnector(CONFIG).getPurchaseReceipt(CTX, { vendorShipmentNumber: "0501234" });
      expect(r && r.found && r.receipt.externalId).toBe("nueva");
    });

    it("en simulación contesta null: no lo sé, no «no consta»", async () => {
      const bc = new BusinessCentralConnector({});
      expect(await bc.getPurchaseReceipt(CTX, { vendorShipmentNumber: "0501234" })).toBeNull();
    });
  });
});
