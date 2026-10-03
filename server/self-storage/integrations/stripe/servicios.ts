/**
 * Servicios de Stripe del módulo: cliente, métodos de pago y pago de facturas
 * sueltas. La suscripción de un contrato se crea desde contratos/service.ts
 * (`checkoutPrimerCobro`). Nada de esto marca un pago como bueno: eso sólo lo
 * hace el webhook firmado.
 */

import { pool } from "../../shared/db.ts";
import { auditar, type Actor } from "../../shared/audit.ts";
import { ErrorSelfStorage, noExiste } from "../../errors.ts";
import { nombreCliente } from "../../modules/facturas/service.ts";
import { eurosACentimos } from "../../domain/stripeMapping.ts";
import { pasarela, type TipoMetodo } from "./pasarela.ts";

/** Recupera o crea el Customer de Stripe del cliente (uno por cliente). */
export async function asegurarClienteStripe(empresaId: string, customerId: string): Promise<string> {
  const { rows } = await pool.query(
    `SELECT id, stripe_customer_id, email, customer_type, first_name, last_name, company_name
       FROM self_storage_customers WHERE empresa_id = $1 AND id = $2`,
    [empresaId, customerId]
  );
  const c = rows[0];
  if (!c) throw noExiste("El cliente");
  if (c.stripe_customer_id) return c.stripe_customer_id;
  const creado = await pasarela().crearCliente({
    email: c.email,
    name: nombreCliente(c),
    metadata: { ss_customer_id: c.id, ss_empresa_id: empresaId },
    // Misma clave de idempotencia: un doble clic no crea dos clientes en Stripe.
    idempotencyKey: `ss-customer-${c.id}`,
  });
  // Si otro proceso lo guardó a la vez, gana el primero y nos quedamos con ése.
  const { rows: g } = await pool.query(
    `UPDATE self_storage_customers SET stripe_customer_id = COALESCE(stripe_customer_id, $2) WHERE id = $1 RETURNING stripe_customer_id`,
    [c.id, creado.id]
  );
  return g[0].stripe_customer_id;
}

export async function metodosDePago(empresaId: string, customerId: string) {
  const { rows } = await pool.query(`SELECT stripe_customer_id FROM self_storage_customers WHERE empresa_id = $1 AND id = $2`, [empresaId, customerId]);
  if (!rows.length) throw noExiste("El cliente");
  if (!rows[0].stripe_customer_id) return [];
  return pasarela().listarMetodosPago(rows[0].stripe_customer_id);
}

/** Checkout en modo setup para añadir/cambiar la tarjeta o la cuenta SEPA. */
export async function checkoutMetodo(empresaId: string, customerId: string, urls: { successUrl: string; cancelUrl: string }) {
  const stripeCustomer = await asegurarClienteStripe(empresaId, customerId);
  const metodos: TipoMetodo[] = ["card", "sepa_debit"];
  return pasarela().crearCheckoutMetodo({
    customerId: stripeCustomer,
    metodos,
    metadata: { ss_kind: "setup", ss_customer_id: customerId, ss_empresa_id: empresaId },
    ...urls,
  });
}

/**
 * Pagar una factura pendiente desde el portal o el panel:
 *   · si la cobra Stripe (suscripción), su página de pago de Stripe;
 *   · si es de cobro manual, un Checkout en modo pago (PaymentIntent) por el
 *     importe pendiente, con el id de NUESTRA factura en los metadatos.
 */
export async function pagarFactura(actor: Actor, invoiceId: string, urls: { successUrl: string; cancelUrl: string }, soloCliente?: string) {
  const { rows } = await pool.query(
    `SELECT id, customer_id, status, total::float8 AS total, invoice_number, stripe_invoice_id, stripe_hosted_url
       FROM self_storage_invoices WHERE empresa_id = $1 AND id = $2 ${soloCliente ? "AND customer_id = $3" : ""}`,
    soloCliente ? [actor.empresaId, invoiceId, soloCliente] : [actor.empresaId, invoiceId]
  );
  const f = rows[0];
  if (!f || f.status === "draft") throw noExiste("La factura");
  if (!["pending", "overdue"].includes(f.status)) throw new ErrorSelfStorage("FACTURA_NO_PENDIENTE", "Esta factura no está pendiente de pago.", 409);
  if (f.stripe_invoice_id) {
    if (!f.stripe_hosted_url) throw new ErrorSelfStorage("SIN_ENLACE_DE_PAGO", "Stripe no ha facilitado el enlace de pago de esta factura.", 409);
    return { url: f.stripe_hosted_url as string };
  }
  const stripeCustomer = await asegurarClienteStripe(actor.empresaId, f.customer_id);
  const s = await pasarela().crearCheckoutPago({
    customerId: stripeCustomer,
    amountCents: eurosACentimos(f.total),
    description: `Factura ${f.invoice_number}`,
    metodos: ["card"],
    metadata: { ss_kind: "invoice_payment", ss_invoice_id: f.id, ss_empresa_id: actor.empresaId },
    ...urls,
    idempotencyKey: `ss-pay-${f.id}-${Date.now() >> 16}`,
  });
  await auditar(pool, actor, { action: "invoice.payment_link_created", entityType: "invoice", entityId: f.id, after: { sessionId: s.id } });
  return { url: s.url };
}
