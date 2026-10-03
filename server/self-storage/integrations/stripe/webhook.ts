/**
 * Webhook de Stripe del módulo: POST /api/self-storage/webhooks/stripe.
 *
 * Lo único que puede dar un cobro por bueno. Garantías:
 *
 *   · FIRMA: sin firma válida, 400 y no se mira el contenido.
 *   · IDEMPOTENCIA: cada evento se guarda por su id en
 *     `self_storage_stripe_events`. Se procesa dentro de UNA transacción que
 *     empieza bloqueando su fila: si Stripe lo reenvía (o llegan dos copias a
 *     la vez), la segunda espera, ve `processed` y no hace nada. Los efectos y
 *     la marca de procesado se confirman juntos o no se confirma ninguno.
 *   · Si algo falla, el evento queda `failed` con el error y se contesta 500:
 *     Stripe lo reintentará y se volverá a procesar desde cero.
 *   · Los eventos que no son de este módulo (la cuenta de Stripe puede ser la
 *     misma que la de Mobilink Assist) quedan `ignored`.
 *
 * Reglas de negocio que se aplican aquí:
 *   · primer cobro SEPA en `processing` → el contrato sigue `pending_payment`
 *     salvo que su política sea `allow_while_processing`;
 *   · una mensualidad en `processing` no es un impago;
 *   · `invoice.payment_failed` de un contrato vivo → factura vencida + impago;
 *   · `invoice.paid` → factura cobrada, impago resuelto, SÓLO el bloqueo de
 *     impago levantado;
 *   · una suscripción cancelada en Stripe NO finaliza el contrato.
 */

import type Stripe from "stripe";
import type { PoolClient } from "pg";
import { pool } from "../../shared/db.ts";
import { auditar, type Actor } from "../../shared/audit.ts";
import { hoyMadrid } from "../../shared/numeracion.ts";
import { leerAjuste } from "../../shared/settings.ts";
import { ErrorSelfStorage } from "../../errors.ts";
import { calcularLinea, type LineaCalculada } from "../../domain/facturacion.ts";
import { desglosarBruto } from "../../domain/facturacion.ts";
import { decidirPrimerCobro, decidirMensualidad } from "../../domain/cobros.ts";
import {
  centimosAEuros,
  clienteDe,
  lineasDeFactura,
  metadataDeFactura,
  paymentIntentDeFactura,
  periodoDeFactura,
  suscripcionDeFactura,
} from "../../domain/stripeMapping.ts";
import { emitir, rectificarEnTx } from "../../modules/facturas/service.ts";
import { aplicarCobro } from "../../modules/pagos/service.ts";
import { abrirImpago } from "../../modules/impagos/service.ts";
import { activarContrato } from "../../modules/contratos/activacion.ts";
import { encolar } from "../../modules/notificaciones/service.ts";
import { pasarela, verificarEvento } from "./pasarela.ts";
import type { FirstSepaPolicy, PaymentMethod } from "../../../../src/modules/self-storage/types/enums.ts";

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Resultado = { estado: "processed" | "ignored"; nota?: string };

const actorStripe = (empresaId: string): Actor => ({ empresaId, userId: "", nombre: "Stripe", tipo: "stripe" });

export const EVENTOS_ATENDIDOS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "invoice.finalized",
  "invoice.paid",
  "invoice.payment_failed",
  "payment_intent.succeeded",
  "payment_intent.processing",
  "payment_intent.payment_failed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "charge.refunded",
] as const;

// ── Entrada ─────────────────────────────────────────────────────────────────

export async function procesarWebhook(cuerpo: Buffer, firma: string | undefined): Promise<{ status: number; body: Record<string, unknown> }> {
  const evento = verificarEvento(cuerpo, firma);
  return procesarEvento(evento);
}

