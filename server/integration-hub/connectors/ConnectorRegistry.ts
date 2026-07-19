/**
 * Connector Registry (§2.5).
 *
 * Sabe qué conectores existen y cuál usa cada tenant. Los módulos operativos piden
 * "el conector ERP del tenant X" y reciben una implementación de IErpConnector, sin
 * conocer si por debajo es Business Central, SAP u otro.
 */

import type { IErpConnector, ITechnicalConnector, ISupplierConnector } from "../domain/connectors.ts";
import type { ConnectorKind } from "../domain/operation.ts";
import { IntegrationError } from "../domain/errors.ts";
import { getConnectorConfig, listConnectorConfigs } from "../infrastructure/repositories.ts";
import { BusinessCentralConnector, type BusinessCentralConfig } from "./erp/business-central/BusinessCentralConnector.ts";
import { AutodataConnector, type AutodataConfig } from "./technical/autodata/AutodataConnector.ts";
import { TecDocConnector, type TecDocConfig } from "./technical/tecdoc/TecDocConnector.ts";
import {
  RecambistaGenericoConnector,
  type RecambistaGenericoConfig,
} from "./suppliers/recambista-generico/RecambistaGenericoConnector.ts";

/** Fábricas de conectores ERP disponibles, por key. */
const ERP_FACTORIES: Record<string, (config: any) => IErpConnector> = {
  "business-central": (config: BusinessCentralConfig) => new BusinessCentralConnector(config),
  // Futuro: "dynamics-nav", "sap", "sage", "odoo"...
};

/** Conector ERP por defecto cuando el tenant no tiene config (arranca en simulación). */
const DEFAULT_ERP_KEY = "business-central";

export interface ResolvedConnector<T> {
  key: string;
  connector: T;
  /** true si no había config en BD y se usa el conector por defecto en simulación. */
  usingDefault: boolean;
}

export async function resolveErpConnector(tenantId: string): Promise<ResolvedConnector<IErpConnector>> {
  const cfg = await findEnabledConfig(tenantId, "erp");
  if (!cfg) {
    return {
      key: DEFAULT_ERP_KEY,
      connector: ERP_FACTORIES[DEFAULT_ERP_KEY]({}),
      usingDefault: true,
    };
  }
  const factory = ERP_FACTORIES[cfg.connector_key];
  if (!factory) {
    throw IntegrationError.validation(
      "CONNECTOR_UNKNOWN",
      `No hay implementación para el conector ERP '${cfg.connector_key}'`
    );
  }
  return {
    key: cfg.connector_key,
    connector: factory(cfg.config ?? {}),
    usingDefault: false,
  };
}

/**
 * Busca la primera config habilitada de un tipo (kind) para el tenant.
 * De momento sólo consultamos business-central; al añadir más conectores ERP
 * se generalizará (o se guardará el "conector activo" por kind en la config del tenant).
 */
async function findEnabledConfig(tenantId: string, kind: ConnectorKind) {
  if (kind === "erp") {
    const bc = await getConnectorConfig(tenantId, "business-central");
    if (bc?.enabled) return bc;
  }
  return null;
}

export function knownErpConnectorKeys(): string[] {
  return Object.keys(ERP_FACTORIES);
}

// ── Technical Data Hub (Fase 2) ─────────────────────────────────────────────

/** Fábricas de conectores técnicos disponibles, por key. */
const TECHNICAL_FACTORIES: Record<string, (config: any) => ITechnicalConnector> = {
  autodata: (config: AutodataConfig) => new AutodataConnector(config),
  tecdoc: (config: TecDocConfig) => new TecDocConnector(config),
};

/**
 * Preferencia de conector por capacidad técnica: TecDoc para catálogo/OE,
 * Autodata para tiempos/mantenimiento/medidas. Se puede sobreescribir por config.
 */
