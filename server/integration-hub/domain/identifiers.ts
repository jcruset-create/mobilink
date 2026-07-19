/**
 * Identificadores comunes del Mobilink Integration Hub.
 *
 * Toda operación que atraviesa el Hub comparte estos identificadores para poder
 * correlacionar el flujo completo de principio a fin (ver PROMPT_MOBILINK_INTEGRATION_HUB.md §2.6).
 *
 * El `CorrelationId` es la pieza clave: un único valor que sigue una operación desde
 * la app de Mobilink hasta el sistema externo y su respuesta.
 */

export type TenantId = string;
export type CustomerId = string;
export type VehicleId = string;
export type WorkOrderId = string;
export type ChecklistId = string;
export type IncidentId = string;
export type QuoteId = string;
export type MovementId = string;
export type IntegrationOperationId = string;
export type CorrelationId = string;

/** Contexto de identificadores que viaja con cada operación del Hub. */
export interface OperationContext {
  tenantId: TenantId;
  correlationId: CorrelationId;
  customerId?: CustomerId;
  vehicleId?: VehicleId;
  workOrderId?: WorkOrderId;
  checklistId?: ChecklistId;
  incidentId?: IncidentId;
  quoteId?: QuoteId;
}

/**
 * Genera un CorrelationId con el formato COR-YYYYMMDD-NNNNNN.
 * El sufijo se pasa desde el contador de la BD para garantizar unicidad por día.
 */
export function formatCorrelationId(date: Date, sequence: number): CorrelationId {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const seq = String(sequence).padStart(6, "0");
  return `COR-${y}${m}${d}-${seq}`;
}
