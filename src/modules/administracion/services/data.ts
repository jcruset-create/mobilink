import { supabase } from "./supabase";
import type {
  Customer, WorkOrder, Invoice, Payment, PaymentMethod, PaymentTracking,
  TrackingAction, RecoveryCase, RecoveryAction, TrackingStatus, RecoveryStatus,
  RecoveryPriority, Centro,
} from "../types";

function fail(msg: string | undefined, ctx: string): never {
  throw new Error(`[Administración] ${ctx}: ${msg ?? "error desconocido"}`);
}

// ── Formas de pago ───────────────────────────────────────────
export async function listPaymentMethods(soloActivas = false): Promise<PaymentMethod[]> {
  let q = supabase.from("adm_payment_methods").select("*").order("sort_order");
  if (soloActivas) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) fail(error.message, "formas de pago");
  return (data ?? []) as PaymentMethod[];
}

export async function savePaymentMethod(m: Partial<PaymentMethod> & { name: string }): Promise<void> {
  const { error } = m.id
    ? await supabase.from("adm_payment_methods").update({ name: m.name, active: m.active, sort_order: m.sort_order }).eq("id", m.id)
    : await supabase.from("adm_payment_methods").insert({ name: m.name, active: m.active ?? true, sort_order: m.sort_order ?? 0 });
  if (error) fail(error.message, "guardar forma de pago");
}

// ── Clientes ─────────────────────────────────────────────────
export async function listCustomers(filtro?: string): Promise<Customer[]> {
  let q = supabase.from("adm_customers").select("*").order("name");
  if (filtro?.trim()) q = q.or(`name.ilike.%${filtro.trim()}%,tax_id.ilike.%${filtro.trim()}%`);
  const { data, error } = await q;
  if (error) fail(error.message, "clientes");
  return (data ?? []) as Customer[];
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const { data, error } = await supabase.from("adm_customers").select("*").eq("id", id).maybeSingle();
  if (error) fail(error.message, "cliente");
  return (data as Customer | null) ?? null;
}

export async function saveCustomer(c: Partial<Customer> & { name: string }): Promise<string> {
  const payload = {
    name: c.name,
    tax_id: c.tax_id ?? null,
    phone: c.phone ?? null,
    email: c.email ?? null,
    payment_method: c.payment_method ?? null,
    has_direct_debit: c.has_direct_debit ?? false,
    requires_payment_tracking: c.requires_payment_tracking ?? true,
    expected_payment_days: c.expected_payment_days ?? 30,
    admin_email: c.admin_email ?? null,
    admin_phone: c.admin_phone ?? null,
    payment_contact_name: c.payment_contact_name ?? null,
    internal_credit_limit: c.internal_credit_limit ?? null,
    economic_notes: c.economic_notes ?? null,
  };
  if (c.id) {
    const { error } = await supabase.from("adm_customers").update(payload).eq("id", c.id);
    if (error) fail(error.message, "actualizar cliente");
    return c.id;
  }
  const { data, error } = await supabase.from("adm_customers").insert(payload).select("id").single();
  if (error) fail(error.message, "crear cliente");
  return (data as { id: string }).id;
}