/** Procesa un evento ya verificado (también lo usa el reintento de fallidos). */
export async function procesarEvento(evento: Stripe.Event): Promise<{ status: number; body: Record<string, unknown> }> {
  await pool.query(
    `INSERT INTO self_storage_stripe_events (event_id, event_type, livemode, payload) VALUES ($1,$2,$3,$4)
     ON CONFLICT (event_id) DO NOTHING`,
    [evento.id, evento.type, Boolean(evento.livemode), JSON.stringify(evento)]
  );
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const { rows } = await c.query(`SELECT processing_status FROM self_storage_stripe_events WHERE event_id = $1 FOR UPDATE`, [evento.id]);
    if (rows[0]?.processing_status === "processed" || rows[0]?.processing_status === "ignored") {
      await c.query("ROLLBACK");
      return { status: 200, body: { received: true, duplicate: true } };
    }
    const r = await despachar(c, evento);
    await c.query(
      `UPDATE self_storage_stripe_events SET processing_status = $2, processed_at = now(), attempts = attempts + 1, error_message = $3 WHERE event_id = $1`,
      [evento.id, r.estado, r.nota ?? null]
    );
    await c.query("COMMIT");
    return { status: 200, body: { received: true, result: r.estado } };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    const mensaje = String(e instanceof Error ? e.message : e).slice(0, 1000);
    await pool
      .query(`UPDATE self_storage_stripe_events SET processing_status = 'failed', attempts = attempts + 1, error_message = $2 WHERE event_id = $1`, [evento.id, mensaje])
      .catch(() => {});
    console.error(`[Self Storage] webhook ${evento.type} ${evento.id} falló:`, e);
    return { status: 500, body: { received: true, error: "processing_failed" } };
  } finally {
    c.release();
  }
}

async function despachar(c: PoolClient, e: Stripe.Event): Promise<Resultado> {
  const o = e.data.object as Obj;
  switch (e.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
    case "checkout.session.async_payment_failed":
      return checkoutCompletado(c, o, e.type);
    case "invoice.finalized":
      return (await asegurarFactura(c, o)) ? { estado: "processed" } : { estado: "ignored", nota: "Factura ajena al módulo" };
    case "invoice.paid":
      return facturaPagada(c, o);
    case "invoice.payment_failed":
      return facturaFallida(c, o);
    case "payment_intent.succeeded":
      return paymentIntent(c, o, "succeeded");
    case "payment_intent.processing":
      return paymentIntent(c, o, "processing");
    case "payment_intent.payment_failed":
      return paymentIntent(c, o, "failed");
    case "customer.subscription.updated":
      return suscripcionActualizada(c, o);
    case "customer.subscription.deleted":
      return suscripcionCancelada(c, o);
    case "charge.refunded":
      return cargoReembolsado(c, o);
    default:
      return { estado: "ignored", nota: `Evento ${e.type} no atendido` };
  }
}

// ── Contrato de la suscripción ──────────────────────────────────────────────

type Contrato = {
  id: string;
  empresa_id: string;
  customer_id: string;
  status: string;
  payment_method: PaymentMethod | null;
  first_sepa_payment_access_policy: FirstSepaPolicy;
  tax_rate: number;
  stripe_products: Record<string, { itemType: string; taxRate: number; description: string; billingItemId: string | null; recurring: boolean }>;
  subscription_cancel_requested_at: Date | null;
  contract_number: string;
};

async function contratoPor(c: PoolClient, d: { contractId?: string | null; subscriptionId?: string | null }): Promise<Contrato | null> {
  if (!d.contractId && !d.subscriptionId) return null;
  const { rows } = await c.query(
    `SELECT id, empresa_id, customer_id, status, payment_method, first_sepa_payment_access_policy, tax_rate::float8 AS tax_rate,
            stripe_products, subscription_cancel_requested_at, contract_number
       FROM self_storage_contracts
      WHERE ($1::uuid IS NOT NULL AND id = $1::uuid) OR ($2::text IS NOT NULL AND stripe_subscription_id = $2::text)
      ORDER BY (id = $1::uuid) DESC NULLS LAST LIMIT 1 FOR UPDATE`,
    [d.contractId && /^[0-9a-f-]{36}$/i.test(d.contractId) ? d.contractId : null, d.subscriptionId ?? null]
  );
  return rows[0] ?? null;
}

// ── Facturas de Stripe → facturas nuestras ──────────────────────────────────

