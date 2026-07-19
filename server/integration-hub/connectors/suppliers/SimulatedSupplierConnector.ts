/**
 * Base de conector de recambista con SIMULACIÓN determinista (Fase 3).
 *
 * Cuando no hay credenciales/config, devuelve ofertas y pedidos plausibles y estables
 * (derivados de la referencia, no aleatorios) para desarrollar y demostrar el Supplier Hub
 * sin un recambista real. Las subclases sobreescriben `useSimulation` y los ganchos `real*`.
 */

import type { ISupplierConnector, ConnectorInfo } from "../../domain/connectors.ts";
import type { OperationContext } from "../../domain/identifiers.ts";
import type { SupplierOffer } from "../../domain/models.ts";
import type {
  SupplierSearchQuery,
  CreateSupplierCartInput,
  SupplierCartResult,
  CreateSupplierOrderInput,
  SupplierOrderResult,
  SupplierOrderStatusResult,
} from "../../domain/supplier.ts";
import { IntegrationError } from "../../domain/errors.ts";

function hash(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export abstract class SimulatedSupplierConnector implements ISupplierConnector {
  abstract readonly info: ConnectorInfo;
  /** Id del proveedor (SUP-001...) que se refleja en las ofertas normalizadas. */
  protected abstract readonly supplierId: string;
  /** Días base de entrega para la simulación (cada recambista puede ajustarlo). */
  protected baseLeadDays = 1;

  protected async useSimulation(_ctx: OperationContext): Promise<boolean> {
    return true;
  }

  async testConnection(ctx: OperationContext): Promise<{ ok: boolean; message: string }> {
    if (await this.useSimulation(ctx)) {
      return { ok: true, message: `Modo simulación (${this.info.displayName} no configurado)` };
    }
    return { ok: true, message: `Conexión con ${this.info.displayName} correcta` };
  }

  async searchPart(ctx: OperationContext, query: SupplierSearchQuery): Promise<SupplierOffer[]> {
    if (await this.useSimulation(ctx)) return this.simSearch(query);
    return this.realSearch(ctx, query);
  }

  async getPrice(ctx: OperationContext, supplierPartNumber: string): Promise<SupplierOffer | null> {
    if (await this.useSimulation(ctx)) return this.simOffer(supplierPartNumber, undefined);
    return this.realGetPrice(ctx, supplierPartNumber);
  }

  async getAvailability(ctx: OperationContext, supplierPartNumber: string): Promise<SupplierOffer | null> {
    if (await this.useSimulation(ctx)) return this.simOffer(supplierPartNumber, undefined);
    return this.realGetAvailability(ctx, supplierPartNumber);
  }

  async getDeliveryTime(ctx: OperationContext, supplierPartNumber: string, quantity: number): Promise<string | undefined> {
    if (await this.useSimulation(ctx)) return this.simDelivery(supplierPartNumber, quantity);
    return this.realGetDeliveryTime(ctx, supplierPartNumber, quantity);
  }

  async createSupplierCart(ctx: OperationContext, input: CreateSupplierCartInput): Promise<SupplierCartResult> {
    if (await this.useSimulation(ctx)) return this.simCart(ctx, input);
    return this.realCreateCart(ctx, input);
  }

  async createPurchaseOrder(ctx: OperationContext, input: CreateSupplierOrderInput): Promise<SupplierOrderResult> {
    if (!input.lines?.length) {
      throw IntegrationError.validation("SUPPLIER_ORDER_EMPTY", "El pedido de compra requiere al menos una línea");
    }
    if (await this.useSimulation(ctx)) return this.simOrder(ctx, input);
    return this.realCreatePurchaseOrder(ctx, input);
  }

  async getOrderStatus(ctx: OperationContext, supplierOrderId: string): Promise<SupplierOrderStatusResult> {
    if (await this.useSimulation(ctx)) {
      return { supplierId: this.supplierId, supplierOrderId, status: "CONFIRMED", updatedAt: undefined };
    }
    return this.realGetOrderStatus(ctx, supplierOrderId);
  }

  async cancelOrder(ctx: OperationContext, supplierOrderId: string): Promise<SupplierOrderStatusResult> {
    if (await this.useSimulation(ctx)) {
      return { supplierId: this.supplierId, supplierOrderId, status: "CANCELLED" };
    }
    return this.realCancelOrder(ctx, supplierOrderId);
  }

  // ── Ganchos reales ─────────────────────────────────────────────────────────
  protected realSearch(_c: OperationContext, _q: SupplierSearchQuery): Promise<SupplierOffer[]> {
    throw new Error(`${this.info.key}: searchPart real no implementado`);
  }
  protected realGetPrice(_c: OperationContext, _p: string): Promise<SupplierOffer | null> {
    throw new Error(`${this.info.key}: getPrice real no implementado`);
  }
  protected realGetAvailability(_c: OperationContext, _p: string): Promise<SupplierOffer | null> {
    throw new Error(`${this.info.key}: getAvailability real no implementado`);
  }
  protected realGetDeliveryTime(_c: OperationContext, _p: string, _q: number): Promise<string | undefined> {
    throw new Error(`${this.info.key}: getDeliveryTime real no implementado`);
  }
  protected realCreateCart(_c: OperationContext, _i: CreateSupplierCartInput): Promise<SupplierCartResult> {
    throw new Error(`${this.info.key}: createSupplierCart real no implementado`);
  }
  protected realCreatePurchaseOrder(_c: OperationContext, _i: CreateSupplierOrderInput): Promise<SupplierOrderResult> {
    throw new Error(`${this.info.key}: createPurchaseOrder real no implementado`);
  }
  protected realGetOrderStatus(_c: OperationContext, _id: string): Promise<SupplierOrderStatusResult> {
    throw new Error(`${this.info.key}: getOrderStatus real no implementado`);
  }
  protected realCancelOrder(_c: OperationContext, _id: string): Promise<SupplierOrderStatusResult> {
    throw new Error(`${this.info.key}: cancelOrder real no implementado`);
  }

  // ── Simulación determinista ──────────────────────────────────────────────────
  /** Deriva una fecha ISO a partir de un desplazamiento en días desde el correlationId. */
  protected deliveryFromCorrelation(correlationId: string, extraDays: number): string {
    // El correlationId es COR-YYYYMMDD-NNNNNN → base = ese día.
    const m = /COR-(\d{4})(\d{2})(\d{2})/.exec(correlationId);
    const base = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(2026, 0, 1);
    base.setDate(base.getDate() + this.baseLeadDays + extraDays);
    base.setHours(10, 0, 0, 0);
    return base.toISOString();
  }

  private unitCost(ref: string): number {
    const h = hash(this.supplierId + ref);
    return round2(15 + (h % 20000) / 100); // 15–215 €
  }

  private buildOffer(ref: string, correlationId: string, oeReferences?: string[]): SupplierOffer {
    const h = hash(this.supplierId + ref);
    return {
      supplierId: this.supplierId,
      supplierPartNumber: ref,
      manufacturerReference: `${ref.split("-")[0] ?? "REF"}-${h % 90000}`,
      oeReferences: oeReferences ?? [String(34116859066n + BigInt(h % 1000))],
      unitCost: this.unitCost(ref),
      currency: "EUR",
      availableQuantity: h % 12, // 0–11 (a veces 0 = sin stock)
      estimatedDelivery: this.deliveryFromCorrelation(correlationId, h % 3),
      validUntil: this.deliveryFromCorrelation(correlationId, 0),
    };
  }

  private simSearch(query: SupplierSearchQuery): SupplierOffer[] {
    const key = query.oeReference || query.manufacturerReference || query.text;
    if (!key) return [];
    // Derivamos 1–2 referencias de proveedor a partir de la búsqueda.
    const h = hash(this.supplierId + key);
    const refs = [`${this.supplierId}-${h % 100000}`];
    if (h % 2 === 0) refs.push(`${this.supplierId}-${(h >> 4) % 100000}`);
    // Sin correlationId aquí (búsqueda pura); usamos uno neutro para las fechas.
    return refs.map((r) => this.buildOffer(r, "COR-20260101-000000", query.oeReference ? [query.oeReference] : undefined));
  }

  private simOffer(ref: string, oe?: string[]): SupplierOffer {
    return this.buildOffer(ref, "COR-20260101-000000", oe);
  }

  private simDelivery(ref: string, _quantity: number): string {
    const h = hash(this.supplierId + ref);
    return this.deliveryFromCorrelation("COR-20260101-000000", h % 4);
  }

  private simCart(ctx: OperationContext, input: CreateSupplierCartInput): SupplierCartResult {
    const total = input.lines.reduce((s, l) => s + (l.unitCost ?? this.unitCost(l.supplierPartNumber)) * l.quantity, 0);
    const h = hash(ctx.correlationId + this.supplierId);
    return {
      supplierId: this.supplierId,
      cartId: `CART-${this.supplierId}-${(h % 1000000).toString().padStart(6, "0")}`,
      currency: "EUR",
      totalCost: round2(total),
      validUntil: this.deliveryFromCorrelation(ctx.correlationId, 0),
    };
  }

  private simOrder(ctx: OperationContext, input: CreateSupplierOrderInput): SupplierOrderResult {
    const total = input.lines.reduce((s, l) => s + (l.unitCost ?? this.unitCost(l.supplierPartNumber)) * l.quantity, 0);
    const digits = ctx.correlationId.replace(/\D/g, "").slice(-6).padStart(6, "0");
    return {
      supplierId: this.supplierId,
      supplierOrderId: `SO-${this.supplierId}-${digits}`,
      status: "CONFIRMED",
      currency: "EUR",
      totalCost: round2(total),
      estimatedDelivery: this.deliveryFromCorrelation(ctx.correlationId, 1),
    };
  }
}