const TECHNICAL_CAPABILITY_PREFERENCE: Record<string, string[]> = {
  identifyVehicle: ["tecdoc", "autodata"],
  getTechnicalSpecifications: ["autodata", "tecdoc"],
  getCompatibleParts: ["tecdoc", "autodata"],
  getOeReferences: ["tecdoc", "autodata"],
  getRepairTimes: ["autodata", "tecdoc"],
  getMaintenancePlan: ["autodata", "tecdoc"],
  getTyreSpecifications: ["autodata", "tecdoc"],
};

export function knownTechnicalConnectorKeys(): string[] {
  return Object.keys(TECHNICAL_FACTORIES);
}

/** Construye un conector técnico concreto por key, con la config del tenant. */
export async function buildTechnicalConnector(tenantId: string, key: string): Promise<ITechnicalConnector> {
  const factory = TECHNICAL_FACTORIES[key];
  if (!factory) {
    throw IntegrationError.validation("CONNECTOR_UNKNOWN", `No hay implementación para el conector técnico '${key}'`);
  }
  const cfg = await getConnectorConfig(tenantId, key);
  return factory(cfg?.config ?? {});
}

/**
 * Resuelve el mejor conector técnico para una capacidad. Prioriza los conectores
 * habilitados en la config del tenant; si ninguno lo está, usa la preferencia por
 * defecto (que arranca en simulación).
 */
export async function resolveTechnicalConnector(
  tenantId: string,
  capability: keyof typeof TECHNICAL_CAPABILITY_PREFERENCE
): Promise<ResolvedConnector<ITechnicalConnector>> {
  const preference = TECHNICAL_CAPABILITY_PREFERENCE[capability] ?? knownTechnicalConnectorKeys();

  // 1) ¿Algún conector preferido está habilitado para el tenant?
  for (const key of preference) {
    const cfg = await getConnectorConfig(tenantId, key);
    if (cfg?.enabled) {
      return { key, connector: await buildTechnicalConnector(tenantId, key), usingDefault: false };
    }
  }

  // 2) Ninguno configurado → primer preferido en simulación.
  const key = preference[0];
  return { key, connector: await buildTechnicalConnector(tenantId, key), usingDefault: true };
}

// ── Supplier Hub (Fase 3) ────────────────────────────────────────────────────

/** Fábricas de conectores de recambista disponibles, por key. */
const SUPPLIER_FACTORIES: Record<string, (config: any) => ISupplierConnector> = {
  "recambista-generico": (config: RecambistaGenericoConfig) => new RecambistaGenericoConnector(config),
  // Futuro: recambistas reales (cada uno su subclase de SimulatedSupplierConnector).
};

const DEFAULT_SUPPLIER_KEY = "recambista-generico";

export function knownSupplierConnectorKeys(): string[] {
  return Object.keys(SUPPLIER_FACTORIES);
}

/** Construye un conector de recambista concreto por key, con la config del tenant. */
export async function buildSupplierConnector(tenantId: string, key: string): Promise<ISupplierConnector> {
  const factory = SUPPLIER_FACTORIES[key];
  if (!factory) {
    throw IntegrationError.validation("CONNECTOR_UNKNOWN", `No hay implementación para el recambista '${key}'`);
  }
  const cfg = await getConnectorConfig(tenantId, key);
  return factory(cfg?.config ?? {});
}

/**
 * Resuelve TODOS los recambistas habilitados del tenant (para consultar precios/stock
 * en paralelo y comparar). Si ninguno está configurado, devuelve el recambista por
 * defecto en simulación.
 */
export async function resolveSupplierConnectors(
  tenantId: string
): Promise<Array<ResolvedConnector<ISupplierConnector>>> {
  const configs = await listConnectorConfigs(tenantId);
  const enabled = configs.filter((c: any) => c.enabled && SUPPLIER_FACTORIES[c.connector_key]);

  if (enabled.length === 0) {
    return [
      {
        key: DEFAULT_SUPPLIER_KEY,
        connector: await buildSupplierConnector(tenantId, DEFAULT_SUPPLIER_KEY),
        usingDefault: true,
      },
    ];
  }

  return Promise.all(
    enabled.map(async (c: any) => ({
      key: c.connector_key as string,
      connector: await buildSupplierConnector(tenantId, c.connector_key),
      usingDefault: false,
    }))
  );
}