/**
 * Nuestra factura para una factura de Stripe: la que ya existe o una nueva
 * emitida con NUESTRA numeración y nuestro desglose. Los importes son los que
 * cobra Stripe (con su prorrateo): base + IVA de cada línea suman exactamente
 * el cargo.
 */
async function asegurarFactura(c: PoolClient, inv: Obj): Promise<{ id: string; contrato: Contrato; status: string } | null> {
  const meta = metadataDeFactura(inv);
  const contrato = await contratoPor(c, { contractId: meta.ss_contract_id, subscriptionId: suscripcionDeFactura(inv) });
  if (!contrato) return null;
  const { rows: ya } = await c.query(`SELECT id, status FROM self_storage_invoices WHERE stripe_invoice_id = $1 FOR UPDATE`, [inv.id]);
  if (ya.length) {
    if (inv.hosted_invoice_url) await c.query(`UPDATE self_storage_invoices SET stripe_hosted_url = $2 WHERE id = $1`, [ya[0].id, inv.hosted_invoice_url]);
    return { id: ya[0].id, contrato, status: ya[0].status };
  }
  const lineasStripe = lineasDeFactura(inv);
  if (!lineasStripe.length || Number(inv.total ?? 0) === 0) return null;
  const lineas: LineaCalculada[] = lineasStripe.map((l) => {
    const p = l.productId ? contrato.stripe_products?.[l.productId] : undefined;
    const tasa = p?.taxRate ?? contrato.tax_rate;
    const bruto = centimosAEuros(l.amountCents);
    const { subtotal } = desglosarBruto(bruto, tasa);
    // Una línea = el importe de Stripe; base + cuota cuadran con él al céntimo.
    const calc = calcularLinea({
      itemType: (p?.itemType ?? (l.periodStart ? "rental" : "other")) as LineaCalculada["itemType"],
      description: (l.description || p?.description || "Concepto") + (l.quantity > 1 ? ` (× ${l.quantity})` : ""),
      quantity: 1,
      unitPrice: subtotal,
      taxRate: tasa,
      billingItemId: p?.billingItemId ?? null,
      periodStart: l.periodStart,
      periodEnd: l.periodEnd,
    });
    // Ajuste de céntimo: la cuota es lo que falta hasta el bruto de Stripe.
    const taxAmount = Math.round((bruto - calc.subtotal) * 100) / 100;
    return { ...calc, taxAmount, total: bruto };
  });
  const periodo = lineas.some((l) => l.itemType === "rental") ? periodoDeFactura(lineasStripe) : null;
  const finalizada = inv.status_transitions?.finalized_at ?? inv.created;
  const r = await emitir(c, actorStripe(contrato.empresa_id), {
    empresaId: contrato.empresa_id,
    customerId: contrato.customer_id,
    contractId: contrato.id,
    kind: periodo ? "rent" : "one_off",
    collection: "stripe",
    lineas,
    periodo,
    issueDate: typeof finalizada === "number" ? hoyMadrid(new Date(finalizada * 1000)) : hoyMadrid(),
    dueDate: typeof inv.due_date === "number" ? hoyMadrid(new Date(inv.due_date * 1000)) : null,
    stripeInvoiceId: inv.id,
    stripeHostedUrl: inv.hosted_invoice_url ?? null,
  });
  await c.query(`UPDATE self_storage_payments SET invoice_id = $1 WHERE stripe_invoice_id = $2 AND invoice_id IS NULL`, [r.id, inv.id]);
  return { id: r.id, contrato, status: "pending" };
}

