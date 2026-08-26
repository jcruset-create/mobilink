/**
 * bc-setup — deja Business Central configurado y probado en un solo comando.
 *
 * Hace lo que antes requería arrancar el servidor y lanzar dos peticiones HTTP a mano:
 *   1. lee las credenciales del .env (proveedor de secretos del Hub),
 *   2. descubre entorno y empresa preguntando a la propia API de BC,
 *   3. guarda la config del conector en integration_connector_configs,
 *   4. ejecuta testConnection() y dice si seguimos en simulación o ya vamos contra BC real.
 *
 * Uso:
 *   npm run bc:setup
 *   npm run bc:setup -- --tenant TENANT-001 --company "CRONUS ES" --env Production
 *
 * No escribe nada en Business Central: solo lecturas. No imprime secretos ni tokens.
 */

import dotenv from "dotenv";
dotenv.config();

import { initIntegrationHub } from "../server/integration-hub/infrastructure/schema.ts";
import { upsertConnectorConfig, nextCorrelationId } from "../server/integration-hub/infrastructure/repositories.ts";
import { resolveErpConnector } from "../server/integration-hub/connectors/ConnectorRegistry.ts";

const ok = (m: string) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const bad = (m: string) => console.log(`\x1b[31m✗\x1b[0m ${m}`);
const info = (m: string) => console.log(`  ${m}`);
const title = (m: string) => console.log(`\n\x1b[1m${m}\x1b[0m`);

/** Lee --clave valor de la línea de comandos. */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const tenantId = arg("tenant") || process.env.BC_MOBILINK_TENANT || "TENANT-001";
const companyFilter = arg("company") || process.env.BC_COMPANY || "CRONUS";
const envFilter = arg("env") || process.env.BC_ENVIRONMENT;

const aadTenantId =
  process.env.IH_SECRET__BUSINESS_CENTRAL__AAD_TENANT_ID || process.env.BC_TENANT_ID || "";
const clientId = process.env.IH_SECRET__BUSINESS_CENTRAL__CLIENT_ID || process.env.BC_CLIENT_ID || "";
const clientSecret =
  process.env.IH_SECRET__BUSINESS_CENTRAL__CLIENT_SECRET || process.env.BC_CLIENT_SECRET || "";

async function main() {
  title("1) Credenciales");
  const missing = [
    !aadTenantId && "IH_SECRET__BUSINESS_CENTRAL__AAD_TENANT_ID",
    !clientId && "IH_SECRET__BUSINESS_CENTRAL__CLIENT_ID",
    !clientSecret && "IH_SECRET__BUSINESS_CENTRAL__CLIENT_SECRET",
  ].filter(Boolean);
  if (missing.length) {
    bad("Faltan variables en el .env:");
    for (const m of missing) info(`- ${m}`);
    process.exit(1);
  }
  ok(`Credenciales presentes (tenant de Mobilink: ${tenantId})`);

  // ── Token ──────────────────────────────────────────────────────────────────
  title("2) Token de Microsoft Entra ID");
  const tokenRes = await fetch(`https://login.microsoftonline.com/${aadTenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://api.businesscentral.dynamics.com/.default",
    }),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    bad(`Entra ID devolvió ${tokenRes.status}`);
    if (text.includes("AADSTS7000215")) info("client_secret inválido o caducado.");
    if (text.includes("AADSTS700016")) info("El client_id no existe en ese tenant.");
    process.exit(1);
  }
  const { access_token: token } = (await tokenRes.json()) as { access_token: string };
  ok("Token obtenido");
  const authHeaders = { Authorization: `Bearer ${token}`, Accept: "application/json" };

  // ── Entorno + empresa ──────────────────────────────────────────────────────
  title("3) Entorno y empresa");
  const candidates = envFilter ? [envFilter] : ["Production", "Sandbox"];
  let baseUrl = "";
  let company: any = null;

  for (const envName of candidates) {
    const url = `https://api.businesscentral.dynamics.com/v2.0/${aadTenantId}/${envName}/api/v2.0`;
    const res = await fetch(`${url}/companies`, { headers: authHeaders });
    if (!res.ok) {
      info(`${envName}: ${res.status}`);
      if (res.status === 401 || res.status === 403) {
        info("La app no está habilitada dentro de BC (Microsoft Entra Applications).");
      }
      continue;
    }
    const { value: companies = [] } = (await res.json()) as { value: any[] };
    const match =
      companies.find((c) =>
        (c.displayName || c.name || "").toUpperCase().includes(companyFilter.toUpperCase())
      ) ?? companies[0];
    if (match) {
      baseUrl = url;
      company = match;
      ok(`${envName} → ${match.displayName || match.name}`);
      break;
    }
  }

  if (!company) {
    bad("No se encontró ninguna empresa accesible. Revisa el alta de la app dentro de BC.");
    process.exit(1);
  }

  // ── Guardar config ─────────────────────────────────────────────────────────
  title("4) Guardando configuración del conector");
  await initIntegrationHub();
  const config = {
    baseUrl,
    aadTenantId,
    companyId: company.id,
    defaultCurrency: company.currencyCode || "EUR",
  };
  await upsertConnectorConfig({
    tenantId,
    connectorKey: "business-central",
    enabled: true,
    config,
  });
  ok("Guardada en integration_connector_configs");
  info(`baseUrl:   ${config.baseUrl}`);
  info(`companyId: ${config.companyId}`);
  info(`moneda:    ${config.defaultCurrency}`);

  // ── Probar ─────────────────────────────────────────────────────────────────
  title("5) Prueba de conexión (la misma que usa el panel)");
  const resolved = await resolveErpConnector(tenantId);
  const result = await resolved.connector.testConnection({
    tenantId,
    correlationId: await nextCorrelationId(),
  });
  if (result.ok && !/simulaci/i.test(result.message)) {
    ok(result.message);
    title("Listo");
    console.log("El conector ya opera contra Business Central real.");
    console.log(`Siguiente paso: crear un presupuesto con  npm run bc:quote -- --customer <nº> --item <nº>`);
  } else if (result.ok) {
    bad(`Sigue en simulación: ${result.message}`);
    info("Revisa que las tres variables IH_SECRET__BUSINESS_CENTRAL__* estén en el .env.");
    process.exitCode = 1;
  } else {
    bad(result.message);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    bad(e?.message ?? String(e));
    process.exit(1);
  })
  .finally(() => process.exit(process.exitCode ?? 0));
