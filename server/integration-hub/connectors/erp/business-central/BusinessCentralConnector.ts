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
  /** Timeout por petición en ms (por defecto 30 s). */
  timeoutMs?: number;
  /** Reintentos ante 429/5xx/red antes de rendirse y dejarlo en manos del worker. */
  maxRetries?: number;
  /** Tamaño de página pedido a BC (cabecera Prefer). */
  pageSize?: number;
}

interface ResolvedCredentials {
  clientId: string;
  clientSecret: string;
  aadTenantId: string;
}

/** Pedido de venta de BC con líneas, para la bandeja de WorkPlanner (API v2.0). */
export interface BcSalesOrder {
  id: string;
  number: string;
  customerNumber?: string;
  customerName?: string;
  shipToAddressLine1?: string;
  requestedDeliveryDate?: string;
  status?: string;
  lastModifiedDateTime?: string;
  externalDocumentNumber?: string;
  salesOrderLines?: BcSalesOrderLine[];
}

export interface BcSalesOrderLine {
  id: string;
  sequence?: number;
  lineType?: string;
  lineObjectNumber?: string;
  description?: string;
  quantity?: number;
  unitOfMeasureCode?: string;
  unitPrice?: number;
  discountPercent?: number;
  netAmount?: number;
}

/** Artículo de BC con los campos de control del catálogo (API estándar v2.0). */
export interface BcCatalogItem {
  id: string;
  number: string;
  displayName: string;
  type?: string;
  itemCategoryCode?: string;
  baseUnitOfMeasureCode?: string;
  unitPrice?: number;
  blocked?: boolean;
  lastModifiedDateTime?: string;
}

/**
 * Caché de tokens de aplicación, compartida por instancias del conector.
 *
 * Sin esto se pedía un token nuevo a Entra ID en CADA llamada: crear un presupuesto
 * de 20 líneas suponía 21 tokens, con el riesgo real de throttling en Entra ID.
 * La clave incluye el tenant de Mobilink porque cada uno puede tener credenciales
 * distintas para el mismo Business Central.
 */
const tokenCache = new Map<string, { token: string; expiresAtMs: number }>();

/** Margen de seguridad para no usar un token a punto de caducar. */
const TOKEN_SAFETY_MARGIN_MS = 60_000;

/** Vacía la caché de tokens (tests, o rotación de secreto en caliente). */
export function clearBusinessCentralTokenCache(): void {
  tokenCache.clear();
}

/** Espera pasiva entre reintentos. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Escapa un literal de cadena OData: la comilla simple se duplica.
 * `encodeURIComponent` NO vale aquí — un código de artículo con apóstrofo
 * (habitual en descripciones) rompía el $filter y devolvía un 400.
 */
