/**
 * Modelo de datos NORMALIZADO de Mobilink.
 *
 * Todos los conectores traducen las estructuras del sistema externo (Business Central,
 * SAP, un recambista, TecDoc...) a estos tipos. Los módulos operativos de Mobilink SOLO
 * conocen estos tipos, nunca los del sistema externo (ver principio fundamental §2.2).
 */

export type Currency = "EUR" | "USD" | "GBP" | string;

/** Cliente normalizado. */
export interface MobilinkCustomer {
  /** Id del cliente en Mobilink (si ya existe mapeado). */
  customerId?: string;
  /** Id del cliente en el sistema externo (p. ej. nº de cliente de Business Central). */
  externalId?: string;
  name: string;
  taxId?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  country?: string;
}

/** Artículo/producto normalizado. */
export interface MobilinkProduct {
  productId?: string;
  externalId?: string;
  sku?: string;
  name: string;
  unit?: string;
  vatPercent?: number;
  oeReferences?: string[];
}

/** Precio normalizado para un artículo (opcionalmente para un cliente concreto). */
export interface MobilinkPrice {
  externalProductId: string;
  customerId?: string;
  unitPrice: number;
  currency: Currency;
  discountPercent?: number;
  validFrom?: string;
  validUntil?: string;
}

/** Stock/disponibilidad normalizada de un artículo en un almacén. */
export interface MobilinkStock {
  externalProductId: string;
  warehouse?: string;
  available: number;
  reserved?: number;
  onOrder?: number;
}

/** Línea de un presupuesto/pedido tal y como entra desde una OT de Mobilink. */
export interface QuoteLineInput {
  /** Referencia del artículo/mano de obra en el sistema externo o mapeada. */
  externalProductId: string;
  quantity: number;
  /** Precio unitario forzado (si no, lo resuelve el conector desde tarifas). */
  unitPrice?: number;
  discountPercent?: number;
  description?: string;
}

/** Línea ya resuelta y devuelta por el conector tras crear el documento. */
export interface QuoteLineResult {
  externalProductId: string;
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
  lineAmount: number;
  description?: string;
}

/** Petición de creación de presupuesto de venta. */
export interface CreateSalesQuoteInput {
  /** Id de cliente en el sistema externo. */
  externalCustomerId: string;
  currency?: Currency;
  reference?: string;
  lines: QuoteLineInput[];
}

/** Resultado normalizado de un presupuesto de venta creado en el ERP. */
export interface SalesQuoteResult {
  /** Nº/id del presupuesto en el sistema externo (p. ej. "PRES-001258"). */
  externalQuoteNumber: string;
  externalQuoteId?: string;
  currency: Currency;
  totalAmount: number;
  lines: QuoteLineResult[];
}

/** Petición de creación de pedido de venta (a partir de un presupuesto aceptado). */
export interface CreateSalesOrderInput {
  externalCustomerId: string;
  externalQuoteId?: string;
  currency?: Currency;
  reference?: string;
  lines: QuoteLineInput[];
}

export interface SalesOrderResult {
  externalOrderNumber: string;
  externalOrderId?: string;
  currency: Currency;
  totalAmount: number;
}

/** Petición de creación de pedido de compra a proveedor vía ERP. */
export interface CreatePurchaseOrderInput {
  externalVendorId: string;
  reference?: string;
  lines: QuoteLineInput[];
}

export interface PurchaseOrderResult {
  externalOrderNumber: string;
  externalOrderId?: string;
  currency: Currency;
  totalAmount: number;
}

/**
 * Oferta normalizada de un proveedor/recambista (Supplier Hub §2.3).
 * Es el contrato de salida obligatorio para cualquier SupplierConnector.
 */
export interface SupplierOffer {
  supplierId: string;
  supplierPartNumber: string;
  manufacturerReference?: string;
  oeReferences?: string[];
  unitCost: number;
  currency: Currency;
  availableQuantity: number;
  estimatedDelivery?: string;
  validUntil?: string;
}
