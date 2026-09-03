/**
 * Estados y tipos de una operación de integración (§2.9).
 *
 * El Hub NUNCA pierde una operación: toda petición se materializa como un registro
 * en `integration_operations` con una máquina de estados y reintentos.
 */

export type OperationStatus =
  | "RECEIVED"
  | "VALIDATING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "RETRY_PENDING"
  | "MANUAL_REVIEW"
  | "CANCELLED";

/** Estados terminales: no admiten más transiciones automáticas. */
export const TERMINAL_STATUSES: OperationStatus[] = [
  "COMPLETED",
  "CANCELLED",
  "MANUAL_REVIEW",
];

/** Transiciones permitidas de la máquina de estados. */
const ALLOWED_TRANSITIONS: Record<OperationStatus, OperationStatus[]> = {
  RECEIVED: ["VALIDATING", "PROCESSING", "FAILED", "CANCELLED"],
  VALIDATING: ["PROCESSING", "FAILED", "CANCELLED"],
  PROCESSING: ["COMPLETED", "FAILED", "RETRY_PENDING", "CANCELLED"],
  RETRY_PENDING: ["PROCESSING", "MANUAL_REVIEW", "CANCELLED"],
  FAILED: ["RETRY_PENDING", "MANUAL_REVIEW", "CANCELLED"],
  MANUAL_REVIEW: ["PROCESSING", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransition(from: OperationStatus, to: OperationStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminal(status: OperationStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Tipos de operación soportados por el Hub. Se irán ampliando por fases;
 * la primera entrega usa `ERP_CREATE_SALES_QUOTE`.
 */
export type OperationType =
  | "ERP_GET_CUSTOMERS"
  | "ERP_GET_PRODUCTS"
  | "ERP_GET_PRICES"
  | "ERP_GET_STOCK"
  | "ERP_CREATE_SALES_QUOTE"
  | "ERP_CREATE_SALES_ORDER"
  | "ERP_CREATE_PURCHASE_ORDER"
  | "ERP_SYNC_CATALOG"
  | "ERP_SYNC_SALES_ORDERS"
  | "ERP_RETURN_EXECUTION"
  /*
   * TyreControl. Las tres primeras son de lectura o comprobación y ya se usan;
   * las demás son el CONTRATO de las escrituras futuras, declarado desde ahora
   * para que el outbox, los reintentos y la auditoría no haya que ampliarlos
   * cuando llegue el momento. Ninguna está implementada todavía.
   */
  | "TC_AUTH_PROBE"
  | "TC_VEHICLE_RESOLVE"
  | "TC_VEHICLE_STATE"
  | "TC_WRITE_PROBE"
  | "TC_ASSISTANCE_RECORD"
  | "TC_TYRE_MOUNT"
  | "TC_TYRE_REMOVE"
  | "TC_TYRE_REPLACE"
  | "TC_TYRE_REPAIR"
  | "TC_TYRE_ROTATE"
  | "TECH_IDENTIFY_VEHICLE"
  | "TECH_GET_COMPATIBLE_PARTS"
  | "TECH_GET_OE_REFERENCES"
  | "SUPPLIER_SEARCH_PART"
  | "SUPPLIER_CREATE_PURCHASE_ORDER"
  | "CHECKLIST_PROCESS_NON_CONFORMITY"
  | "COMM_SEND_QUOTE"
  | "COMM_SEND_APPOINTMENT"
  | "COMM_SEND_WORK_ORDER_STATUS"
  | "COMM_REQUEST_APPROVAL"
  | "COMM_REQUEST_SIGNATURE"
  | "COMM_SEND_INVOICE";

/** Categorías de conector (mapean a los "Hubs" del §2.3). */
export type ConnectorKind = "erp" | "technical" | "supplier" | "communication" | "telematics";