/** Registro de pago de una factura de Stripe (uno por factura, se actualiza). */
async function pagoDeFacturaStripe(
  c: PoolClient,
  contrato: Contrato,
  d: { stripeInvoiceId: string; invoiceId: string | null; amount: number; status: "processing" | "succeeded" | "failed"; paymentIntent: string | null; failureReason?: string | null; paidAt?: Date | null }
) {
  if (d.amount <= 0) return;
  await c.query(
    `INSERT INTO self_storage_payments
       (empresa_id, customer_id, contract_id, invoice_id, amount, payment_method, stripe_payment_intent_id, stripe_invoice_id, status, paid_at, failure_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (stripe_invoice_id) WHERE stripe_invoice_id IS NOT NULL DO UPDATE SET
       status = CASE
         -- Un cobro confirmado no vuelve atrás por un evento que llega tarde.
         WHEN self_storage_payments.status IN ('succeeded','refunded') THEN self_storage_payments.status
         ELSE EXCLUDED.status END,
       paid_at = COALESCE(self_storage_payments.paid_at, EXCLUDED.paid_at),
       failure_reason = CASE WHEN EXCLUDED.status = 'failed' THEN EXCLUDED.failure_reason ELSE self_storage_payments.failure_reason END,
       invoice_id = COALESCE(self_storage_payments.invoice_id, EXCLUDED.invoice_id),
       stripe_payment_intent_id = COALESCE(self_storage_payments.stripe_payment_intent_id, EXCLUDED.stripe_payment_intent_id),
       amount = EXCLUDED.amount`,
    [
      contrato.empresa_id, contrato.customer_id, contrato.id, d.invoiceId, d.amount, contrato.payment_method ?? "card",
      d.paymentIntent, d.stripeInvoiceId, d.status, d.status === "succeeded" ? (d.paidAt ?? new Date()) : null, d.failureReason ?? null,
    ]
  );
}

async function facturaPagada(c: PoolClient, inv: Obj): Promise<Resultado> {
  const f = await asegurarFactura(c, inv);
  if (!f) return { estado: "ignored", nota: "Factura ajena al módulo o sin importe" };
  const pagadaEn = inv.status_transitions?.paid_at;
  await pagoDeFacturaStripe(c, f.contrato, {
    stripeInvoiceId: inv.id,
    invoiceId: f.id,
    amount: centimosAEuros(Number(inv.amount_paid ?? inv.total ?? 0)),
    status: "succeeded",
    paymentIntent: paymentIntentDeFactura(inv),
    paidAt: typeof pagadaEn === "number" ? new Date(pagadaEn * 1000) : new Date(),
  });
  await aplicarCobro(c, actorStripe(f.contrato.empresa_id), f.id);
  return { estado: "processed" };
}

async function facturaFallida(c: PoolClient, inv: Obj): Promise<Resultado> {
  const f = await asegurarFactura(c, inv);
  if (!f) return { estado: "ignored", nota: "Factura ajena al módulo o sin importe" };
  const motivo = inv.last_finalization_error?.message ?? "El cobro ha fallado o ha sido devuelto";
  await pagoDeFacturaStripe(c, f.contrato, {
    stripeInvoiceId: inv.id,
    invoiceId: f.id,
    amount: centimosAEuros(Number(inv.amount_due ?? inv.total ?? 0)),
    status: "failed",
    paymentIntent: paymentIntentDeFactura(inv),
    failureReason: motivo,
  });
  const actor = actorStripe(f.contrato.empresa_id);
  if (f.contrato.status === "pending_payment") {
    // Primer cobro fallido: el contrato sigue pendiente; no hay impago de un
    // alquiler que no ha empezado.
    await c.query(`UPDATE self_storage_contracts SET first_payment_status = 'failed' WHERE id = $1`, [f.contrato.id]);
    await auditar(c, actor, { action: "contract.first_payment_failed", entityType: "contract", entityId: f.contrato.id, after: { invoiceId: f.id, reason: motivo } });
    return { estado: "processed" };
  }
  if (decidirMensualidad("failed") === "abrir_impago" && ["active", "suspended"].includes(f.contrato.status) && f.status !== "paid") {
    await abrirImpago(c, actor, f.id, motivo);
  }
  return { estado: "processed" };
}

// ── Checkout ────────────────────────────────────────────────────────────────

