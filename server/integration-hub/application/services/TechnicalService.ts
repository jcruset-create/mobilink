/**
 * TechnicalService — casos de uso del Technical Data Hub (Fase 2).
 *
 * Envuelve cada consulta técnica en una operación trazable del Hub (igual que la Fase 1),
 * resolviendo el conector adecuado por capacidad vía el Connector Registry. El llamante
 * (una OT, el checklist...) no sabe si detrás está Autodata o TecDoc.
 */

import type { OperationContext } from "../../domain/identifiers.ts";
import type { VehicleQuery } from "../../domain/technical.ts";
import { IntegrationError } from "../../domain/errors.ts";
import { resolveTechnicalConnector } from "../../connectors/ConnectorRegistry.ts";
import { runOperation } from "./IntegrationOperationsService.ts";
import { nextCorrelationId } from "../../infrastructure/repositories.ts";

/** Opciones comunes: permite propagar un CorrelationId externo (orquestación Fase 4). */
export interface TechnicalOpts {
  correlationId?: string;
}

async function ctxFor(
  tenantId: string,
  opts: TechnicalOpts = {},
  extra: Partial<OperationContext> = {}
): Promise<OperationContext> {
  if (!tenantId) throw IntegrationError.validation("MISSING_TENANT", "tenantId es obligatorio");
  return { tenantId, correlationId: opts.correlationId ?? (await nextCorrelationId()), ...extra };
}

export async function identifyVehicle(tenantId: string, query: VehicleQuery, opts: TechnicalOpts = {}) {
  if (!query.plate && !query.vin) {
    throw IntegrationError.validation("MISSING_VEHICLE_QUERY", "Se requiere matrícula (plate) o VIN");
  }
  const resolved = await resolveTechnicalConnector(tenantId, "identifyVehicle");
  const ctx = await ctxFor(tenantId, opts);
  const { result } = await runOperation(
    ctx,
    {
      operationType: "TECH_IDENTIFY_VEHICLE",
      connectorKey: resolved.key,
      sourceSystem: "mobilink",
      targetSystem: resolved.key,
      requestPayload: query,
    },
    async () => {
      const candidates = await resolved.connector.identifyVehicle(ctx, query);
      return { result: candidates, responsePayload: { count: candidates.length, candidates } };
    }
  );
  return { correlationId: ctx.correlationId, connector: resolved.key, simulated: resolved.usingDefault, candidates: result };
}

export async function getCompatibleParts(
  tenantId: string,
  vehicleRef: string,
  category?: string,
  opts: TechnicalOpts = {}
) {
  if (!vehicleRef) throw IntegrationError.validation("MISSING_VEHICLE_REF", "vehicleRef es obligatorio");
  const resolved = await resolveTechnicalConnector(tenantId, "getCompatibleParts");
  const ctx = await ctxFor(tenantId, opts, { vehicleId: vehicleRef });
  const { result } = await runOperation(
    ctx,
    {
      operationType: "TECH_GET_COMPATIBLE_PARTS",
      connectorKey: resolved.key,
      sourceSystem: "mobilink",
      targetSystem: resolved.key,
      requestPayload: { vehicleRef, category },
    },
    async () => {
      const parts = await resolved.connector.getCompatibleParts(ctx, vehicleRef, category);
      return { result: parts, responsePayload: { count: parts.length, parts } };
    }
  );
  return { correlationId: ctx.correlationId, connector: resolved.key, simulated: resolved.usingDefault, parts: result };
}

export async function getOeReferences(tenantId: string, partRef: string, opts: TechnicalOpts = {}) {
  if (!partRef) throw IntegrationError.validation("MISSING_PART_REF", "partRef es obligatorio");
  const resolved = await resolveTechnicalConnector(tenantId, "getOeReferences");
  const ctx = await ctxFor(tenantId, opts);
  const { result } = await runOperation(
    ctx,
    {
      operationType: "TECH_GET_OE_REFERENCES",
      connectorKey: resolved.key,
      sourceSystem: "mobilink",
      targetSystem: resolved.key,
      requestPayload: { partRef },
    },
    async () => {
      const oe = await resolved.connector.getOeReferences(ctx, partRef);
      return { result: oe, responsePayload: { oeReferences: oe } };
    }
  );
  return { correlationId: ctx.correlationId, connector: resolved.key, simulated: resolved.usingDefault, oeReferences: result };
}
