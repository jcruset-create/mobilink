/**
 * Modelo NORMALIZADO del Supplier Hub (recambistas/distribuidores, §2.3 / Fase 3).
 *
 * La oferta normalizada (`SupplierOffer`) vive en models.ts porque también la usa el ERP.
 * Aquí van los tipos propios de la interacción con proveedores: consulta, carrito, pedido y estado.
 */

import type { Currency } from "./models.ts";

/** Consulta de pieza a proveedores (por OE, referencia de fabricante o texto libre). */
export interface SupplierSearchQuery {
  oeReference?: string;
  manufacturerReference?: string;
  text?: string;
  /** Cantidad deseada, para calcular disponibilidad/entrega. */
  quantity?: number;
}

/** Línea de un carrito/pedido a proveedor. */
export interface SupplierOrderLine {
  supplierPartNumber: string;
  quantity: number;
  /** Coste unitario acordado (normalmente el de la oferta). */
  unitCost?: number;
}

/** Petición de carrito (reserva blanda antes de confirmar pedido). */
export interface CreateSupplierCartInput {
  lines: SupplierOrderLine[];
  reference?: string;
}

export interface SupplierCartResult {
  supplierId: string;
  cartId: string;
  currency: Currency;
  totalCost: number;
  validUntil?: string;
}

/** Petición de pedido de compra a proveedor. */
export interface CreateSupplierOrderInput {
  lines: SupplierOrderLine[];
  reference?: string;
  /** Si viene de un carrito previo. */
  cartId?: string;
}

export type SupplierOrderStatus =
  | "PENDING"
  | "CONFIRMED"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED"
  | "REJECTED";

export interface SupplierOrderResult {
  supplierId: string;
  supplierOrderId: string;
  status: SupplierOrderStatus;
  currency: Currency;
  totalCost: number;
  estimatedDelivery?: string;
}

export interface SupplierOrderStatusResult {
  supplierId: string;
  supplierOrderId: string;
  status: SupplierOrderStatus;
  trackingUrl?: string;
  updatedAt?: string;
}
