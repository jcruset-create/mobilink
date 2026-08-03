/**
 * CatalogSyncService — catálogo controlado de WorkPlanner (SPEC §4, It.1).
 *
 * Sincroniza desde Business Central los artículos aptos para trabajos de campo hacia la
 * copia local `wp_catalog`. BC es el maestro: aquí nunca se crea ni edita un producto.
 *
 * Modos:
 *  - full: trae todo, y al terminar desactiva los huérfanos (artículos que ya no
 *    existen en BC y que el incremental jamás detectaría).
 *  - incremental: sólo lo modificado desde la marca de agua (lastModifiedDateTime),
 *    con un solape de 5 min para no perder cambios en el borde del reloj.
 *
 * Filtro de inclusión con API estándar (hasta que llegue el campo
 * 'Available In WorkPlanner' de la extensión AL, It.4):
 *  - blocked = false, y
 *  - si la config del conector trae `catalogCategories` (array), la categoría debe
 *    estar en la lista; sin lista, entran todas.
 *
 * Un artículo excluido NO se borra: se marca inactivo con su motivo, porque los
 * consumos históricos lo referencian.
 */

import { IntegrationError } from "../../domain/errors.ts";
import type { OperationContext } from "../../domain/identifiers.ts";
import { resolveErpConnector } from "../../connectors/ConnectorRegistry.ts";
import type { BcCatalogItem } from "../../connectors/erp/business-central/BusinessCentralConnector.ts";
import { runOperation } from "./IntegrationOperationsService.ts";
import {
  nextCorrelationId,
  upsertCatalogItem,
  deactivateCatalogOrphans,
  getSyncState,
  upsertSyncState,
  listCatalog,
} from "../../infrastructure/repositories.ts";

const ENTITY = "catalog";
/** Solape del incremental: se relee este margen por si un cambio cayó justo en el borde. */
const OVERLAP_MS = 5 * 60 * 1000;

export interface CatalogSyncResult {
  mode: "full" | "incremental";
  correlationId: string;
  simulated: boolean;
  recibidos: number;
  activos: number;
  desactivados: number;
  huerfanos: number;
}

export async function runCatalogSync(params: {
  tenantId: string;
  full?: boolean;
  correlationId?: string;
}): Promise<CatalogSyncResult> {
  if (!params.tenantId) throw IntegrationError.validation("MISSING_TENANT", "tenantId es obligatorio");

  const resolved = await resolveErpConnector(params.tenantId);
  const connector = resolved.connector as unknown as {
    getCatalogItems?: (ctx: OperationContext, opts?: { modifiedSince?: Date }) => Promise<BcCatalogItem[]>;
  };
  if (typeof connector.getCatalogItems !== "function") {
    throw IntegrationError.validation(
      "CATALOG_UNSUPPORTED",
      `El conector ERP '${resolved.key}' no soporta lectura de catálogo`
    );
  }

  const state = await getSyncState(params.tenantId, ENTITY);
  // Sin marca de agua previa, el primer incremental es en realidad un full.
  const mode: "full" | "incremental" = params.full || !state?.last_sync_ms ? "full" : "incremental";
  const modifiedSince =
    mode === "incremental" ? new Date(Number(state.last_sync_ms) - OVERLAP_MS) : undefined;

  const correlationId = params.correlationId ?? (await nextCorrelationId());
  const ctx: OperationContext = { tenantId: params.tenantId, correlationId };
  const syncRunId = `${mode}-${correlationId}`;
  const categoriasPermitidas = normalizarCategorias((resolved.config as any)?.catalogCategories);
  const inicioMs = Date.now();

  try {
    const { result } = await runOperation(
      ctx,
      {
        operationType: "ERP_SYNC_CATALOG",
        connectorKey: resolved.key,
        sourceSystem: resolved.key,
        targetSystem: "workplanner",
        requestPayload: { mode, modifiedSince: modifiedSince?.toISOString() ?? null, categoriasPermitidas },
      },
      async (log) => {
        const items = await connector.getCatalogItems!(ctx, { modifiedSince });
        await log.info(`${items.length} artículos recibidos de ${resolved.key} (${mode})`);

        let activos = 0;
        let desactivados = 0;
        for (const item of items) {
          const exclusion = motivoExclusion(item, categoriasPermitidas);
          await upsertCatalogItem({
            tenantId: params.tenantId,
            bcItemId: item.id,
            bcNumber: item.number,
            tipo: item.type,
            descripcion: item.displayName ?? "",
            umBase: item.baseUnitOfMeasureCode,
            categoria: item.itemCategoryCode,
            precioOrientativo: item.unitPrice,
            activo: exclusion === null,
            motivoInactivo: exclusion ?? undefined,
            bcLastModifiedMs: item.lastModifiedDateTime ? Date.parse(item.lastModifiedDateTime) : undefined,
            syncRunId,
          });
          if (exclusion === null) activos++;
          else desactivados++;
        }

        // Conciliación de huérfanos: sólo tiene sentido tras una pasada completa.
        const huerfanos = mode === "full" ? await deactivateCatalogOrphans(params.tenantId, syncRunId) : 0;
        if (huerfanos > 0) {
          await log.warn(`${huerfanos} artículos desactivados por no existir ya en ${resolved.key}`);
        }

        const resumen: CatalogSyncResult = {
          mode,
          correlationId,
          simulated: resolved.usingDefault,
          recibidos: items.length,
          activos,
          desactivados,
          huerfanos,
        };
        return { result: resumen, responsePayload: resumen };
      }
    );

    await upsertSyncState({
      tenantId: params.tenantId,
      entity: ENTITY,
      // La marca de agua es el INICIO de la pasada, no el final: lo modificado
      // durante la propia sincronización entra en la siguiente.
      lastSyncMs: inicioMs,
      lastFullSyncMs: mode === "full" ? inicioMs : undefined,
      status: "ok",
      detail: `${result.recibidos} recibidos, ${result.activos} activos`,
    });
    return result;
  } catch (e: any) {
    await upsertSyncState({
      tenantId: params.tenantId,
      entity: ENTITY,
      status: "error",
      detail: e?.message ?? String(e),
    });
    throw e;
  }
}

/** null = incluido; en otro caso, el motivo de exclusión que se guarda. */
function motivoExclusion(item: BcCatalogItem, categoriasPermitidas: string[] | null): string | null {
  if (item.blocked) return "bloqueado";
  if (categoriasPermitidas && !categoriasPermitidas.includes((item.itemCategoryCode ?? "").toUpperCase())) {
    return "fuera_de_filtro";
  }
  return null;
}

function normalizarCategorias(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.map((v) => String(v).toUpperCase());
}

export async function getCatalogStatus(tenantId: string) {
  const [state, activos, todos] = await Promise.all([
    getSyncState(tenantId, ENTITY),
    listCatalog({ tenantId, soloActivos: true, limit: 1000 }),
    listCatalog({ tenantId, limit: 1000 }),
  ]);
  return {
    lastSyncMs: state?.last_sync_ms ? Number(state.last_sync_ms) : null,
    lastFullSyncMs: state?.last_full_sync_ms ? Number(state.last_full_sync_ms) : null,
    status: state?.status ?? null,
    detail: state?.detail ?? null,
    activos: activos.length,
    total: todos.length,
  };
}