async function checkoutCompletado(c: PoolClient, s: Obj, tipo: string): Promise<Resultado> {
  const meta = (s.metadata ?? {}) as Record<string, string>;
  if (meta.ss_kind === "contract_subscription") {
    const contrato = await contratoPor(c, { contractId: meta.ss_contract_id });
    if (!contrato || contrato.empresa_id !== meta.ss_empresa_id) return { estado: "ignored", nota: "Contrato desconocido" };
    const actor = actorStripe(contrato.empresa_id);
    const sub = typeof s.subscription === "string" ? s.subscription : s.subscription?.id;
    if (sub) {
      await c.query(`UPDATE self_storage_contracts SET stripe_subscription_id = COALESCE(stripe_subscription_id, $2) WHERE id = $1`, [contrato.id, sub]);
    }
    const factura = typeof s.invoice === "string" ? s.invoice : s.invoice?.id;
    // `unpaid` en un Checkout completado = método asíncrono (SEPA) en proceso.
    if (tipo === "checkout.session.completed" && s.payment_status === "unpaid" && contrato.status === "pending_payment" && factura) {
      await c.query(`UPDATE self_storage_contracts SET first_payment_status = 'processing' WHERE id = $1`, [contrato.id]);
      await pagoDeFacturaStripe(c, contrato, { stripeInvoiceId: factura, invoiceId: null, amount: centimosAEuros(Number(s.amount_total ?? 0)), status: "processing", paymentIntent: null });
      const decision = decidirPrimerCobro(contrato.payment_method ?? "sepa", "processing", contrato.first_sepa_payment_access_policy);
      await auditar(c, actor, { action: "contract.first_payment_processing", entityType: "contract", entityId: contrato.id, after: { policy: contrato.first_sepa_payment_access_policy, decision } });
      if (decision === "activar") await activarContrato(c, actor, contrato.id, { tipo: "sepa_en_proceso" });
    }
    if (tipo === "checkout.session.async_payment_failed" && contrato.status === "pending_payment") {
      await c.query(`UPDATE self_storage_contracts SET first_payment_status = 'failed' WHERE id = $1`, [contrato.id]);
    }
    return { estado: "processed" };
  }
  if (meta.ss_kind === "invoice_payment") {
    const { rows } = await c.query(`SELECT id, empresa_id, customer_id, contract_id FROM self_storage_invoices WHERE id::text = $1 AND empresa_id::text = $2`, [meta.ss_invoice_id, meta.ss_empresa_id]);
    if (!rows.length) return { estado: "ignored", nota: "Factura desconocida" };
    const pi = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id;
    if (!pi) return { estado: "ignored", nota: "Sin PaymentIntent" };
    const estado = s.payment_status === "paid" || tipo === "checkout.session.async_payment_succeeded" ? "succeeded" : tipo.endsWith("failed") ? "failed" : "processing";
    await pagoSuelto(c, rows[0], { paymentIntent: pi, amount: centimosAEuros(Number(s.amount_total ?? 0)), status: estado, method: "card" });
    return { estado: "processed" };
  }
  if (meta.ss_kind === "setup") {
    const setupIntent = typeof s.setup_intent === "string" ? s.setup_intent : s.setup_intent?.id;
    const cliente = clienteDe(s);
    if (!setupIntent || !cliente) return { estado: "ignored", nota: "Setup sin datos" };
    const { rows } = await c.query(
      `SELECT k.stripe_subscription_id FROM self_storage_contracts k JOIN self_storage_customers cu ON cu.id = k.customer_id
        WHERE cu.stripe_customer_id = $1 AND k.stripe_subscription_id IS NOT NULL AND k.status IN ('pending_payment','active','suspended')`,
      [cliente]
    );
    await pasarela().fijarMetodoPorDefecto(cliente, setupIntent, rows.map((r) => r.stripe_subscription_id));
    return { estado: "processed" };
  }
  return { estado: "ignored", nota: "Checkout ajeno al módulo" };
}