function odataLiteral(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
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

  private get timeoutMs(): number {
    return this.config.timeoutMs ?? 30_000;
  }

  private get maxRetries(): number {
    return this.config.maxRetries ?? 3;
  }

  // ── OAuth2 client credentials ──────────────────────────────────────────────
  /** Token cacheado hasta poco antes de su caducidad real. */
  private async getAccessToken(ctx: OperationContext, forceRefresh = false): Promise<string> {
    const creds = await this.resolveCredentials(ctx);
    if (!creds) {
      throw IntegrationError.auth("BC_NO_CREDENTIALS", "Credenciales de Business Central no configuradas");
    }
    const cacheKey = `${ctx.tenantId}|${creds.aadTenantId}|${creds.clientId}`;
    if (!forceRefresh) {
      const hit = tokenCache.get(cacheKey);
      if (hit && hit.expiresAtMs > Date.now()) return hit.token;
    }
    const token = await this.requestNewToken(creds);
    tokenCache.set(cacheKey, token);
    return token.token;
  }

  private async requestNewToken(creds: ResolvedCredentials): Promise<{ token: string; expiresAtMs: number }> {
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
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) {
      throw IntegrationError.auth("BC_TOKEN_EMPTY", "Azure AD no devolvió access_token");
    }
    const ttlMs = Number(json.expires_in ?? 3600) * 1000;
    return {
      token: json.access_token,
      expiresAtMs: Date.now() + Math.max(ttlMs - TOKEN_SAFETY_MARGIN_MS, 0),
    };
  }

  /**
   * Petición a una URL absoluta de BC con token cacheado, timeout y reintentos.
   *
   * Reintenta ante 429 (respetando Retry-After), 5xx y fallos de red. Ante un 401
   * refresca el token una vez: puede ser simplemente que el token cacheado se haya
   * invalidado en el lado de Microsoft antes de su caducidad nominal.
   */
  private async bcRequest<T>(ctx: OperationContext, url: string, init?: RequestInit, describe = url): Promise<T> {
    let tokenRefreshed = false;

    for (let attempt = 0; ; attempt++) {
      const token = await this.getAccessToken(ctx, tokenRefreshed);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      let res: Response;
      try {
        res = await fetch(url, {
          ...init,
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            Prefer: `odata.maxpagesize=${this.config.pageSize ?? 100}`,
            ...(init?.headers ?? {}),
          },
        });
      } catch (e: any) {
        clearTimeout(timer);
        const abortado = e?.name === "AbortError";
        if (attempt < this.maxRetries) {
          await sleep(this.backoffMs(attempt));
          continue;
        }
        throw IntegrationError.transient(
          abortado ? "BC_TIMEOUT" : "BC_NETWORK",
          abortado
            ? `Business Central no respondió en ${this.timeoutMs} ms`
            : "Business Central no responde",
          e
        );
      } finally {
        clearTimeout(timer);
      }

      // 401: reintenta una sola vez con token nuevo antes de darlo por malo.
      if (res.status === 401 && !tokenRefreshed) {
        tokenRefreshed = true;
        continue;
      }

      if (res.status === 429 || res.status >= 500) {
        if (attempt < this.maxRetries) {
          const retryAfter = Number(res.headers.get("retry-after"));
          await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : this.backoffMs(attempt));
          continue;
        }
        throw IntegrationError.transient(
          res.status === 429 ? "BC_RATE_LIMITED" : "BC_5XX",
          res.status === 429
            ? "Business Central está limitando las peticiones (429)"
            : `Business Central error ${res.status}`
        );
      }

      if (res.status === 401 || res.status === 403) {
        const text = await res.text().catch(() => "");
        throw IntegrationError.auth(
          "BC_FORBIDDEN",
          "Business Central rechaza las credenciales: revisa que la aplicación esté dada de alta y habilitada en BC con su conjunto de permisos",
          text
        );
      }
      if (res.status === 404) {
        throw IntegrationError.notFound("BC_NOT_FOUND", `Recurso no encontrado: ${describe}`);
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw IntegrationError.permanent("BC_ERROR", `Business Central error ${res.status}`, text);
      }
      return (await res.json()) as T;
    }
  }

  /** Backoff exponencial con tope, para no castigar a un BC que ya va justo. */
  private backoffMs(attempt: number): number {
    return Math.min(1000 * 2 ** attempt, 8000);
  }

  private companyUrl(pathAndQuery: string): string {
    return `${this.config.baseUrl}/companies(${this.config.companyId})/${pathAndQuery}`;
  }

  private async bcFetch<T>(ctx: OperationContext, pathAndQuery: string, init?: RequestInit): Promise<T> {
    return this.bcRequest<T>(ctx, this.companyUrl(pathAndQuery), init, pathAndQuery);
  }

  /**
   * Lectura de una colección siguiendo la paginación de OData.
   *
   * Sin esto sólo se veía la primera página: un cliente con 500 artículos
   * devolvía los primeros y el resto simplemente no existía para Mobilink.
   */
  private async bcList<T>(ctx: OperationContext, pathAndQuery: string): Promise<T[]> {
    const out: T[] = [];
    let url: string | undefined = this.companyUrl(pathAndQuery);
    // Tope de seguridad: evita un bucle infinito si BC devolviera un nextLink cíclico.
    for (let page = 0; url && page < 100; page++) {
      const data: { value?: T[]; "@odata.nextLink"?: string } = await this.bcRequest(ctx, url, undefined, pathAndQuery);
      out.push(...(data.value ?? []));
      url = data["@odata.nextLink"];
    }
    return out;
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
    const rows = await this.bcList<any>(ctx, "customers");
    return rows.map((c) => this.mapCustomer(c));
  }

  async getCustomer(ctx: OperationContext, externalCustomerId: string): Promise<MobilinkCustomer | null> {
    if (await this.useSimulation(ctx)) {
      return { externalId: externalCustomerId, name: `Cliente simulado ${externalCustomerId}` };
    }
    const q = `customers?$filter=number eq ${odataLiteral(externalCustomerId)}`;
    const data = await this.bcFetch<{ value: any[] }>(ctx, q);
    const c = data.value[0];
    return c ? this.mapCustomer(c) : null;
  }

  async getProducts(ctx: OperationContext): Promise<MobilinkProduct[]> {
    if (await this.useSimulation(ctx)) return [];
    const rows = await this.bcList<any>(ctx, "items");
    return rows.map((i) => this.mapProduct(i));
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
    const items = await this.fetchItemsByNumber(ctx, externalProductIds, "number,unitPrice");
    const out: MobilinkPrice[] = [];
    for (const id of externalProductIds) {
      const item = items.get(id);
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

  /**
   * Lee varios artículos por su número en pocas peticiones.
   *
   * Antes se hacía una llamada por artículo: un presupuesto de 20 líneas eran
   * 20 viajes a BC. Se agrupan en lotes con `or` porque la API v2.0 no admite `in`.
   */
  private async fetchItemsByNumber(
    ctx: OperationContext,
    externalProductIds: string[],
    select: string
  ): Promise<Map<string, any>> {
    const found = new Map<string, any>();
    const unicos = [...new Set(externalProductIds)];
    const LOTE = 15; // suficientemente corto para no pasarse de longitud de URL

    for (let i = 0; i < unicos.length; i += LOTE) {
      const lote = unicos.slice(i, i + LOTE);
      const filtro = lote.map((id) => `number eq ${odataLiteral(id)}`).join(" or ");
      const rows = await this.bcList<any>(
        ctx,
        `items?$filter=${encodeURIComponent(filtro)}&$select=${encodeURIComponent(select)}`
      );
      for (const row of rows) found.set(row.number, row);
    }
    return found;
  }

  async getStock(ctx: OperationContext, externalProductIds: string[]): Promise<MobilinkStock[]> {
    if (await this.useSimulation(ctx)) {
      return externalProductIds.map((id) => ({ externalProductId: id, available: 0 }));
    }
    const items = await this.fetchItemsByNumber(ctx, externalProductIds, "number,inventory");
    return externalProductIds.map((id) => ({
      externalProductId: id,
      available: Number(items.get(id)?.inventory ?? 0),
    }));
  }

  // ── Catálogo controlado (SPEC WorkPlanner §4) ───────────────────────────────
  /**
   * Lectura de artículos para el catálogo de WorkPlanner, con los campos de control
   * que getProducts no expone (blocked, categoría, lastModifiedDateTime).
   *
   * `modifiedSince` habilita el incremental. Con la API estándar v2.0 no existe el
   * campo 'Available In WorkPlanner' (llega con la extensión AL, It.4): hasta
   * entonces el filtro es blocked + categorías permitidas, aplicado por el servicio.
   */
  async getCatalogItems(
    ctx: OperationContext,
    opts: { modifiedSince?: Date } = {}
  ): Promise<BcCatalogItem[]> {
    if (await this.useSimulation(ctx)) {
      // Conjunto determinista para poder rodar el circuito completo sin BC real.
      return [
        { id: "sim-1", number: "SIM-PASTILLAS", displayName: "Pastillas de freno (simulado)", type: "Inventory", itemCategoryCode: "FRENOS", baseUnitOfMeasureCode: "UDS", unitPrice: 82.5, blocked: false, lastModifiedDateTime: "2026-01-01T00:00:00Z" },
        { id: "sim-2", number: "SIM-MO", displayName: "Mano de obra (simulado)", type: "Service", itemCategoryCode: "SERVICIOS", baseUnitOfMeasureCode: "HORA", unitPrice: 45, blocked: false, lastModifiedDateTime: "2026-01-01T00:00:00Z" },
        { id: "sim-3", number: "SIM-BLOQUEADO", displayName: "Artículo bloqueado (simulado)", type: "Inventory", itemCategoryCode: "FRENOS", baseUnitOfMeasureCode: "UDS", unitPrice: 10, blocked: true, lastModifiedDateTime: "2026-01-01T00:00:00Z" },
      ];
    }

    const select =
      "$select=id,number,displayName,type,itemCategoryCode,baseUnitOfMeasureCode,unitPrice,blocked,lastModifiedDateTime";
    const filter = opts.modifiedSince
      ? `&$filter=lastModifiedDateTime gt ${opts.modifiedSince.toISOString()}`
      : "";
    return this.bcList<BcCatalogItem>(ctx, `items?${select}${filter}`);
  }

  // ── Pedidos de venta hacia WorkPlanner (SPEC §2) ────────────────────────────
  /**
   * Lectura de pedidos de venta con sus líneas ($expand) para la bandeja de
   * WorkPlanner. `modifiedSince` habilita el incremental.
   *
   * Con la API estándar no existe el campo 'Send to WorkPlanner' (extensión AL,
   * It.4): hasta entonces bajan todos los pedidos no facturados y es WorkPlanner
   * quien decide cuáles planificar.
   */
  async getSalesOrdersForSync(
    ctx: OperationContext,
    opts: { modifiedSince?: Date } = {}
  ): Promise<BcSalesOrder[]> {
    if (await this.useSimulation(ctx)) {
      return [
        {
          id: "sim-order-1",
          number: "PV-SIM-001",
          customerNumber: "10000",
          customerName: "Cliente simulado SL",
          shipToAddressLine1: "Polígono simulado, nave 1",
          requestedDeliveryDate: "2026-08-15",
          status: "Open",
          lastModifiedDateTime: "2026-01-01T00:00:00Z",
          externalDocumentNumber: "",
          salesOrderLines: [
            { id: "sim-line-1", sequence: 10000, lineType: "Item", lineObjectNumber: "SIM-PASTILLAS", description: "Pastillas de freno (simulado)", quantity: 2, unitOfMeasureCode: "UDS", unitPrice: 82.5, discountPercent: 0, netAmount: 165 },
            { id: "sim-line-2", sequence: 20000, lineType: "Item", lineObjectNumber: "SIM-MO", description: "Mano de obra (simulado)", quantity: 1.5, unitOfMeasureCode: "HORA", unitPrice: 45, discountPercent: 0, netAmount: 67.5 },
          ],
        },
      ];
    }

    const select =
      "$select=id,number,customerNumber,customerName,shipToAddressLine1,requestedDeliveryDate,status,lastModifiedDateTime,externalDocumentNumber";
    const expand = "$expand=salesOrderLines";
    const filter = opts.modifiedSince
      ? `&$filter=lastModifiedDateTime gt ${opts.modifiedSince.toISOString()}`
      : "";
    return this.bcList<BcSalesOrder>(ctx, `salesOrders?${select}&${expand}${filter}`);
  }

  // ── Devolución de ejecución al pedido (SPEC §3, It.3) ───────────────────────
  /** Estado actual del pedido en BC (para el caso 9: ¿aún admite cambios?). */
  async getSalesOrderStatus(ctx: OperationContext, bcOrderId: string): Promise<string | null> {
    if (await this.useSimulation(ctx)) return "Open";
    try {
      const data = await this.bcRequest<{ status?: string }>(
        ctx,
        `${this.config.baseUrl}/salesOrders(${bcOrderId})?$select=status`,
        undefined,
        `salesOrders(${bcOrderId})`
      );
      return data.status ?? null;
    } catch (e) {
      if (e instanceof IntegrationError && e.kind === "NOT_FOUND") return null;
      throw e;
    }
  }

  /**
   * Actualiza la cantidad de una línea existente (consumo distinto del previsto).
   * Se lee primero la línea para usar su etag real: no pisar cambios de BC.
   */
  async updateSalesOrderLineQuantity(
    ctx: OperationContext,
    bcOrderId: string,
    bcLineId: string,
    quantity: number
  ): Promise<void> {
    if (await this.useSimulation(ctx)) return;
    const lineUrl = `${this.config.baseUrl}/salesOrders(${bcOrderId})/salesOrderLines(${bcLineId})`;
    const line = await this.bcRequest<any>(ctx, lineUrl, undefined, "salesOrderLine");
    await this.bcRequest(ctx, lineUrl, {
      method: "PATCH",
      headers: { "If-Match": line["@odata.etag"] || "*" },
      body: JSON.stringify({ quantity }),
    });
  }

  /**
   * Añade una línea al pedido (producto/servicio consumido en campo, casos 3-4).
   * Sin precio: BC aplica tarifa, descuentos e IVA del cliente (decisión §6).
   */
  async createSalesOrderLine(
    ctx: OperationContext,
    bcOrderId: string,
    line: { lineType: string; itemNumber: string; quantity: number; description?: string }
  ): Promise<{ bcLineId: string; bcLineNo?: number }> {
    if (await this.useSimulation(ctx)) {
      return { bcLineId: `sim-added-${line.itemNumber}`, bcLineNo: 90000 };
    }
    const created = await this.bcRequest<any>(
      ctx,
      `${this.config.baseUrl}/salesOrders(${bcOrderId})/salesOrderLines`,
      {
        method: "POST",
        body: JSON.stringify({
          lineType: line.lineType,
          lineObjectNumber: line.itemNumber,
          quantity: line.quantity,
          // La descripción de BC se respeta salvo que el parte aporte algo más útil.
          ...(line.description ? { description: line.description.slice(0, 100) } : {}),
        }),
      },
      "salesOrderLines"
    );
    return { bcLineId: created.id, bcLineNo: created.sequence };
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
    const q = `customers?$filter=number eq ${odataLiteral(customer.externalId)}`;
    const found = await this.bcFetch<{ value: any[] }>(ctx, q);
    const bc = found.value[0];
    if (!bc) throw IntegrationError.notFound("BC_CUSTOMER_NOT_FOUND", `Cliente ${customer.externalId} no existe en BC`);
    // Concurrencia optimista: con el etag leído, si alguien ha tocado el cliente en BC
    // entre la lectura y la escritura, BC rechaza el PATCH en vez de pisar su cambio.
    const etag = bc["@odata.etag"];
    const updated = await this.bcFetch<any>(ctx, `customers(${bc.id})`, {
      method: "PATCH",
      headers: { "If-Match": etag || "*" },
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
