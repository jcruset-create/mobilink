/**
 * BusinessCentralConnector — primera implementación de IErpConnector (§2.3, Fase 1).
 *
 * Habla con Microsoft Dynamics 365 Business Central mediante su API REST v2.0 (OData),
 * autenticándose con OAuth 2.0 client credentials (Azure AD). Las credenciales se resuelven
 * desde el proveedor de secretos, nunca desde la config en BD.
 *
 * MODO SIMULACIÓN: si el conector no está configurado (sin baseUrl/companyId o sin secretos),
 * opera en modo simulación determinista. Esto permite ejecutar la primera entrega funcional
 * (OT → presupuesto BC) de extremo a extremo sin un entorno BC real. El modo se refleja en
 * la respuesta (`simulated: true`) y en el audit log, para no confundir datos simulados con reales.
 */

import type { IErpConnector, ConnectorInfo } from "../../../domain/connectors.ts";
import type { OperationContext } from "../../../domain/identifiers.ts";
import { IntegrationError } from "../../../domain/errors.ts";
import { getSecretsProvider } from "../../../infrastructure/secrets.ts";
import type {
  MobilinkCustomer,
  MobilinkProduct,
  MobilinkPrice,
  MobilinkStock,
  CreateSalesQuoteInput,
  SalesQuoteResult,
  CreateSalesOrderInput,
  SalesOrderResult,
  CreatePurchaseOrderInput,
  PurchaseOrderResult,
  QuoteLineResult,
} from "../../../domain/models.ts";

export interface BusinessCentralConfig {
  /** Base de la API, p. ej. https://api.businesscentral.dynamics.com/v2.0/{aadTenant}/{env}/api/v2.0 */
  baseUrl?: string;
  /** GUID de la company de BC. */
  companyId?: string;
  /** Tenant de Azure AD (para el endpoint de token). */
  aadTenantId?: string;
  /** Moneda por defecto si la línea/petición no la especifica. */
  defaultCurrency?: string;
}

interface ResolvedCredentials {
  clientId: string;
  clientSecret: string;
  aadTenantId: string;
}

export class BusinessCentralConnector implements IErpConnector {
  readonly info: ConnectorInfo = {
    key: "business-central",
    kind: "erp",
    displayName: "Microsoft Dynamics 365 Business Central",
    capabilities: [
      "getCustomers",
      "getCustomer",
      "getProducts",
      "getPrices",
      "getStock",
      "createSalesQuote",
      "createSalesOrder",
      "createPurchaseOrder",
      "createCustomer",
      "updateCustomer",
    ],
  };

  constructor(private readonly config: BusinessCentralConfig = {}) {}

  private get defaultCurrency(): string {
    return this.config.defaultCurrency || "EUR";
  }

  /** ¿Hay configuración suficiente para hablar con un BC real? */
  private isConfigured(): boolean {
    return Boolean(this.config.baseUrl && this.config.companyId && this.config.aadTenantId);
  }

  private async resolveCredentials(ctx: OperationContext): Promise<ResolvedCredentials | null> {
    const secrets = getSecretsProvider();
    const clientId = await secrets.get(ctx.tenantId, this.info.key, "client_id");
    const clientSecret = await secrets.get(ctx.tenantId, this.info.key, "client_secret");
    const aadTenantId = this.config.aadTenantId || (await secrets.get(ctx.tenantId, this.info.key, "aad_tenant_id"));
    if (!clientId || !clientSecret || !aadTenantId) return null;
    return { clientId, clientSecret, aadTenantId };
  }

  /** true cuando NO podemos operar contra BC real y usamos simulación. */
  private async useSimulation(ctx: OperationContext): Promise<boolean> {
    if (!this.isConfigured()) return true;
    const creds = await this.resolveCredentials(ctx);
    return creds === null;
  }