// ── OTs y facturas ───────────────────────────────────────────
export async function listWorkOrders(customerId?: string): Promise<WorkOrder[]> {
  let q = supabase.from("adm_work_orders")
    .select("*, customer:adm_customers(*)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (customerId) q = q.eq("customer_id", customerId);
  const { data, error } = await q;
  if (error) fail(error.message, "órdenes de trabajo");
  return (data ?? []) as WorkOrder[];
}

export async function saveWorkOrder(w: Partial<WorkOrder> & { customer_id: string }): Promise<void> {
  const payload = {
    customer_id: w.customer_id,
    ot_number: w.ot_number ?? null,
    vehicle_plate: w.vehicle_plate ?? null,
    status: w.status ?? "abierta",
    total_amount: w.total_amount ?? 0,
    center: w.center ?? "tarragona",
  };
  const { error } = w.id
    ? await supabase.from("adm_work_orders").update(payload).eq("id", w.id)
    : await supabase.from("adm_work_orders").insert(payload);
  if (error) fail(error.message, "guardar OT");
}

export async function cerrarWorkOrder(id: string): Promise<void> {
  const { error } = await supabase.from("adm_work_orders")
    .update({ status: "cerrada", closed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) fail(error.message, "cerrar OT");
}

export async function listInvoices(customerId?: string): Promise<Invoice[]> {
  let q = supabase.from("adm_invoices")
    .select("*, customer:adm_customers(*)")
    .order("invoice_date", { ascending: false })
    .limit(300);
  if (customerId) q = q.eq("customer_id", customerId);
  const { data, error } = await q;
  if (error) fail(error.message, "facturas");
  return (data ?? []) as Invoice[];
}

export async function saveInvoice(f: Partial<Invoice> & { customer_id: string; invoice_number: string }): Promise<void> {
  if (f.id) {
    const { error } = await supabase.from("adm_invoices").update({
      invoice_number: f.invoice_number,
      invoice_date: f.invoice_date,
      due_date: f.due_date ?? null,
      total_amount: f.total_amount ?? 0,
    }).eq("id", f.id);
    if (error) fail(error.message, "actualizar factura");
    return;
  }
  const total = f.total_amount ?? 0;
  const { error } = await supabase.from("adm_invoices").insert({
    customer_id: f.customer_id,
    work_order_id: f.work_order_id ?? null,
    invoice_number: f.invoice_number,
    invoice_date: f.invoice_date ?? new Date().toISOString().slice(0, 10),
    due_date: f.due_date ?? null,
    total_amount: total,
    pending_amount: total,
  });
  if (error) fail(error.message, "crear factura");
}

// ── Cobros ───────────────────────────────────────────────────
export type FiltroCobros = {
  desde: string;
  hasta: string;
  customerId?: string;
  center?: Centro | "";
  paymentMethod?: string;
};

export async function listPayments(f: FiltroCobros): Promise<Payment[]> {
  let q = supabase.from("adm_payments")
    .select("*, customer:adm_customers(*), work_order:adm_work_orders(*), invoice:adm_invoices(*), registered_by_user:adm_usuarios(nombre)")
    .gte("payment_date", f.desde)
    .lte("payment_date", f.hasta)
    .order("created_at", { ascending: false });
  if (f.customerId) q = q.eq("customer_id", f.customerId);
  if (f.center) q = q.eq("center", f.center);
  if (f.paymentMethod) q = q.eq("payment_method", f.paymentMethod);
  const { data, error } = await q;
  if (error) fail(error.message, "cobros");
  return (data ?? []) as Payment[];
}

export type NuevoCobro = {
  id?: string;
  customer_id: string | null;
  work_order_id: string | null;
  invoice_id: string | null;
  payment_date: string;
  amount: number;
  payment_method: string;
  reference: string | null;
  center: Centro;
  notes: string | null;
};

export async function saveCobro(c: NuevoCobro, userId: string | null): Promise<void> {
  if (c.id) {
    const { id, ...payload } = c;
    const { error } = await supabase.from("adm_payments").update(payload).eq("id", id);
    if (error) fail(error.message, "editar cobro");
    return;
  }
  const { error } = await supabase.from("adm_payments").insert({ ...c, registered_by: userId });
  if (error) fail(error.message, "registrar cobro");
}

export async function anularCobro(id: string, motivo: string): Promise<void> {
  const { error } = await supabase.from("adm_payments")
    .update({ is_cancelled: true, cancellation_reason: motivo })
    .eq("id", id);
  if (error) fail(error.message, "anular cobro");
}

// ── Seguimiento de pagos ─────────────────────────────────────
export async function listTracking(incluirCerrados = false): Promise<PaymentTracking[]> {
  let q = supabase.from("adm_payment_tracking")
    .select("*, customer:adm_customers(*), work_order:adm_work_orders(*), invoice:adm_invoices(*), responsible:adm_usuarios(nombre)")
    .order("expected_payment_date", { ascending: true, nullsFirst: false });
  if (!incluirCerrados) q = q.is("closed_at", null);
  const { data, error } = await q;
  if (error) fail(error.message, "seguimiento de pagos");
  return (data ?? []) as PaymentTracking[];
}

export async function updateTracking(id: string, patch: Partial<PaymentTracking>): Promise<void> {
  const { error } = await supabase.from("adm_payment_tracking").update(patch).eq("id", id);
  if (error) fail(error.message, "actualizar seguimiento");
}

export async function cambiarEstadoTracking(id: string, status: TrackingStatus, userId: string | null, nota?: string): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (status === "cerrado" || status === "pago_confirmado") patch.closed_at = new Date().toISOString();
  const { error } = await supabase.from("adm_payment_tracking").update(patch).eq("id", id);
  if (error) fail(error.message, "cambiar estado de seguimiento");
  await addTrackingAction(id, "cambio_estado", userId, nota ?? `Estado cambiado a: ${status}`);
}

export async function addTrackingAction(
  trackingId: string, actionType: string, userId: string | null, notes?: string, nextActionDate?: string
): Promise<void> {
  const { error } = await supabase.from("adm_payment_tracking_actions").insert({
    payment_tracking_id: trackingId,
    action_type: actionType,
    user_id: userId,
    notes: notes ?? null,
    next_action_date: nextActionDate ?? null,
  });
  if (error) fail(error.message, "registrar acción de seguimiento");
  if (nextActionDate) {
    await supabase.from("adm_payment_tracking").update({ next_action_date: nextActionDate }).eq("id", trackingId);
  }
}

export async function listTrackingActions(trackingId: string): Promise<TrackingAction[]> {
  const { data, error } = await supabase.from("adm_payment_tracking_actions")
    .select("*, user:adm_usuarios(nombre)")
    .eq("payment_tracking_id", trackingId)
    .order("action_date", { ascending: false });
  if (error) fail(error.message, "historial de seguimiento");
  return (data ?? []) as TrackingAction[];
}

export async function pasarARecobro(trackingId: string): Promise<string> {
  const { data, error } = await supabase.rpc("adm_pasar_a_recobro", { p_tracking_id: trackingId });
  if (error) fail(error.message, "pasar a recobro");
  return data as string;
}

// Seguimientos abiertos de un cliente (para la ficha)
export async function supabaseTrackingDelCliente(customerId: string): Promise<PaymentTracking[]> {
  const { data, error } = await supabase.from("adm_payment_tracking")
    .select("*, invoice:adm_invoices(*), work_order:adm_work_orders(*)")
    .eq("customer_id", customerId)
    .is("closed_at", null)
    .order("expected_payment_date", { ascending: true });
  if (error) fail(error.message, "seguimientos del cliente");
  return (data ?? []) as PaymentTracking[];
}

// Recobros abiertos de un cliente (para la ficha)
export async function supabaseRecobrosDelCliente(customerId: string): Promise<RecoveryCase[]> {
  const { data, error } = await supabase.from("adm_recovery_cases")
    .select("*, invoice:adm_invoices(*), work_order:adm_work_orders(*)")
    .eq("customer_id", customerId)
    .is("closed_at", null)
    .order("due_date", { ascending: true });
  if (error) fail(error.message, "recobros del cliente");
  return (data ?? []) as RecoveryCase[];
}

// ── Recobros ─────────────────────────────────────────────────
export async function listRecoveryCases(incluirCerrados = false): Promise<RecoveryCase[]> {
  let q = supabase.from("adm_recovery_cases")
    .select("*, customer:adm_customers(*), invoice:adm_invoices(*), work_order:adm_work_orders(*), responsible:adm_usuarios(nombre)")
    .order("due_date", { ascending: true, nullsFirst: false });
  if (!incluirCerrados) q = q.is("closed_at", null);
  const { data, error } = await q;
  if (error) fail(error.message, "recobros");
  return (data ?? []) as RecoveryCase[];
}

export async function updateRecovery(id: string, patch: Partial<RecoveryCase>): Promise<void> {
  const { error } = await supabase.from("adm_recovery_cases").update(patch).eq("id", id);
  if (error) fail(error.message, "actualizar recobro");
}

export async function cambiarEstadoRecovery(
  id: string, status: RecoveryStatus, userId: string | null, nota?: string
): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (status === "cerrado" || status === "pago_recibido") patch.closed_at = new Date().toISOString();
  const { error } = await supabase.from("adm_recovery_cases").update(patch).eq("id", id);
  if (error) fail(error.message, "cambiar estado de recobro");
  await addRecoveryAction(id, "cambio_estado", userId, nota ?? `Estado cambiado a: ${status}`);
}

