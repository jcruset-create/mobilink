/**
 * RecambistaGenericoConnector — primer recambista del Supplier Hub (Fase 3, §12).
 *
 * La spec pide empezar por UN solo recambista (precio, stock, entrega, pedido). Este
 * conector cubre ese caso en simulación y sirve de plantilla: para integrar un recambista
 * real basta con crear otra subclase de SimulatedSupplierConnector con su `supplierId`,
 * su config (baseUrl) y los ganchos `real*`.
 */

import type { ConnectorInfo } from "../../../domain/connectors.ts";
import type { OperationContext } from "../../../domain/identifiers.ts";
import { getSecretsProvider } from "../../../infrastructure/secrets.ts";
import { SimulatedSupplierConnector } from "../SimulatedSupplierConnector.ts";

export interface RecambistaGenericoConfig {
  baseUrl?: string;
  /** Días de entrega base del proveedor (se puede ajustar por config). */
  leadDays?: number;
}

export class RecambistaGenericoConnector extends SimulatedSupplierConnector {
  readonly info: ConnectorInfo = {
    key: "recambista-generico",
    kind: "supplier",
    displayName: "Recambista genérico",
    capabilities: [
      "searchPart",
      "getPrice",
      "getAvailability",
      "getDeliveryTime",
      "createSupplierCart",
      "createPurchaseOrder",
      "getOrderStatus",
      "cancelOrder",
    ],
  };
  protected readonly supplierId = "SUP-001";

  constructor(private readonly config: RecambistaGenericoConfig = {}) {
    super();
    this.baseLeadDays = config.leadDays ?? 1;
  }

  protected async useSimulation(ctx: OperationContext): Promise<boolean> {
    if (!this.config.baseUrl) return true;
    const apiKey = await getSecretsProvider().get(ctx.tenantId, this.info.key, "api_key");
    return !apiKey;
  }
}
