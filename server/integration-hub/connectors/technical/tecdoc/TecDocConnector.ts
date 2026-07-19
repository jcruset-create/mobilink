/**
 * TecDocConnector — Technical Data Hub (Fase 2).
 *
 * TecDoc destaca en catálogo de recambios y referencias OE/cruzadas. De momento opera
 * en simulación; los ganchos `real*` se implementarán al contratar el acceso.
 */

import type { ConnectorInfo } from "../../../domain/connectors.ts";
import type { OperationContext } from "../../../domain/identifiers.ts";
import { getSecretsProvider } from "../../../infrastructure/secrets.ts";
import { SimulatedTechnicalConnector } from "../SimulatedTechnicalConnector.ts";

export interface TecDocConfig {
  baseUrl?: string;
  providerId?: string;
}

export class TecDocConnector extends SimulatedTechnicalConnector {
  readonly info: ConnectorInfo = {
    key: "tecdoc",
    kind: "technical",
    displayName: "TecDoc",
    capabilities: ["identifyVehicle", "getCompatibleParts", "getOeReferences"],
  };

  constructor(private readonly config: TecDocConfig = {}) {
    super();
  }

  protected async useSimulation(ctx: OperationContext): Promise<boolean> {
    if (!this.config.baseUrl) return true;
    const apiKey = await getSecretsProvider().get(ctx.tenantId, this.info.key, "api_key");
    return !apiKey;
  }
}
