/**
 * AutodataConnector — Technical Data Hub (Fase 2).
 *
 * Autodata destaca en tiempos de reparación, planes de mantenimiento y medidas técnicas.
 * De momento opera en simulación (sin credenciales); los ganchos `real*` se implementarán
 * al contratar el acceso. La config no sensible (baseUrl) vive en la config del tenant;
 * las credenciales, en el proveedor de secretos.
 */

import type { ConnectorInfo } from "../../../domain/connectors.ts";
import type { OperationContext } from "../../../domain/identifiers.ts";
import { getSecretsProvider } from "../../../infrastructure/secrets.ts";
import { SimulatedTechnicalConnector } from "../SimulatedTechnicalConnector.ts";

export interface AutodataConfig {
  baseUrl?: string;
}

export class AutodataConnector extends SimulatedTechnicalConnector {
  readonly info: ConnectorInfo = {
    key: "autodata",
    kind: "technical",
    displayName: "Autodata",
    capabilities: [
      "identifyVehicle",
      "getTechnicalSpecifications",
      "getRepairTimes",
      "getMaintenancePlan",
      "getTyreSpecifications",
    ],
  };

  constructor(private readonly config: AutodataConfig = {}) {
    super();
  }

  protected async useSimulation(ctx: OperationContext): Promise<boolean> {
    if (!this.config.baseUrl) return true;
    const apiKey = await getSecretsProvider().get(ctx.tenantId, this.info.key, "api_key");
    return !apiKey;
  }
}
