/**
 * Pagos: el registro de cada cobro y lo que provoca.
 *
 * Un pago NUNCA lo da por bueno el frontend. Llega por dos caminos:
 *   · Stripe, por webhook firmado (tarjeta y SEPA);
 *   · un empleado que registra un efectivo o una transferencia.
 *
 * `aplicarCobro` es lo común: factura `paid`, impago resuelto (sólo el bloqueo
 * de impago), y si era el primer cobro de un contrato pendiente, activación.
 */

import type { z } from "zod";
import { auditar, type Actor } from "../../shared/audit.ts";
import { enTx, pool, type Ejecutor } from "../../shared/db.ts";
import { ErrorSelfStorage, noExiste } from "../../errors.ts";
import { resolverImpagoDeFactura } from "../impagos/service.ts";
import { activarContrato } from "../contratos/activacion.ts";
import { encolar } from "../notificaciones/service.ts";
import type { pagoManual } from "../../schemas.ts";

const eur = (v: number) => `${Number(v).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/**
 * La factura queda cobrada. Idempotente: si ya lo estaba, no hace nada (un
 * segundo aviso del mismo cobro no duplica efectos).
 */
export async function aplicarCobro(c: Ejecutor, actor: Actor, invoiceId: string): Promise<boolean> {
  const { rows } = await c.query(
    `SELECT i.id, i.status, i.contract_id, i.customer_id, i.empresa_id, i.invoice_number, i.total, i.customer_name, cu.email,
            k.status AS contract_status
       FROM self_storage_invoices i
       JOIN self_storage_customers cu ON cu.id = i.customer_id
       LEFT JOIN self_storage_contracts k ON k.id = i.contract_id
      WHERE i.id = $1 FOR UPDATE OF i`,
    [invoiceId]
  );
  const f = rows[0];
  if (!f) throw noExiste("La factura");
  if (f.status === "paid" || f.status === "refunded") return false;
  if (f.status === "cancelled") {
    // Cobro de una factura ya anulada: se registra el pago, pero no se
    // resucita la factura. Lo verá una persona.
    await auditar(c, actor, { action: "payment.on_cancelled_invoice", entityType: "invoice", entityId: invoiceId });
    return false;
  }
  await c.query(`UPDATE self_storage_invoices SET status = 'paid', paid_at = now() WHERE id = $1`, [invoiceId]);
  await auditar(c, actor, { action: "invoice.paid", entityType: "invoice", entityId: invoiceId, before: { status: f.status }, after: { status: "paid" } });
  await resolverImpagoDeFactura(c, actor, invoiceId, "paid");
  if (f.contract_id && f.contract_status === "pending_payment") {
    await c.query(`UPDATE self_storage_contracts SET first_payment_status = 'succeeded' WHERE id = $1`, [f.contract_id]);
    await activarContrato(c, actor, f.contract_id, { tipo: "pago" });
  }
  await encolar(c, {
    empresaId: f.empresa_id,
    plantilla: "payment.succeeded",
    dedupeKey: invoiceId,
    destinatario: f.email,
    customerId: f.customer_id,
    contractId: f.contract_id,
    invoiceId,
    datos: { cliente: f.customer_name, factura: f.invoice_number, importe: eur(f.total) },
  });
  return true;
}

/** Efectivo o transferencia, registrado por un empleado. */
export function registrarPagoManual(actor: Actor, d: z.infer<typeof pagoManual>) {
  return enTx(async (c) => {
    const { rows } = await c.query(
      `SELECT id, customer_id, contract_id, status, total::float8 AS total, stripe_invoice_id, collection_method
         FROM self_storage_invoices WHERE empresa_id = $1 AND id = $2 FOR UPDATE`,
      [actor.empresaId, d.invoiceId]
    );
    const f = rows[0];
    if (!f) throw noExiste("La factura");
    if (f.status === "paid") throw new ErrorSelfStorage("FACTURA_YA_PAGADA", "Esta factura ya está pagada: no se registra otro pago.", 409);
    if (!["pending", "overdue"].includes(f.status)) throw new ErrorSelfStorage("FACTURA_NO_COBRABLE", `No se cobra una factura en estado «${f.status}».`, 409);
    if (f.stripe_invoice_id) {
      throw new ErrorSelfStorage("FACTURA_DE_STRIPE", "Esta factura la cobra Stripe. Un pago a mano la dejaría descuadrada con Stripe.", 409);
    }
    const { rows: p } = await c.query(
      `INSERT INTO self_storage_payments (empresa_id, customer_id, contract_id, invoice_id, amount, payment_method, status, paid_at, recorded_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6,'succeeded',$7,$8,$9) RETURNING id`,
      [actor.empresaId, f.customer_id, f.contract_id, f.id, f.total, d.paymentMethod, d.paidAt ?? new Date().toISOString(), actor.userId, d.notes ?? null]
    );
    await auditar(c, actor, { action: "payment.recorded", entityType: "invoice", entityId: f.id, after: { paymentId: p[0].id, method: d.paymentMethod, amount: f.total } });
    await aplicarCobro(c, actor, f.id);
    return { id: p[0].id };
  });
}

export async function listar(empresaId: string, f: { customerId?: string; contractId?: string; invoiceId?: string; status?: string; limit?: number; offset?: number }, db: Ejecutor = pool) {
  const cond = ["p.empresa_id = $1"];
  const v: unknown[] = [empresaId];
  const add = (col: string, val: unknown) => {
    v.push(val);
    cond.push(`${col} = $${v.length}`);
  };
  if (f.customerId) add("p.customer_id", f.customerId);
  if (f.contractId) add("p.contract_id", f.contractId);
  if (f.invoiceId) add("p.invoice_id", f.invoiceId);
  if (f.status) add("p.status", f.status);
  const { rows } = await db.query(
    `SELECT p.id, p.customer_id AS "customerId", p.contract_id AS "contractId", p.invoice_id AS "invoiceId",
            p.amount::float8 AS amount, p.refunded_amount::float8 AS "refundedAmount", p.currency, p.payment_method AS "paymentMethod",
            p.status, p.paid_at AS "paidAt", p.failure_reason AS "failureReason", p.stripe_payment_intent_id AS "stripePaymentIntentId",
            p.stripe_invoice_id AS "stripeInvoiceId", p.created_at AS "createdAt", i.invoice_number AS "invoiceNumber",
            CASE WHEN cu.customer_type = 'company' THEN cu.company_name ELSE btrim(coalesce(cu.first_name,'') || ' ' || coalesce(cu.last_name,'')) END AS "customerName"
       FROM self_storage_payments p
       JOIN self_storage_customers cu ON cu.id = p.customer_id
       LEFT JOIN self_storage_invoices i ON i.id = p.invoice_id
      WHERE ${cond.join(" AND ")}
      ORDER BY p.created_at DESC LIMIT ${Math.min(f.limit ?? 100, 200)} OFFSET ${f.offset ?? 0}`,
    v
  );
  return rows;
}

/** Deuda viva de un cliente: lo emitido y no cobrado. */
export async function deuda(empresaId: string, customerId: string, db: Ejecutor = pool) {
  const { rows } = await db.query(
    `SELECT coalesce(sum(total) FILTER (WHERE status IN ('pending','overdue')), 0)::float8 AS pendiente,
            coalesce(sum(total) FILTER (WHERE status = 'overdue'), 0)::float8 AS vencida,
            count(*) FILTER (WHERE status IN ('pending','overdue'))::int AS facturas
       FROM self_storage_invoices WHERE empresa_id = $1 AND customer_id = $2`,
    [empresaId, customerId]
  );
  return rows[0] as { pendiente: number; vencida: number; facturas: number };
}