export async function cambiarPrioridadRecovery(id: string, priority: RecoveryPriority): Promise<void> {
  const { error } = await supabase.from("adm_recovery_cases").update({ priority }).eq("id", id);
  if (error) fail(error.message, "cambiar prioridad");
}

export async function addRecoveryAction(
  caseId: string, actionType: string, userId: string | null, notes?: string, nextActionDate?: string
): Promise<void> {
  const { error } = await supabase.from("adm_recovery_actions").insert({
    recovery_case_id: caseId,
    action_type: actionType,
    user_id: userId,
    notes: notes ?? null,
    next_action_date: nextActionDate ?? null,
  });
  if (error) fail(error.message, "registrar gestión de recobro");
  if (nextActionDate) {
    await supabase.from("adm_recovery_cases").update({ next_action_date: nextActionDate }).eq("id", caseId);
  }
}

export async function listRecoveryActions(caseId: string): Promise<RecoveryAction[]> {
  const { data, error } = await supabase.from("adm_recovery_actions")
    .select("*, user:adm_usuarios(nombre)")
    .eq("recovery_case_id", caseId)
    .order("action_date", { ascending: false });
  if (error) fail(error.message, "historial de recobro");
  return (data ?? []) as RecoveryAction[];
}

// ── Registrar pago desde seguimiento/recobro ─────────────────
// Crea el cobro (los triggers de BD recalculan pendientes y cierran si llega a 0).
export async function registrarPagoVinculado(opts: {
  customerId: string;
  workOrderId: string | null;
  invoiceId: string | null;
  amount: number;
  paymentMethod: string;
  center: Centro;
  userId: string | null;
  notes?: string;
}): Promise<void> {
  const { error } = await supabase.from("adm_payments").insert({
    customer_id: opts.customerId,
    work_order_id: opts.workOrderId,
    invoice_id: opts.invoiceId,
    payment_date: new Date().toISOString().slice(0, 10),
    amount: opts.amount,
    payment_method: opts.paymentMethod,
    center: opts.center,
    registered_by: opts.userId,
    notes: opts.notes ?? null,
  });
  if (error) fail(error.message, "registrar pago");
}
