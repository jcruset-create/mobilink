#!/usr/bin/env node
/**
 * bc-check — comprobación de conexión con Microsoft Dynamics 365 Business Central.
 *
 * Verifica, paso a paso y sin tocar la base de datos de Mobilink:
 *   1. que Entra ID (Azure AD) entrega un token de aplicación,
 *   2. que Business Central acepta ese token (app dada de alta y habilitada en BC),
 *   3. qué entornos/empresas hay disponibles,
 * y al final imprime las variables de entorno y la config listas para pegar.
 *
 * No escribe nada en BC: solo lecturas.
 *
 * Uso:
 *   BC_TENANT_ID=... BC_CLIENT_ID=... BC_CLIENT_SECRET=... node scripts/bc-check.mjs [entorno]
 *
 * También acepta los nombres de secreto del Integration Hub, por si ya están puestos:
 *   IH_SECRET__BUSINESS_CENTRAL__AAD_TENANT_ID / __CLIENT_ID / __CLIENT_SECRET
 */

const env = process.env;

const tenantId =
  env.BC_TENANT_ID || env.IH_SECRET__BUSINESS_CENTRAL__AAD_TENANT_ID || "";
const clientId = env.BC_CLIENT_ID || env.IH_SECRET__BUSINESS_CENTRAL__CLIENT_ID || "";
const clientSecret =
  env.BC_CLIENT_SECRET || env.IH_SECRET__BUSINESS_CENTRAL__CLIENT_SECRET || "";

/** Entornos a probar: el que pase el usuario, o los habituales de una cuenta de prueba. */
const envCandidates = process.argv[2] ? [process.argv[2]] : ["Production", "Sandbox"];

const ok = (m) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`\x1b[31m✗\x1b[0m ${m}`);
const info = (m) => console.log(`  ${m}`);
const title = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`);

/** Diagnósticos accionables para los errores típicos de esta integración. */
function diagnose(text) {
  const hints = [
    ["AADSTS7000215", "client_secret inválido o caducado → crea un secreto nuevo en Entra ID."],
    ["AADSTS700016", "el client_id no existe en ese tenant de Entra ID (¿tenant equivocado?)."],
    ["AADSTS900023", "el tenant_id no es válido."],
    ["AADSTS7000229", "falta 'Grant admin consent' en los permisos de API."],
    ["AADSTS650057", "el scope no está autorizado: añade Dynamics 365 Business Central → Application permissions → API.ReadWrite.All."],
  ];
  for (const [code, msg] of hints) if (text.includes(code)) return msg;
  return null;
}

if (!tenantId || !clientId || !clientSecret) {
  bad("Faltan credenciales.");
  info("Necesito BC_TENANT_ID, BC_CLIENT_ID y BC_CLIENT_SECRET en el entorno.");
  info("Ejemplo:");
  info('  BC_TENANT_ID=xxxx BC_CLIENT_ID=yyyy BC_CLIENT_SECRET=zzzz node scripts/bc-check.mjs');
  process.exit(1);
}

// ── 1. Token de Entra ID ─────────────────────────────────────────────────────
title("1) Token de Microsoft Entra ID (client credentials)");
let accessToken;
{
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://api.businesscentral.dynamics.com/.default",
  });
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (e) {
    bad(`No se pudo contactar con Entra ID: ${e.message}`);
    process.exit(1);
  }
  const text = await res.text();
  if (!res.ok) {
    bad(`Entra ID devolvió ${res.status}`);
    const hint = diagnose(text);
    if (hint) info(`Diagnóstico: ${hint}`);
    info(text.slice(0, 600));
    process.exit(1);
  }
  const json = JSON.parse(text);
  accessToken = json.access_token;
  ok(`Token obtenido (caduca en ${json.expires_in}s)`);
}

const authHeaders = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };

// ── 2. Entornos disponibles (Automation API; opcional) ───────────────────────
title("2) Entornos del tenant (opcional, requiere Automation.ReadWrite.All)");
{
  try {
    const res = await fetch(
      "https://api.businesscentral.dynamics.com/admin/v2.24/applications/businesscentral/environments",
      { headers: authHeaders }
    );
    if (res.ok) {
      const json = await res.json();
      const list = json.value ?? [];
      if (list.length === 0) {
        info("La API de administración no devolvió entornos.");
      } else {
        ok(`${list.length} entorno(s):`);
        for (const e of list) info(`- ${e.name}  (${e.type}, ${e.countryCode ?? "?"}, ${e.status})`);
        envCandidates.length = 0;
        envCandidates.push(...list.map((e) => e.name));
      }
    } else {
      info(`No disponible (${res.status}). No es bloqueante: probaré ${envCandidates.join(", ")}.`);
    }
  } catch {
    info("No disponible. No es bloqueante.");
  }
}

// ── 3. Empresas por entorno (API v2.0) ───────────────────────────────────────
title("3) Empresas visibles por la API v2.0");
let found = null;
for (const envName of envCandidates) {
  const baseUrl = `https://api.businesscentral.dynamics.com/v2.0/${tenantId}/${envName}/api/v2.0`;
  let res;
  try {
    res = await fetch(`${baseUrl}/companies`, { headers: authHeaders });
  } catch (e) {
    bad(`${envName}: red — ${e.message}`);
    continue;
  }
  if (res.status === 401 || res.status === 403) {
    bad(`${envName}: ${res.status} — el token es válido pero BC lo rechaza.`);
    info("Causa casi siempre: la aplicación NO está dada de alta o habilitada dentro de");
    info("Business Central. En BC busca 'Microsoft Entra Applications' / 'Aplicacions de");
    info(`Microsoft Entra', crea la entrada con Client ID ${clientId}, ponla en Enabled y`);
    info("asígnale el conjunto de permisos D365 BUS FULL ACCESS.");
    continue;
  }
  if (!res.ok) {
    bad(`${envName}: ${res.status}`);
    info((await res.text()).slice(0, 400));
    continue;
  }
  const json = await res.json();
  const companies = json.value ?? [];
  ok(`${envName}: ${companies.length} empresa(s)`);
  for (const c of companies) info(`- ${c.displayName || c.name}  id=${c.id}`);
  if (!found && companies.length) found = { envName, baseUrl, company: companies[0] };
}

