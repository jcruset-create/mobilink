/**
 * ChecklistAutomationService — automatización del checklist (Fase 4, §7 / §12).
 *
 * Caso estrella del Hub: un ítem de checklist "No conforme" desencadena, de forma
 * automática y trazable con UN SOLO CorrelationId:
 *
 *   Checklist "No conforme"
 *     → Incidencia
 *     → Identificar vehículo (Technical Hub, F2)
 *     → Recambio compatible + referencias OE (F2)
 *     → Oferta de proveedor (Supplier Hub, F3)   [salvo que el Rules Engine lo omita]
 *     → Presupuesto en Business Central (ERP Hub, F1)
 *
 * El Rules Engine (§2.5) modula el flujo: stock local → sin proveedores; frenos →
 * validación humana; cliente Premium → OEM; presupuesto > umbral → aprobación gerente.
 *
 * Cada paso es su propia operación en integration_operations, todas con el MISMO
 * correlation_id, de modo que el flujo completo es reconstruible de principio a fin.
 */

import type { OperationContext } from "../../domain/identifiers.ts";
import { IntegrationError } from "../../domain/errors.ts";
import { evaluateRules, type RuleContext, type RuleDecision } from "../../domain/rules.ts";
import { runOperation } from "./IntegrationOperationsService.ts";
import { identifyVehicle, getCompatibleParts, getOeReferences } from "./TechnicalService.ts";
import { searchOffers } from "./SupplierService.ts";
import { createQuoteFromWorkOrder } from "./SalesQuoteService.ts";
import { nextCorrelationId, nextDocumentNumber, saveChecklistRun } from "../../infrastructure/repositories.ts";
import type { SupplierOffer } from "../../domain/models.ts";

export interface ProcessNonConformityInput {
  tenantId: string;
  workOrderId: string;
  checklistId?: string;
  /** Categoría/área del ítem no conforme, p. ej. "Frenos". Gobierna reglas y búsqueda de piezas. */
  category: string;
  /** Cliente en el sistema externo (para el presupuesto). */
  customerId: string;
  customerTier?: string;
  /** Identificación del vehículo (matrícula o VIN) o un vehicleRef ya conocido. */
  plate?: string;
  vin?: string;
  vehicleRef?: string;
  /** Cantidad de la pieza a presupuestar. */
  quantity?: number;
  /** Stock local conocido (activa la regla de "no consultar proveedores"). */
  localStock?: number;
}

interface StepTrace {
  step: string;
  ok: boolean;
  detail?: unknown;
}

export interface ProcessNonConformityResult {
  status: "COMPLETED" | "PARTIAL";
  correlationId: string;
  incidentId: string;
  workOrderId: string;
  vehicleRef?: string;
  selectedPart?: { partRef: string; name: string; category: string; oeReferences: string[] };
  bestOffer?: SupplierOffer | null;
  quote?: { mobilinkQuoteId: string; externalQuoteNumber: string; totalAmount: number; currency: string };
  decision: RuleDecision;
  steps: StepTrace[];
}