/** Pago de una factura NUESTRA (cobro manual) por Checkout/PaymentIntent. */
async function pagoSuelto(
  c: PoolClient,
  f: { id: string; empresa_id: string; customer_id: string; contract_id: string | null },
  d: { paymentIntent: string; amount: number; status: "processing" | "succeeded" | "failed"; method: PaymentMethod; chargeId?: string | null; failureReason?: string | null }
) {
  if (d.amount > 0) {
    await c.query(
      `INSERT INTO self_storage_payments
         (empresa_id, customer_id, contract_id, invoice_id, amount, payment_method, stripe_payment_intent_id, stripe_charge_id, status, paid_at, failure_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (stripe_payment_intent_id) DO UPDATE SET
         status = CASE WHEN self_storage_payments.status IN ('succeeded','refunded') THEN self_storage_payments.status ELSE EXCLUDED.status END,
         paid_at = COALESCE(self_storage_payments.paid_at, EXCLUDED.paid_at),
         stripe_charge_id = COALESCE(self_storage_payments.stripe_charge_id, EXCLUDED.stripe_charge_id),
         failure_reason = CASE WHEN EXCLUDED.status = 'failed' THEN EXCLUDED.failure_reason ELSE self_storage_payments.failure_reason END`,
      [f.empresa_id, f.customer_id, f.contract_id, f.id, d.amount, d.method, d.paymentIntent, d.chargeId ?? null, d.status, d.status === "succeeded" ? new Date() : null, d.failureReason ?? null]
    );
  }
  if (d.status === "succeeded") await aplicarCobro(c, actorStripe(f.empresa_id), f.id);
}

// ── PaymentIntents ──────────────────────────────────────────────────────────

async function paymentIntent(c: PoolClient, pi: Obj, estado: "processing" | "succeeded" | "failed"): Promise<Resultado> {
  const meta = (pi.metadata ?? {}) as Record<string, string>;
  const charge = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id;
  if (meta.ss_kind === "invoice_payment" && meta.ss_invoice_id) {
    const { rows } = await c.query(`SELECT id, empresa_id, customer_id, contract_id FROM self_storage_invoices WHERE id::text = $1 AND empresa_id::text = $2`, [meta.ss_invoice_id, meta.ss_empresa_id ?? ""]);
    if (!rows.length) return { estado: "ignored", nota: "Factura desconocida" };
    const metodo: PaymentMethod = (pi.payment_method_types ?? []).includes("sepa_debit") && !(pi.payment_method_types ?? []).includes("card") ? "sepa" : "card";
    await pagoSuelto(c, rows[0], {
      paymentIntent: pi.id,
      amount: centimosAEuros(Number(estado === "succeeded" ? (pi.amount_received ?? pi.amount) : pi.amount)),
      status: estado,
      method: metodo,
      chargeId: charge ?? null,
      failureReason: pi.last_payment_error?.message ?? null,
    });
    return { estado: "processed" };
  }
  // PaymentIntent de una factura de suscripción: el registro ya lo llevan los
  // eventos invoice.*; aquí sólo se completa el cargo si lo conocemos.
  const { rows } = await c.query(`SELECT id FROM self_storage_payments WHERE stripe_payment_intent_id = $1 FOR UPDATE`, [pi.id]);
  if (!rows.length) return { estado: "ignored", nota: "PaymentIntent gestionado por los eventos de factura" };
  if (charge) await c.query(`UPDATE self_storage_payments SET stripe_charge_id = COALESCE(stripe_charge_id, $2) WHERE id = $1`, [rows[0].id, charge]);
  return { estado: "processed" };
}

// ── Suscripciones ───────────────────────────────────────────────────────────

async function suscripcionActualizada(c: PoolClient, sub: Obj): Promise<Resultado> {
  const contrato = await contratoPor(c, { contractId: sub.metadata?.ss_contract_id, subscriptionId: sub.id });
  if (!contrato) return { estado: "ignored", nota: "Suscripción ajena al módulo" };
  const { rows } = await c.query(
    `UPDATE self_storage_contracts SET stripe_subscription_status = $2, stripe_subscription_id = COALESCE(stripe_subscription_id, $3)
      WHERE id = $1 AND stripe_subscription_status IS DISTINCT FROM $2 RETURNING id`,
    [contrato.id, sub.status, sub.id]
  );
  if (rows.length) {
    await auditar(c, actorStripe(contrato.empresa_id), { action: "contract.subscription_status", entityType: "contract", entityId: contrato.id, after: { subscriptionStatus: sub.status } });
  }
  // A propósito: el estado de la suscripción NO mueve el del contrato. Un
  // `past_due` no suspende; eso lo decide el motor de impagos con sus plazos.
  return { estado: "processed" };
}