if (!found) {
  title("Resultado");
  bad("No se pudo leer ninguna empresa. Resuelve el punto 3 y vuelve a ejecutar.");
  process.exit(1);
}

// ── 4. Lecturas de prueba sobre la empresa encontrada ────────────────────────
title(`4) Lecturas de prueba en "${found.company.displayName || found.company.name}"`);
const companyBase = `${found.baseUrl}/companies(${found.company.id})`;
for (const [label, path] of [
  ["Información de la empresa", "companyInformation"],
  ["Clientes", "customers?$top=3&$select=number,displayName"],
  ["Artículos", "items?$top=3&$select=number,displayName,unitPrice,inventory"],
  ["Presupuestos de venta", "salesQuotes?$top=3&$select=number,customerNumber,totalAmountIncludingTax"],
]) {
  try {
    const res = await fetch(`${companyBase}/${path}`, { headers: authHeaders });
    if (!res.ok) {
      bad(`${label}: ${res.status}`);
      continue;
    }
    const json = await res.json();
    const n = Array.isArray(json.value) ? json.value.length : 1;
    ok(`${label}: ${n} registro(s) leído(s)`);
    if (Array.isArray(json.value)) {
      for (const r of json.value.slice(0, 3)) {
        info(`- ${r.number ?? ""} ${r.displayName ?? r.customerNumber ?? ""} ${r.unitPrice != null ? `· ${r.unitPrice}` : ""}`.trim());
      }
    }
  } catch (e) {
    bad(`${label}: ${e.message}`);
  }
}

// ── 5. Qué poner en Mobilink ─────────────────────────────────────────────────
title("5) Configuración para Mobilink");
console.log("Variables de entorno (Render o .env local, NUNCA en el repo):");
console.log(`  IH_SECRET__BUSINESS_CENTRAL__AAD_TENANT_ID=${tenantId}`);
console.log(`  IH_SECRET__BUSINESS_CENTRAL__CLIENT_ID=${clientId}`);
console.log(`  IH_SECRET__BUSINESS_CENTRAL__CLIENT_SECRET=<el secreto, sin comillas>`);
console.log("\nConfig del conector (PUT /api/v1/admin/connectors/business-central):");
console.log(
  JSON.stringify(
    {
      enabled: true,
      config: {
        baseUrl: found.baseUrl,
        aadTenantId: tenantId,
        companyId: found.company.id,
        defaultCurrency: found.company.currencyCode || "EUR",
      },
    },
    null,
    2
  )
);
console.log("\nDespués: POST /api/v1/admin/connectors/business-central/test");
console.log("Debe responder ok:true SIN mencionar modo simulación.");