export async function processNonConformity(
  input: ProcessNonConformityInput
): Promise<ProcessNonConformityResult> {
  if (!input.tenantId) throw IntegrationError.validation("MISSING_TENANT", "tenantId es obligatorio");
  if (!input.workOrderId) throw IntegrationError.validation("MISSING_WO", "workOrderId es obligatorio");
  if (!input.customerId) throw IntegrationError.validation("MISSING_CUSTOMER", "customerId es obligatorio");
  if (!input.category) throw IntegrationError.validation("MISSING_CATEGORY", "category es obligatoria");
  if (!input.plate && !input.vin && !input.vehicleRef) {
    throw IntegrationError.validation("MISSING_VEHICLE", "Se requiere plate, vin o vehicleRef");
  }

  const correlationId = await nextCorrelationId();
  const incidentId = await nextDocumentNumber("incident", "INC");
  const quantity = input.quantity ?? 1;
  const steps: StepTrace[] = [];

  const ctx: OperationContext = {
    tenantId: input.tenantId,
    correlationId,
    customerId: input.customerId,
    workOrderId: input.workOrderId,
    checklistId: input.checklistId,
    incidentId,
  };

  // Reglas iniciales (con lo que ya sabemos: categoría, cliente, stock local).
  let decision = evaluateRules({
    tenantId: input.tenantId,
    category: input.category,
    customerTier: input.customerTier,
    localStock: input.localStock,
  });

  const { result } = await runOperation(
    ctx,
    {
      operationType: "CHECKLIST_PROCESS_NON_CONFORMITY",
      sourceSystem: "mobilink",
      targetSystem: "integration-hub",
      requestPayload: input,
    },
    async (log) => {
      await log.info(`Incidencia ${incidentId} creada por checklist "No conforme" (${input.category})`, "PROCESSING", {
        incidentId,
        decision,
      });

      // 1) Identificar vehículo (si no viene vehicleRef).
      let vehicleRef = input.vehicleRef;
      if (!vehicleRef) {
        const ident = await identifyVehicle(input.tenantId, { plate: input.plate, vin: input.vin }, { correlationId });
        vehicleRef = ident.candidates[0]?.vehicleRef;
        steps.push({ step: "identify_vehicle", ok: !!vehicleRef, detail: { candidates: ident.candidates.length } });
        if (!vehicleRef) throw IntegrationError.notFound("VEHICLE_NOT_IDENTIFIED", "No se pudo identificar el vehículo");
      } else {
        steps.push({ step: "identify_vehicle", ok: true, detail: { provided: true } });
      }

      // 2) Recambio compatible para la categoría + referencias OE.
      const parts = await getCompatibleParts(input.tenantId, vehicleRef, input.category, { correlationId });
      const selected = parts.parts[0];
      steps.push({ step: "compatible_parts", ok: !!selected, detail: { count: parts.parts.length } });
      if (!selected) throw IntegrationError.notFound("NO_COMPATIBLE_PART", `Sin recambios compatibles para "${input.category}"`);

      let oeReferences = selected.oeReferences ?? [];
      if (oeReferences.length === 0) {
        const oe = await getOeReferences(input.tenantId, selected.partRef, { correlationId });
        oeReferences = oe.oeReferences;
      }
      steps.push({ step: "oe_references", ok: oeReferences.length > 0, detail: { oeReferences } });

      // 3) Oferta de proveedor (salvo que haya stock local → regla skipSuppliers).
      let bestOffer: SupplierOffer | null = null;
      if (decision.skipSuppliers) {
        steps.push({ step: "supplier_offer", ok: true, detail: { skipped: "stock local disponible" } });
        await log.info("Regla: hay stock local, se omite la consulta a proveedores");
      } else {
        const offers = await searchOffers(
          input.tenantId,
          { oeReference: oeReferences[0], quantity },
          { correlationId }
        );
        bestOffer = offers.best;
        steps.push({ step: "supplier_offer", ok: !!bestOffer, detail: { count: offers.offers.length } });
      }

      // 4) Presupuesto en Business Central (F1). Precio unitario = oferta si la hay.
      const unitPrice = bestOffer?.unitCost;
      const quote = await createQuoteFromWorkOrder({
        tenantId: input.tenantId,
        workOrderId: input.workOrderId,
        customerId: input.customerId,
        vehicleId: vehicleRef,
        reference: incidentId,
        correlationId,
        lines: [
          {
            externalProductId: selected.partRef,
            quantity,
            unitPrice,
            description: selected.name,
          },
        ],
      });
      steps.push({
        step: "sales_quote",
        ok: true,
        detail: { mobilinkQuoteId: quote.mobilinkQuoteId, externalQuoteNumber: quote.businessCentralQuoteNumber },
      });

      // Reevaluar reglas ahora que conocemos el importe (aprobación de gerente).
      decision = evaluateRules({
        tenantId: input.tenantId,
        category: input.category,
        customerTier: input.customerTier,
        localStock: input.localStock,
        quoteAmount: quote.totalAmount,
      });
      await log.info("Reglas aplicadas", "PROCESSING", { decision });

      const out: ProcessNonConformityResult = {
        status: "COMPLETED",
        correlationId,
        incidentId,
        workOrderId: input.workOrderId,
        vehicleRef,
        selectedPart: {
          partRef: selected.partRef,
          name: selected.name,
          category: selected.category,
          oeReferences,
        },
        bestOffer,
        quote: {
          mobilinkQuoteId: quote.mobilinkQuoteId,
          externalQuoteNumber: quote.businessCentralQuoteNumber,
          totalAmount: quote.totalAmount,
          currency: quote.currency,
        },
        decision,
        steps,
      };

      await saveChecklistRun({
        tenantId: input.tenantId,
        correlationId,
        workOrderId: input.workOrderId,
        checklistId: input.checklistId,
        incidentId,
        category: input.category,
        status: "COMPLETED",
        vehicleRef,
        selectedPartRef: selected.partRef,
        oeReferences,
        bestOffer,
        mobilinkQuoteId: quote.mobilinkQuoteId,
        externalQuoteNumber: quote.businessCentralQuoteNumber,
        quoteAmount: quote.totalAmount,
        decision,
        steps,
      });

      return { result: out, responsePayload: out };
    }
  );

  return result;
}
