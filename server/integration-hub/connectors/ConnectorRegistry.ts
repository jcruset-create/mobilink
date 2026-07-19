/**
 * Connector Registry (§2.5).
 *
 * Sabe qué conectores existen y cuál usa cada tenant. Los módulos operativos piden
 * "el conector ERP del tenant X" y reciben una implementación de IErpConnector, sin
 * conocer si por debajo es Business Central, SAP u otro.
 */

import type { IErpConnector } from "../domain/connectors.ts";
import type { ConnectorKind } from "../domain/operation.ts";
import { IntegrationError } from "../domain/errors.ts";
import { getConnectorConfig } from "../infrastructure/repositories.ts";
import { BusinessCentralConnector, type BusinessCentralConfig } from "./erp/business-central/BusinessCentralConnector.ts";

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
