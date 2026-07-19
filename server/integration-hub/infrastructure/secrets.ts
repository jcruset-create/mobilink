/**
 * Proveedor de secretos (§2.8).
 *
 * Las credenciales de cada conector/tenant NO se guardan en Supabase ni en el código:
 * se resuelven a través de este proveedor. La implementación por defecto lee de variables
 * de entorno (gestionadas fuera del repo, p. ej. en Render), y está diseñada para poder
 * sustituirse por un gestor de secretos real (Azure Key Vault, AWS Secrets Manager...).
 *
 * Convención de nombres de env:
 *   IH_SECRET__<TENANT>__<CONNECTOR>__<NAME>   (específico por tenant)
 *   IH_SECRET__<CONNECTOR>__<NAME>             (fallback global del conector)
 * donde TENANT/CONNECTOR/NAME se normalizan a MAYÚSCULAS y '-'→'_'.
 */

export interface SecretsProvider {
  get(tenantId: string, connectorKey: string, name: string): Promise<string | undefined>;
}

function norm(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

class EnvSecretsProvider implements SecretsProvider {
  async get(tenantId: string, connectorKey: string, name: string): Promise<string | undefined> {
    const scoped = `IH_SECRET__${norm(tenantId)}__${norm(connectorKey)}__${norm(name)}`;
    const global = `IH_SECRET__${norm(connectorKey)}__${norm(name)}`;
    return process.env[scoped] ?? process.env[global];
  }
}

let provider: SecretsProvider = new EnvSecretsProvider();

/** Permite inyectar otro proveedor (p. ej. en tests o al migrar a un vault real). */
export function setSecretsProvider(p: SecretsProvider): void {
  provider = p;
}

export function getSecretsProvider(): SecretsProvider {
  return provider;
}
