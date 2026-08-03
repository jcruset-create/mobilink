/**
 * bc-quote — primera entrega funcional (§4) desde la línea de comandos:
 * crea un presupuesto de venta en Business Central a partir de una OT de Mobilink.
 *
 * Pasa por el Hub (SalesQuoteService), igual que lo haría la app: no habla con BC directamente,
 * así que la operación queda auditada en integration_operations como cualquier otra.
 *
 * Uso:
 *   npm run bc:quote                                   ← sugiere clientes/artículos reales y sale
 *   npm run bc:quote -- --customer 10000 --item 1896-S
 *   npm run bc:quote -- --customer 10000 --item 1896-S --qty 2 --ot OT-000548
 */

import dotenv from "dotenv";
dotenv.config();

import { initIntegrationHub } from "../server/integration-hub/infrastructure/schema.ts";
import { resolveErpConnector } from "../server/integration-hub/connectors/ConnectorRegistry.ts";
import { nextCorrelationId } from "../server/integration-hub/infrastructure/repositories.ts";
import { createQuoteFromWorkOrder } from "../server/integration-hub/application/services/SalesQuoteService.ts";

const ok = (m: string) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const bad = (m: string) => console.log(`\x1b[31m✗\x1b[0m ${m}`);
const info = (m: string) => console.log(`  ${m}`);
const title = (m: string) => console.log(`\n\x1b[1m${m}\x1b[0m`);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const tenantId = arg("tenant") || process.env.BC_MOBILINK_TENANT || "TENANT-001";
const customerId = arg("customer");
const itemId = arg("item");
const qty = Number(arg("qty") || 1);
const workOrderId = arg("ot") || "OT-000548";

async function main() {
  await initIntegrationHub();
  const resolved = await resolveErpConnector(tenantId);

  if (resolved.usingDefault) {
    bad("No hay conector ERP configurado para este tenant: ejecuta antes  npm run bc:setup");
    process.exit(1);
  }

  // Sin argumentos: enseñar qué clientes y artículos existen de verdad en la empresa.
  if (!customerId || !itemId) {
    title("Clientes y artículos disponibles");
    const ctx = { tenantId, correlationId: await nextCorrelationId() };
    const [customers, products] = await Promise.all([
      resolved.connector.getCustomers(ctx),
      resolved.connector.getProducts(ctx),
    ]);
    console.log("Clientes (primeros 5):");
    for (const c of customers.slice(0, 5)) info(`--customer ${c.externalId}   ${c.name}`);
    console.log("Artículos (primeros 5):");
    for (const p of products.slice(0, 5)) info(`--item ${p.externalId}   ${p.name}`);
    title("Ejemplo");
    console.log(
      `npm run bc:quote -- --customer ${customers[0]?.externalId ?? "<nº cliente>"} --item ${
        products[0]?.externalId ?? "<nº artículo>"
      }`
    );
    return;
  }

  title(`Creando presupuesto en Business Central (OT ${workOrderId})`);
  const result = await createQuoteFromWorkOrder({
    tenantId,
    workOrderId,
    customerId,
    reference: workOrderId,
    lines: [{ externalProductId: itemId, quantity: qty }],
  });

  if (result.simulated) {
    bad("La operación se resolvió en MODO SIMULACIÓN: no hay nada creado en Business Central.");
    info("Ejecuta  npm run bc:setup  y comprueba que la prueba de conexión sale sin simulación.");
    process.exitCode = 1;
  } else {
    ok(`Presupuesto creado en Business Central: ${result.businessCentralQuoteNumber}`);
  }
  info(`mobilinkQuoteId: ${result.mobilinkQuoteId}`);
  info(`correlationId:   ${result.correlationId}`);
  info(`total:           ${result.totalAmount} ${result.currency}`);
  title("Comprobación");
  console.log("Abre Business Central → Vendes → Pressupostos de venda y busca ese número.");
}

main()
  .catch((e) => {
    bad(e?.message ?? String(e));
    if (e?.details) info(String(e.details).slice(0, 500));
    process.exit(1);
  })
  .finally(() => process.exit(process.exitCode ?? 0));