async function suscripcionCancelada(c: PoolClient, sub: Obj): Promise<Resultado> {
  const contrato = await contratoPor(c, { contractId: sub.metadata?.ss_contract_id, subscriptionId: sub.id });
  if (!contrato) return { estado: "ignored", nota: "Suscripción ajena al módulo" };
  const actor = actorStripe(contrato.empresa_id);
  await c.query(`UPDATE self_storage_contracts SET stripe_subscription_status = 'canceled' WHERE id = $1`, [contrato.id]);
  if (!contrato.subscription_cancel_requested_at && !["terminated", "cancelled"].includes(contrato.status)) {
    // Stripe la ha cancelado por su cuenta (p. ej. tras agotar reintentos).
    // El contrato NO se finaliza: se avisa para que lo decida una persona.
    await auditar(c, actor, { action: "contract.subscription_cancelled_externally", entityType: "contract", entityId: contrato.id, after: { subscriptionId: sub.id, contractStatus: contrato.status } });
    const em = await leerAjuste(c, contrato.empresa_id, null, "billing.issuer");
    await encolar(c, {
      empresaId: contrato.empresa_id,
      plantilla: "staff.subscription_cancelled",
      dedupeKey: `${contrato.id}:${sub.id}`,
      destinatario: em?.email ?? null,
      contractId: contrato.id,
      datos: { contrato: contrato.contract_number },
    });
  } else {
    await auditar(c, actor, { action: "contract.subscription_cancelled", entityType: "contract", entityId: contrato.id, after: { subscriptionId: sub.id } });
  }
  return { estado: "processed" };
}

// ── Reembolsos ──────────────────────────────────────────────────────────────

async function cargoReembolsado(c: PoolClient, ch: Obj): Promise<Resultado> {
  const pi = typeof ch.payment_intent === "string" ? ch.payment_intent : ch.payment_intent?.id;
  const { rows } = await c.query(
    `SELECT p.id, p.amount::float8 AS amount, p.invoice_id, p.empresa_id, i.status AS invoice_status
       FROM self_storage_payments p LEFT JOIN self_storage_invoices i ON i.id = p.invoice_id
      WHERE p.stripe_charge_id = $1 OR ($2::text IS NOT NULL AND p.stripe_payment_intent_id = $2::text)
      LIMIT 1 FOR UPDATE OF p`,
    [ch.id, pi ?? null]
  );
  const p = rows[0];
  if (!p) return { estado: "ignored", nota: "Cargo ajeno al módulo" };
  const reembolsado = Math.min(p.amount, centimosAEuros(Number(ch.amount_refunded ?? 0)));
  const total = reembolsado >= p.amount;
  await c.query(
    `UPDATE self_storage_payments SET refunded_amount = $2, stripe_charge_id = COALESCE(stripe_charge_id, $3), status = CASE WHEN $4 THEN 'refunded'::self_storage_payment_status ELSE status END WHERE id = $1`,
    [p.id, reembolsado, ch.id, total]
  );
  const actor = actorStripe(p.empresa_id);
  await auditar(c, actor, { action: "payment.refunded", entityType: "invoice", entityId: p.invoice_id, after: { paymentId: p.id, refunded: reembolsado, full: total } });
  if (total && p.invoice_id && p.invoice_status === "paid") {
    // La factura cobrada y devuelta se rectifica: nunca se toca la original.
    await rectificarEnTx(c, actor, p.invoice_id, "Cobro reembolsado", "refunded");
  }
  return { estado: "processed" };
}

// ── Reintento de fallidos (trabajo programado) ──────────────────────────────

export async function reintentarFallidos(limite = 20): Promise<number> {
  const { rows } = await pool.query(
    `SELECT payload FROM self_storage_stripe_events WHERE processing_status = 'failed' AND attempts < 8 ORDER BY received_at LIMIT $1`,
    [limite]
  );
  let n = 0;
  for (const r of rows) {
    const res = await procesarEvento(r.payload as Stripe.Event);
    if (res.status === 200) n++;
  }
  return n;
}

export { ErrorSelfStorage };
