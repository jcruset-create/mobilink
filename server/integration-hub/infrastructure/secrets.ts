/**
 * Proveedor de secretos (§2.8).
 *
 * Las credenciales de cada conector/tenant NO se guardan en Supabase ni en el código:
 * se resuelven a través de este proveedor. La implementación por defecto lee de variables
 * de entorno (gestionadas fuera del repo, p. ej. en Render), y está diseñada para poder
 * sustituirse por un gestor de secretos real (Azure Key Vault, AWS Secrets Manager...).
 *
 * Convención de nombres de env, del más específico al más general:
 *
 *   IH_SECRET__<TENANT>__<CONNECTOR>__<ACCOUNT>__<NAME>   (una cuenta concreta)
 *   IH_SECRET__<TENANT>__<CONNECTOR>__<NAME>              (todas las del cliente)
 *   IH_SECRET__<CONNECTOR>__<NAME>                        (fallback global)
 *
 * donde TENANT/CONNECTOR/ACCOUNT/NAME se normalizan a MAYÚSCULAS y '-'→'_'.
 *
 * ── Por qué hizo falta el escalón de la cuenta ──────────────────────────────
 *
 * Todo lo demás del Hub ya distinguía cuentas —`integration_connector_configs`
 * dejó de tener UNIQUE (tenant, connector), los mapeos llevan `account_key`, y
 * `resolveTelematicsConnectors` devuelve una entrada por cuenta— pero la
 * resolución del secreto no. Con dos cuentas del mismo proveedor para el mismo
 * cliente —la flota de autobuses y la auxiliar, cada una con su token— las dos
 * resolvían la MISMA variable. La segunda daba 401 con la credencial correcta,
 * o peor: si el token servía para ambas, devolvía la flota equivocada sin dar
 * ningún error.
 *
 * El escalón nuevo va DELANTE, no en lugar de nada: quien no pasa cuenta
 * resuelve exactamente igual que antes, y una cuenta sin variable propia cae al
 * secreto del cliente. Por eso no hay que tocar ninguna variable de las que ya
 * están configuradas para que todo siga funcionando.
 *
 * ── Un aviso sobre los nombres ──────────────────────────────────────────────
 *
 * `norm()` convierte cualquier tira de caracteres raros en un solo '_', así que
 * dos claves distintas pueden normalizar al mismo nombre (un tenant `a-b` y uno
 * `a_b`). Ya pasaba con tres segmentos y con cuatro hay una combinación más.
 * No se resuelve aquí porque los identificadores reales son UUID y claves de
 * conector, que no chocan; si algún día se usan claves libres, este es el sitio.
 */

export interface SecretsProvider {
  /**
   * @param accountKey Cuenta del proveedor, cuando la hay. Sin ella se resuelve
   *   el secreto del cliente, que es el comportamiento de siempre.
   */
  get(
    tenantId: string,
    connectorKey: string,
    name: string,
    accountKey?: string,
  ): Promise<string | undefined>;
}

function norm(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

/** Los nombres candidatos, en orden de preferencia. Exportado para poder probarlo. */
export function nombresCandidatos(
  tenantId: string,
  connectorKey: string,
  name: string,
  accountKey?: string,
): string[] {
  const t = norm(tenantId);
  const c = norm(connectorKey);
  const n = norm(name);
  const nombres: string[] = [];
  // Solo si hay cuenta: sin ella el primer escalón no existe y no se busca.
  if (accountKey) nombres.push(`IH_SECRET__${t}__${c}__${norm(accountKey)}__${n}`);
  nombres.push(`IH_SECRET__${t}__${c}__${n}`);
  nombres.push(`IH_SECRET__${c}__${n}`);
  return nombres;
}

class EnvSecretsProvider implements SecretsProvider {
  async get(
    tenantId: string,
    connectorKey: string,
    name: string,
    accountKey?: string,
  ): Promise<string | undefined> {
    for (const clave of nombresCandidatos(tenantId, connectorKey, name, accountKey)) {
      // Una variable definida pero VACÍA no es un secreto: se sigue bajando.
      // Poner `IH_SECRET__…=` es como no ponerla, y así una cuenta no se queda
      // sin credencial por una línea vacía en la configuración.
      const valor = process.env[clave];
      if (valor) return valor;
    }
    return undefined;
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
