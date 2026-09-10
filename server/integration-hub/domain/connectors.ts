/**
 * Contratos comunes de conectores (§2.3).
 *
 * Esta es la pieza central del Hub: los módulos operativos de Mobilink dependen
 * SOLO de estas interfaces, nunca de una implementación concreta. Cambiar de ERP o
 * de proveedor = escribir un nuevo conector que cumpla el contrato, sin tocar las apps.
 */

import type {
  MobilinkAssistancePush,
  MobilinkBillingPush,
  MobilinkCustomer,
  MobilinkProvider,
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
import type {
  SupplierSearchQuery,
  CreateSupplierCartInput,
  SupplierCartResult,
  CreateSupplierOrderInput,
  SupplierOrderResult,
  SupplierOrderStatusResult,
} from "./supplier.ts";
import type { CommMessage, CommSendResult } from "./communication.ts";
import type {
  ProviderVehicle,
  TelemetryWindow,
  VehicleTelemetry,
} from "./telematics.ts";
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

  /**
   * Proveedores (acreedores). Opcionales a propósito: no todo ERP los expone,
   * y obligar a implementarlos rompería los conectores que ya funcionan. Quien
   * llame debe comprobar que el método existe antes de usarlo.
   */
  getProviders?(ctx: OperationContext): Promise<MobilinkProvider[]>;
  getProvider?(ctx: OperationContext, externalProviderId: string): Promise<MobilinkProvider | null>;
  createProvider?(ctx: OperationContext, provider: MobilinkProvider): Promise<MobilinkProvider>;
  updateProvider?(ctx: OperationContext, provider: MobilinkProvider): Promise<MobilinkProvider>;

  /** Empuja la asistencia y su economía al ERP. También opcionales. */
  pushAssistance?(ctx: OperationContext, input: MobilinkAssistancePush): Promise<{ externalId?: string }>;
  pushBillingData?(ctx: OperationContext, input: MobilinkBillingPush): Promise<{ externalId?: string }>;
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

/**
 * Contrato del Supplier Hub (recambistas/distribuidores). Refleja las funciones del §2.3.
 * Toda respuesta se normaliza (SupplierOffer / SupplierOrderResult...).
 */
export interface ISupplierConnector extends Connector {
  searchPart(ctx: OperationContext, query: SupplierSearchQuery): Promise<SupplierOffer[]>;
  getPrice(ctx: OperationContext, supplierPartNumber: string): Promise<SupplierOffer | null>;
  getAvailability(ctx: OperationContext, supplierPartNumber: string): Promise<SupplierOffer | null>;
  getDeliveryTime(ctx: OperationContext, supplierPartNumber: string, quantity: number): Promise<string | undefined>;
  createSupplierCart(ctx: OperationContext, input: CreateSupplierCartInput): Promise<SupplierCartResult>;
  createPurchaseOrder(ctx: OperationContext, input: CreateSupplierOrderInput): Promise<SupplierOrderResult>;
  getOrderStatus(ctx: OperationContext, supplierOrderId: string): Promise<SupplierOrderStatusResult>;
  cancelOrder(ctx: OperationContext, supplierOrderId: string): Promise<SupplierOrderStatusResult>;
}

/**
 * Contrato del Communication Hub (§2.3). Las 6 funciones comparten el mensaje
 * normalizado CommMessage; cada conector renderiza su plantilla y envía por su canal.
 */
export interface ICommunicationConnector extends Connector {
  sendQuote(ctx: OperationContext, msg: CommMessage): Promise<CommSendResult>;
  sendAppointment(ctx: OperationContext, msg: CommMessage): Promise<CommSendResult>;
  sendWorkOrderStatus(ctx: OperationContext, msg: CommMessage): Promise<CommSendResult>;
  requestApproval(ctx: OperationContext, msg: CommMessage): Promise<CommSendResult>;
  requestSignature(ctx: OperationContext, msg: CommMessage): Promise<CommSendResult>;
  sendInvoiceNotification(ctx: OperationContext, msg: CommMessage): Promise<CommSendResult>;
}

/**
 * Contrato del Telematics Hub (Movertis, Webfleet, Geotab, Samsara, OEM…).
 *
 * El objetivo de este hub es que TyreControl pueda decir «este neumático se
 * montó a 512.480 km y se desmontó a 578.864 km» con una fuente verificable,
 * sin que ninguna parte de la aplicación sepa de qué proveedor viene el dato.
 *
 * ── Tres reglas que el contrato da por supuestas ────────────────────────────
 *
 * 1. **Ninguna implementación pide credenciales.** El `tenantId` viaja en el
 *    `OperationContext` y el conector resuelve su secreto por el
 *    `SecretsProvider`. Un conector que reciba un token por parámetro acabaría
 *    con ese token pasando por capas que no deberían verlo.
 *
 * 2. **Devolver menos es válido; inventar no.** Si el proveedor no da odómetro,
 *    la lectura sale sin odómetro y se declara en `capabilities`. Nunca un
 *    cero de relleno: en esta flota el cero de combustible ya significó
 *    «no hay CAN», y confundir eso con «depósito vacío» es un error caro.
 *
 * 3. **`getTelemetryAt` no interpola.** Devuelve una lectura que existió, o
 *    null. Fabricar un valor intermedio produce un número que no está en
 *    ninguna fuente, que es lo contrario de lo que se busca. Quien quiera
 *    interpolar que lo haga arriba y lo marque como tal.
 */
export interface ITelematicsConnector extends Connector {
  /** Vehículos de la cuenta, para poder enlazarlos con los de TyreControl. */
  listVehicles(ctx: OperationContext): Promise<ProviderVehicle[]>;

  /** Última lectura conocida. `null` si el proveedor no sabe nada del vehículo. */
  getCurrentTelemetry(
    ctx: OperationContext,
    providerVehicleId: string,
  ): Promise<VehicleTelemetry | null>;

  /**
   * Lecturas dentro de una ventana, en orden cronológico.
   *
   * Devolver un array vacío es una respuesta legítima y frecuente: un camión
   * parado en el taller puede no emitir nada durante horas, y ese es
   * precisamente el momento en que se cambian los neumáticos.
   */
  getTelemetryHistory(
    ctx: OperationContext,
    providerVehicleId: string,
    window: TelemetryWindow,
  ): Promise<VehicleTelemetry[]>;

  /**
   * La lectura más cercana a un instante, dentro de `toleranceMinutes`.
   *
   * Es la operación que sostiene la trazabilidad del neumático: se le da el
   * momento de la operación y devuelve con qué kilometraje se hizo. Quien
   * llama decide la tolerancia —la escalera ±5, ±15, ±30, ±60— y guarda,
   * junto al valor, la distancia temporal que hubo. Un kilometraje con
   * «Δ 47 min» merece menos confianza que uno con «Δ 12 s», y esa diferencia
   * tiene que quedar registrada, no perderse.
   *
   * `null` cuando no hay ninguna lectura dentro de la ventana.
   */
  getTelemetryAt(
    ctx: OperationContext,
    providerVehicleId: string,
    at: Date,
    toleranceMinutes: number,
  ): Promise<VehicleTelemetry | null>;
}
