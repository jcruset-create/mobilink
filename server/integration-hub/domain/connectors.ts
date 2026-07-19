/**
 * Contratos comunes de conectores (§2.3).
 *
 * Esta es la pieza central del Hub: los módulos operativos de Mobilink dependen
 * SOLO de estas interfaces, nunca de una implementación concreta. Cambiar de ERP o
 * de proveedor = escribir un nuevo conector que cumpla el contrato, sin tocar las apps.
 */

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
  SupplierOffer,
} from "./models.ts";
import type {
  VehicleQuery,
  VehicleIdentification,
  TechnicalSpecifications,
  CompatiblePart,
  RepairTime,
  MaintenancePlan,
  TyreSpecification,
} from "./technical.ts";
import type { OperationContext } from "./identifiers.ts";
import type { ConnectorKind } from "./operation.ts";

/** Metadatos que todo conector expone para el Connector Registry y el panel. */
export interface ConnectorInfo {
  /** Id estable del conector, p. ej. "business-central". */
  key: string;
  kind: ConnectorKind;
  displayName: string;
  /** Fases/funciones que implementa realmente esta versión. */
  capabilities: string[];
}

/** Todo conector puede auto-comprobarse (botón "Probar conexión" del panel §2.11). */
export interface Connector {
  readonly info: ConnectorInfo;
  /** Comprueba credenciales/conectividad sin efectos secundarios. */
  testConnection(ctx: OperationContext): Promise<{ ok: boolean; message: string }>;
}

/**
 * Contrato del ERP Hub. Primera implementación: BusinessCentralConnector.
 * Refleja las funciones del §2.3 (IErpConnector).
 */
export interface IErpConnector extends Connector {
  getCustomers(ctx: OperationContext): Promise<MobilinkCustomer[]>;
  getCustomer(ctx: OperationContext, externalCustomerId: string): Promise<MobilinkCustomer | null>;
  getProducts(ctx: OperationContext): Promise<MobilinkProduct[]>;
  getPrices(ctx: OperationContext, externalProductIds: string[], externalCustomerId?: string): Promise<MobilinkPrice[]>;
  getStock(ctx: OperationContext, externalProductIds: string[]): Promise<MobilinkStock[]>;

  createSalesQuote(ctx: OperationContext, input: CreateSalesQuoteInput): Promise<SalesQuoteResult>;
  createSalesOrder(ctx: OperationContext, input: CreateSalesOrderInput): Promise<SalesOrderResult>;
  createPurchaseOrder(ctx: OperationContext, input: CreatePurchaseOrderInput): Promise<PurchaseOrderResult>;

  createCustomer(ctx: OperationContext, customer: MobilinkCustomer): Promise<MobilinkCustomer>;
  updateCustomer(ctx: OperationContext, customer: MobilinkCustomer): Promise<MobilinkCustomer>;
}

/**
 * Contrato del Technical Data Hub (Autodata, TecDoc, catálogos, VIN, matrícula).
 * Refleja las funciones del §2.3.
 */
export interface ITechnicalConnector extends Connector {
  identifyVehicle(ctx: OperationContext, query: VehicleQuery): Promise<VehicleIdentification[]>;
  getTechnicalSpecifications(ctx: OperationContext, vehicleRef: string): Promise<TechnicalSpecifications>;
  getCompatibleParts(ctx: OperationContext, vehicleRef: string, category?: string): Promise<CompatiblePart[]>;
  getOeReferences(ctx: OperationContext, partRef: string): Promise<string[]>;
  getRepairTimes(ctx: OperationContext, vehicleRef: string, operationCode?: string): Promise<RepairTime[]>;
  getMaintenancePlan(ctx: OperationContext, vehicleRef: string): Promise<MaintenancePlan>;
  getTyreSpecifications(ctx: OperationContext, vehicleRef: string): Promise<TyreSpecification[]>;
}

/** Contrato del Supplier Hub (recambistas). Se implementará en Fase 3. */
export interface ISupplierConnector extends Connector {
  searchPart(ctx: OperationContext, query: { oeReference?: string; text?: string }): Promise<SupplierOffer[]>;
  getPrice(ctx: OperationContext, supplierPartNumber: string): Promise<SupplierOffer | null>;
  createPurchaseOrder(ctx: OperationContext, input: CreatePurchaseOrderInput): Promise<PurchaseOrderResult>;
}