  // ── OAuth2 client credentials ──────────────────────────────────────────────
  private async getAccessToken(ctx: OperationContext): Promise<string> {
    const creds = await this.resolveCredentials(ctx);
    if (!creds) {
      throw IntegrationError.auth("BC_NO_CREDENTIALS", "Credenciales de Business Central no configuradas");
    }
    const tokenUrl = `https://login.microsoftonline.com/${creds.aadTenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      scope: "https://api.businesscentral.dynamics.com/.default",
    });
    let res: Response;
    try {
      res = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
    } catch (e) {
      throw IntegrationError.transient("BC_TOKEN_NETWORK", "No se pudo contactar con Azure AD", e);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw IntegrationError.auth("BC_TOKEN_FAILED", `Fallo obteniendo token de BC (${res.status})`, text);
    }
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) {
      throw IntegrationError.auth("BC_TOKEN_EMPTY", "Azure AD no devolvió access_token");
    }
    return json.access_token;
  }

  private async bcFetch<T>(ctx: OperationContext, pathAndQuery: string, init?: RequestInit): Promise<T> {
    const token = await this.getAccessToken(ctx);
    const url = `${this.config.baseUrl}/companies(${this.config.companyId})/${pathAndQuery}`;
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(init?.headers ?? {}),
        },
      });
    } catch (e) {
      throw IntegrationError.transient("BC_NETWORK", "Business Central no responde", e);
    }
    if (res.status >= 500) {
      throw IntegrationError.transient("BC_5XX", `Business Central error ${res.status}`);
    }
    if (res.status === 404) {
      throw IntegrationError.notFound("BC_NOT_FOUND", `Recurso no encontrado: ${pathAndQuery}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw IntegrationError.permanent("BC_ERROR", `Business Central error ${res.status}`, text);
    }
    return (await res.json()) as T;
  }

  // ── testConnection ──────────────────────────────────────────────────────────
  async testConnection(ctx: OperationContext): Promise<{ ok: boolean; message: string }> {
    if (await this.useSimulation(ctx)) {
      return { ok: true, message: "Modo simulación (Business Central no configurado)" };
    }
    try {
      await this.bcFetch(ctx, "companyInformation");
      return { ok: true, message: "Conexión con Business Central correcta" };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? "Fallo de conexión" };
    }
  }

  // ── Lecturas ────────────────────────────────────────────────────────────────
  async getCustomers(ctx: OperationContext): Promise<MobilinkCustomer[]> {
    if (await this.useSimulation(ctx)) return [];
    const data = await this.bcFetch<{ value: any[] }>(ctx, "customers");
    return data.value.map((c) => this.mapCustomer(c));
  }

  async getCustomer(ctx: OperationContext, externalCustomerId: string): Promise<MobilinkCustomer | null> {
    if (await this.useSimulation(ctx)) {
      return { externalId: externalCustomerId, name: `Cliente simulado ${externalCustomerId}` };
    }
    const q = `customers?$filter=number eq '${encodeURIComponent(externalCustomerId)}'`;
    const data = await this.bcFetch<{ value: any[] }>(ctx, q);
    const c = data.value[0];
    return c ? this.mapCustomer(c) : null;
  }

  async getProducts(ctx: OperationContext): Promise<MobilinkProduct[]> {
    if (await this.useSimulation(ctx)) return [];
    const data = await this.bcFetch<{ value: any[] }>(ctx, "items");
    return data.value.map((i) => this.mapProduct(i));
  }

  async getPrices(
    ctx: OperationContext,
    externalProductIds: string[],
    _externalCustomerId?: string
  ): Promise<MobilinkPrice[]> {
    if (await this.useSimulation(ctx)) {
      return externalProductIds.map((id) => ({
        externalProductId: id,
        unitPrice: this.simulatedUnitPrice(id),
        currency: this.defaultCurrency,
      }));
    }
    const out: MobilinkPrice[] = [];
    for (const id of externalProductIds) {
      const q = `items?$filter=number eq '${encodeURIComponent(id)}'&$select=number,unitPrice`;
      const data = await this.bcFetch<{ value: any[] }>(ctx, q);
      const item = data.value[0];
      if (item) {
        out.push({
          externalProductId: id,
          unitPrice: Number(item.unitPrice ?? 0),
          currency: this.defaultCurrency,
        });
      }
    }
    return out;
  }

  async getStock(ctx: OperationContext, externalProductIds: string[]): Promise<MobilinkStock[]> {
    if (await this.useSimulation(ctx)) {
      return externalProductIds.map((id) => ({ externalProductId: id, available: 0 }));
    }
    const out: MobilinkStock[] = [];
    for (const id of externalProductIds) {
      const q = `items?$filter=number eq '${encodeURIComponent(id)}'&$select=number,inventory`;
      const data = await this.bcFetch<{ value: any[] }>(ctx, q);
      const item = data.value[0];
      out.push({ externalProductId: id, available: Number(item?.inventory ?? 0) });
    }
    return out;
  }

  // ── Escritura: presupuesto de venta (núcleo de la primera entrega) ───────────
  async createSalesQuote(ctx: OperationContext, input: CreateSalesQuoteInput): Promise<SalesQuoteResult> {
    const currency = input.currency || this.defaultCurrency;

    if (await this.useSimulation(ctx)) {
      return this.simulateSalesQuote(ctx, input, currency);
    }

    // 1) Cabecera del presupuesto.
    const header = await this.bcFetch<any>(ctx, "salesQuotes", {
      method: "POST",
      body: JSON.stringify({
        customerNumber: input.externalCustomerId,
        currencyCode: currency === this.defaultCurrency ? undefined : currency,
        externalDocumentNumber: input.reference,
      }),
    });

    // 2) Líneas del presupuesto.
    const lineResults: QuoteLineResult[] = [];
    for (const line of input.lines) {
      const created = await this.bcFetch<any>(ctx, `salesQuotes(${header.id})/salesQuoteLines`, {
        method: "POST",
        body: JSON.stringify({
          lineType: "Item",
          lineObjectNumber: line.externalProductId,
          quantity: line.quantity,
          ...(line.unitPrice != null ? { unitPrice: line.unitPrice } : {}),
          ...(line.discountPercent != null ? { discountPercent: line.discountPercent } : {}),
        }),
      });
      lineResults.push({
        externalProductId: line.externalProductId,
        quantity: Number(created.quantity ?? line.quantity),
        unitPrice: Number(created.unitPrice ?? line.unitPrice ?? 0),
        discountPercent: created.discountPercent != null ? Number(created.discountPercent) : undefined,
        lineAmount: Number(created.amountIncludingTax ?? created.amount ?? 0),
        description: created.description ?? line.description,
      });
    }

    return {
      externalQuoteNumber: header.number,
      externalQuoteId: header.id,
      currency,
      totalAmount: lineResults.reduce((s, l) => s + l.lineAmount, 0),
      lines: lineResults,
    };
  }

  async createSalesOrder(ctx: OperationContext, input: CreateSalesOrderInput): Promise<SalesOrderResult> {
    const currency = input.currency || this.defaultCurrency;
    if (await this.useSimulation(ctx)) {
      const total = input.lines.reduce((s, l) => s + (l.unitPrice ?? this.simulatedUnitPrice(l.externalProductId)) * l.quantity, 0);
      return { externalOrderNumber: this.simulatedNumber("PED", ctx.correlationId), currency, totalAmount: round2(total) };
    }
    const header = await this.bcFetch<any>(ctx, "salesOrders", {
      method: "POST",
      body: JSON.stringify({ customerNumber: input.externalCustomerId, externalDocumentNumber: input.reference }),
    });
    for (const line of input.lines) {
      await this.bcFetch(ctx, `salesOrders(${header.id})/salesOrderLines`, {
        method: "POST",
        body: JSON.stringify({ lineType: "Item", lineObjectNumber: line.externalProductId, quantity: line.quantity }),
      });
    }
    return { externalOrderNumber: header.number, externalOrderId: header.id, currency, totalAmount: 0 };
  }

  async createPurchaseOrder(ctx: OperationContext, input: CreatePurchaseOrderInput): Promise<PurchaseOrderResult> {
    const currency = this.defaultCurrency;
    if (await this.useSimulation(ctx)) {
      const total = input.lines.reduce((s, l) => s + (l.unitPrice ?? this.simulatedUnitPrice(l.externalProductId)) * l.quantity, 0);
      return { externalOrderNumber: this.simulatedNumber("PC", ctx.correlationId), currency, totalAmount: round2(total) };
    }
    const header = await this.bcFetch<any>(ctx, "purchaseOrders", {
      method: "POST",
      body: JSON.stringify({ vendorNumber: input.externalVendorId, externalDocumentNumber: input.reference }),
    });
    for (const line of input.lines) {
      await this.bcFetch(ctx, `purchaseOrders(${header.id})/purchaseOrderLines`, {
        method: "POST",
        body: JSON.stringify({ lineType: "Item", lineObjectNumber: line.externalProductId, quantity: line.quantity }),
      });
    }
    return { externalOrderNumber: header.number, externalOrderId: header.id, currency, totalAmount: 0 };
  }

  async createCustomer(ctx: OperationContext, customer: MobilinkCustomer): Promise<MobilinkCustomer> {
    if (await this.useSimulation(ctx)) {
      return { ...customer, externalId: customer.externalId ?? this.simulatedNumber("CLI", ctx.correlationId) };
    }
    const created = await this.bcFetch<any>(ctx, "customers", {
      method: "POST",
      body: JSON.stringify({
        displayName: customer.name,
        email: customer.email,
        phoneNumber: customer.phone,
        taxRegistrationNumber: customer.taxId,
      }),
    });
    return this.mapCustomer(created);
  }

  async updateCustomer(ctx: OperationContext, customer: MobilinkCustomer): Promise<MobilinkCustomer> {
    if (await this.useSimulation(ctx)) return customer;
    if (!customer.externalId) {
      throw IntegrationError.validation("BC_UPDATE_NO_ID", "updateCustomer requiere externalId");
    }
    const q = `customers?$filter=number eq '${encodeURIComponent(customer.externalId)}'`;
    const found = await this.bcFetch<{ value: any[] }>(ctx, q);
    const bc = found.value[0];
    if (!bc) throw IntegrationError.notFound("BC_CUSTOMER_NOT_FOUND", `Cliente ${customer.externalId} no existe en BC`);
    const updated = await this.bcFetch<any>(ctx, `customers(${bc.id})`, {
      method: "PATCH",
      headers: { "If-Match": "*" },
      body: JSON.stringify({ displayName: customer.name, email: customer.email, phoneNumber: customer.phone }),
    });
    return this.mapCustomer(updated);
  }

  // ── Mapeos BC → Mobilink ─────────────────────────────────────────────────────
  private mapCustomer(c: any): MobilinkCustomer {
    return {
      externalId: c.number,
      name: c.displayName ?? c.name ?? "",
      taxId: c.taxRegistrationNumber,
      email: c.email,
      phone: c.phoneNumber,
      address: c.addressLine1,
      city: c.city,
      postalCode: c.postalCode,
      country: c.country,
    };
  }

  private mapProduct(i: any): MobilinkProduct {
    return {
      externalId: i.number,
      sku: i.number,
      name: i.displayName ?? i.name ?? "",
      unit: i.baseUnitOfMeasureCode,
      vatPercent: i.generalProductPostingGroupCode ? undefined : undefined,
    };
  }

  // ── Simulación determinista ──────────────────────────────────────────────────
  private simulateSalesQuote(
    ctx: OperationContext,
    input: CreateSalesQuoteInput,
    currency: string
  ): SalesQuoteResult {
    const lines: QuoteLineResult[] = input.lines.map((l) => {
      const unitPrice = l.unitPrice ?? this.simulatedUnitPrice(l.externalProductId);
      const discount = l.discountPercent ?? 0;
      const lineAmount = round2(unitPrice * l.quantity * (1 - discount / 100));
      return {
        externalProductId: l.externalProductId,
        quantity: l.quantity,
        unitPrice: round2(unitPrice),
        discountPercent: discount || undefined,
        lineAmount,
        description: l.description,
      };
    });
    return {
      externalQuoteNumber: this.simulatedNumber("PRES", ctx.correlationId),
      currency,
      totalAmount: round2(lines.reduce((s, l) => s + l.lineAmount, 0)),
      lines,
    };
  }

  /** Precio simulado estable a partir del código de artículo (no aleatorio → reproducible). */
  private simulatedUnitPrice(externalProductId: string): number {
    let h = 0;
    for (const ch of externalProductId) h = (h * 31 + ch.charCodeAt(0)) % 100000;
    return round2(20 + (h % 18000) / 100); // entre 20 y 200 €
  }

  /** Número de documento simulado, derivado del correlationId para ser estable por operación. */
  private simulatedNumber(prefix: string, correlationId: string): string {
    const digits = correlationId.replace(/\D/g, "").slice(-6).padStart(6, "0");
    return `${prefix}-${digits}`;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
