/**
 * SupplierService — casos de uso del Supplier Hub (Fase 3).
 *
 * - searchOffers: consulta a TODOS los recambistas habilitados en paralelo, normaliza y
 *   ORDENA las ofertas (disponible primero, luego más barato), y las persiste en supplier_offers.
 * - createPurchaseOrder: crea un pedido de compra en un recambista concreto.
 *
 * Todo pasa por operaciones trazables del Hub. El llamante no conoce ningún recambista concreto.
 */

import type { OperationContext } from "../../domain/identifiers.ts";
import type { SupplierSearchQuery, SupplierOrderLine } from "../../domain/supplier.ts";
import type { SupplierOffer } from "../../domain/models.ts";
import { IntegrationError } from "../../domain/errors.ts";
import { resolveSupplierConnectors, buildSupplierConnector } from "../../connectors/ConnectorRegistry.ts";
import { runOperation } from "./IntegrationOperationsService.ts";
import { nextCorrelationId, saveSupplierOffers } from "../../infrastructure/repositories.ts";

/** Ordena ofertas: primero con stock suficiente, luego por menor coste unitario. */
function rankOffers(offers: SupplierOffer[], quantity: number): SupplierOffer[] {
  return [...offers].sort((a, b) => {
    const aOk = a.availableQuantity >= quantity ? 0 : 1;
    const bOk = b.availableQuantity >= quantity ? 0 : 1;
    if (aOk !== bOk) return aOk - bOk;
    return a.unitCost - b.unitCost;
  });
}

export interface SupplierOpts {
  correlationId?: string;
}

export async function searchOffers(tenantId: string, query: SupplierSearchQuery, opts: SupplierOpts = {}) {
  if (!tenantId) throw IntegrationError.validation("MISSING_TENANT", "tenantId es obligatorio");
  if (!query.oeReference && !query.manufacturerReference && !query.text) {
    throw IntegrationError.validation("MISSING_SEARCH", "Se requiere oeReference, manufacturerReference o text");
  }
  const quantity = query.quantity ?? 1;
  const suppliers = await resolveSupplierConnectors(tenantId);
  const ctx: OperationContext = { tenantId, correlationId: opts.correlationId ?? (await nextCorrelationId()) };

  const { result } = await runOperation(
    ctx,
    {
      operationType: "SUPPLIER_SEARCH_PART",
      connectorKey: suppliers.map((s) => s.key).join(","),
      sourceSystem: "mobilink",
      targetSystem: "suppliers",
      requestPayload: query,
    },
    async (log) => {
      // Consulta a todos los recambistas en paralelo; uno caído no tumba la búsqueda.
      const perSupplier = await Promise.all(
        suppliers.map(async (s) => {
          try {
            return await s.connector.searchPart(ctx, query);
          } catch (e: any) {
            await log.warn(`Recambista '${s.key}' no respondió: ${e?.message ?? e}`);
            return [] as SupplierOffer[];
          }
        })
      );
      const offers = rankOffers(perSupplier.flat(), quantity);
      await saveSupplierOffers(tenantId, ctx.correlationId, offers);
      await log.info(`Ofertas recibidas: ${offers.length} de ${suppliers.length} recambista(s)`, "PROCESSING", {
        suppliers: suppliers.map((s) => s.key),
      });
      const best = offers.find((o) => o.availableQuantity >= quantity) ?? offers[0] ?? null;
      return { result: { offers, best }, responsePayload: { count: offers.length, best } };
    }
  );

  return {
    correlationId: ctx.correlationId,
    suppliers: suppliers.map((s) => s.key),
    simulated: suppliers.every((s) => s.usingDefault),
    offers: result.offers,
    best: result.best,
  };
}

export async function createPurchaseOrder(
  tenantId: string,
  supplierKey: string,
  lines: SupplierOrderLine[],
  reference?: string,
  opts: SupplierOpts = {}
) {
  if (!tenantId) throw IntegrationError.validation("MISSING_TENANT", "tenantId es obligatorio");
  if (!supplierKey) throw IntegrationError.validation("MISSING_SUPPLIER", "supplierKey es obligatorio");
  if (!lines?.length) throw IntegrationError.validation("EMPTY_LINES", "Se requiere al menos una línea");
  for (const [i, l] of lines.entries()) {
    if (!l.supplierPartNumber) throw IntegrationError.validation("LINE_NO_PART", `Línea ${i}: falta supplierPartNumber`);
    if (!(l.quantity > 0)) throw IntegrationError.validation("LINE_BAD_QTY", `Línea ${i}: cantidad debe ser > 0`);
  }

  const connector = await buildSupplierConnector(tenantId, supplierKey);
  const ctx: OperationContext = { tenantId, correlationId: opts.correlationId ?? (await nextCorrelationId()) };

  const { result } = await runOperation(
    ctx,
    {
      operationType: "SUPPLIER_CREATE_PURCHASE_ORDER",
      connectorKey: supplierKey,
      sourceSystem: "mobilink",
      targetSystem: supplierKey,
      requestPayload: { lines, reference },
    },
    async () => {
      const order = await connector.createPurchaseOrder(ctx, { lines, reference });
      return { result: order, responsePayload: order };
    }
  );

  return { correlationId: ctx.correlationId, supplier: supplierKey, order: result };
}
