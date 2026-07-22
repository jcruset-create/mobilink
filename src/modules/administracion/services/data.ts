import { apiFetch } from "../../apiFetch";
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
  if (filtro?.trim()) q = q.or(`name.ilike.%${filtro.trim()}%,tax_id.ilike.%${filtro.trim()}%,customer_code.ilike.%${filtro.trim()}%`);
  const { data, error } = await q;
  if (error) fail(error.message, "clientes");
  return (data ?? []) as Customer[];
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const { data, error } = await supabase.from("adm_customers").select("*").eq("id", id).maybeSingle();
  if (error) fail(error.message, "cliente");
  return (data as Customer | null) ?? null;
}

// Guarda vía RPC: la identidad va a la tabla maestra 'clientes' (compartida
// con toda la aplicación) y los campos económicos a adm_customers.
export async function saveCustomer(c: Partial<Customer> & { name: string }): Promise<string> {
  const { data, error } = await supabase.rpc("adm_guardar_cliente", {
    p_id: c.id ?? null,
    p_nombre: c.name,
    p_codigo: c.customer_code ?? null,
    p_nif: c.tax_id ?? null,
    p_telefono: c.phone ?? null,
    p_email: c.email ?? null,
    p_payment_method: c.payment_method ?? null,
    p_has_direct_debit: c.has_direct_debit ?? false,
    p_requires_tracking: c.requires_payment_tracking ?? true,
    p_expected_days: c.expected_payment_days ?? 30,
    p_admin_email: c.admin_email ?? null,
    p_admin_phone: c.admin_phone ?? null,
    p_payment_contact: c.payment_contact_name ?? null,
    p_credit_limit: c.internal_credit_limit ?? null,
    p_notes: c.economic_notes ?? null,
  });
  if (error) fail(error.message, "guardar cliente");
  return data as string;
}

// Elimina en la tabla maestra 'clientes' (solo rol admin; la RPC valida
// que no tenga movimientos antes de borrar).
export async function deleteCustomer(id: string): Promise<void> {
  const { error } = await supabase.rpc("adm_eliminar_cliente", { p_id: id });
  if (error) fail(error.message, "eliminar cliente");
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

// ── Destinatarios internos de avisos WhatsApp ────────────────
export type Destinatario = { id: string; nombre: string; telefono: string; activo: boolean };

export async function listDestinatarios(): Promise<Destinatario[]> {
  const { data, error } = await supabase.from("adm_notificacion_destinatarios")
    .select("*").order("nombre");
  if (error) fail(error.message, "destinatarios de avisos");
  return (data ?? []) as Destinatario[];
}

export async function saveDestinatario(d: Partial<Destinatario> & { nombre: string; telefono: string }): Promise<void> {
  const payload = { nombre: d.nombre, telefono: d.telefono, activo: d.activo ?? true };
  const { error } = d.id
    ? await supabase.from("adm_notificacion_destinatarios").update(payload).eq("id", d.id)
    : await supabase.from("adm_notificacion_destinatarios").insert(payload);
  if (error) fail(error.message, "guardar destinatario");
}

export async function deleteDestinatario(id: string): Promise<void> {
  const { error } = await supabase.from("adm_notificacion_destinatarios").delete().eq("id", id);
  if (error) fail(error.message, "eliminar destinatario");
}

// ── Notificaciones programadas (recobros) ────────────────────
export type Notificacion = {
  id: string;
  recovery_case_id: string | null;
  canal: "whatsapp_deudor" | "whatsapp_deudor_aviso1" | "email_deudor" | "whatsapp_interno" | "resumen_interno";
  destinatario: string | null;
  mensaje: string | null;
  fecha_programada: string;
  estado: "pendiente" | "enviado" | "error" | "cancelado";
  enviado_at: string | null;
  error_text: string | null;
  twilio_sid: string | null;
  twilio_status: string | null; // queued/sent/delivered/read/failed…
};

export async function listNotificacionesCaso(caseId: string): Promise<Notificacion[]> {
  const { data, error } = await supabase.from("adm_notificaciones")
    .select("*")
    .eq("recovery_case_id", caseId)
    .order("fecha_programada", { ascending: true });
  if (error) fail(error.message, "notificaciones del expediente");
  return (data ?? []) as Notificacion[];
}

export async function programarNotificacion(opts: {
  caseId: string;
  canales: ("whatsapp_deudor" | "whatsapp_deudor_aviso1" | "email_deudor")[];
  fecha: string;
  mensaje: string | null;
  userId: string | null;
}): Promise<void> {
  const filas = opts.canales.map((canal) => ({
    recovery_case_id: opts.caseId,
    canal,
    fecha_programada: opts.fecha,
    mensaje: opts.mensaje,
    created_by: opts.userId,
  }));
  const { error } = await supabase.from("adm_notificaciones").insert(filas);
  if (error) fail(error.message, "programar envío");
}

export async function cancelarNotificacion(id: string): Promise<void> {
  const { error } = await supabase.from("adm_notificaciones")
    .update({ estado: "cancelado" })
    .eq("id", id)
    .eq("estado", "pendiente");
  if (error) fail(error.message, "cancelar envío");
}

// ── Usuarios unificados de la aplicación ─────────────────────
import { claveInterna } from "./authClave";

export type AccesoModulo = {
  modulo: string;
  rol: string;
  pantallas: string[] | null;
  empresa_id: string | null;
};

export type AppUsuario = {
  id: string;
  username: string;
  nombre: string;
  email_recuperacion: string | null;
  telefono: string | null;
  activo: boolean;
  es_superadmin: boolean;
  employee_id: string | null;
  accesos: AccesoModulo[];
};

async function tokenSesion(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sesión caducada, vuelve a entrar");
  return token;
}

export async function listAppUsuarios(): Promise<AppUsuario[]> {
  const { data, error } = await supabase.from("app_usuarios")
    .select("*, accesos:app_usuario_modulos(modulo, rol, pantallas, empresa_id)")
    .order("username");
  if (error) fail(error.message, "usuarios de la aplicación");
  return (data ?? []) as AppUsuario[];
}

export async function crearUsuarioAuth(username: string, nombre: string, pin: string): Promise<string> {
  const res = await apiFetch("/api/administracion/usuarios/crear-auth", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await tokenSesion()}` },
    body: JSON.stringify({ username, nombre, password: claveInterna(pin) }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.message ?? "Error creando el usuario");
  return data.userId as string;
}

export async function guardarAppUsuario(u: {
  id: string;
  username: string;
  nombre: string;
  email_recuperacion: string | null;
  telefono: string | null;
  activo: boolean;
  es_superadmin: boolean;
  employee_id: string | null;
  accesos: AccesoModulo[];
}): Promise<void> {
  const { error } = await supabase.rpc("app_guardar_usuario", {
    p_id: u.id,
    p_username: u.username,
    p_nombre: u.nombre,
    p_email_recuperacion: u.email_recuperacion,
    p_telefono: u.telefono,
    p_activo: u.activo,
    p_es_superadmin: u.es_superadmin,
    p_employee_id: u.employee_id,
    p_accesos: u.accesos,
  });
  if (error) fail(error.message, "guardar usuario");
}

export async function resetPasswordUsuario(userId: string, pin: string): Promise<void> {
  const res = await apiFetch("/api/administracion/usuarios/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await tokenSesion()}` },
    body: JSON.stringify({ userId, password: claveInterna(pin) }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.message ?? "Error cambiando la contraseña");
}

export async function eliminarAppUsuario(userId: string): Promise<"eliminado" | "desactivado"> {
  const { data, error } = await supabase.rpc("app_eliminar_usuario", { p_id: userId });
  if (error) fail(error.message, "eliminar usuario");
  const resultado = data as "eliminado" | "desactivado";
  if (resultado === "eliminado") {
    // borrar también la cuenta de Auth (best-effort)
    try {
      await apiFetch("/api/administracion/usuarios/eliminar-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await tokenSesion()}` },
        body: JSON.stringify({ userId }),
      });
    } catch { /* la ficha ya no existe; la cuenta Auth huérfana no da acceso */ }
  }
  return resultado;
}

// Pantallas permitidas del usuario actual en un módulo (null = todas)
export async function getMisPantallas(modulo: string): Promise<string[] | null> {
  try {
    const { data, error } = await supabase.from("app_usuario_modulos")
      .select("pantallas")
      .eq("modulo", modulo)
      .maybeSingle();
    if (error) return null; // tabla aún sin migrar → sin gating
    return (data?.pantallas as string[] | null) ?? null;
  } catch {
    return null;
  }
}

// Módulos del usuario actual (para redirigir tras el login unificado)
export async function getMisModulos(): Promise<string[]> {
  try {
    const { data, error } = await supabase.from("app_usuario_modulos").select("modulo");
    if (error) return [];
    return ((data ?? []) as { modulo: string }[]).map((m) => m.modulo);
  } catch {
    return [];
  }
}

export async function listSeaEmployees(): Promise<{ id: string; nombre: string }[]> {
  try {
    const { data, error } = await supabase.from("sea_employees")
      .select("id, nombre, apellidos")
      .eq("activo", true)
      .order("nombre");
    if (error) return [];
    return ((data ?? []) as { id: string; nombre: string; apellidos: string | null }[])
      .map((e) => ({ id: e.id, nombre: `${e.nombre}${e.apellidos ? " " + e.apellidos : ""}` }));
  } catch {
    return [];
  }
}

export async function listTcEmpresas(): Promise<{ id: string; nombre: string }[]> {
  try {
    const { data, error } = await supabase.from("tc_empresas").select("id, nombre").order("nombre");
    if (error) return [];
    return (data ?? []) as { id: string; nombre: string }[];
  } catch {
    return [];
  }
}

// ── Usuarios del módulo (para "Gestionado por") ──────────────
export async function listUsuariosActivos(): Promise<{ id: string; nombre: string }[]> {
  const { data, error } = await supabase.from("adm_usuarios")
    .select("id, nombre")
    .eq("activo", true)
    .order("nombre");
  if (error) fail(error.message, "usuarios del módulo");
  return (data ?? []) as { id: string; nombre: string }[];
}

// ── Recobros ─────────────────────────────────────────────────
export async function getRecoveryCase(id: string): Promise<RecoveryCase | null> {
  const { data, error } = await supabase.from("adm_recovery_cases")
    .select("*, customer:adm_customers(*), invoice:adm_invoices(*), work_order:adm_work_orders(*), responsible:adm_usuarios(nombre)")
    .eq("id", id)
    .maybeSingle();
  if (error) fail(error.message, "expediente de recobro");
  return (data as RecoveryCase | null) ?? null;
}

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

// ── Crear recobro directo (impagado sin pasar por seguimiento) ──
// Si se indica factura existente se enlaza; si no, se crea la factura.
// El trigger de facturas puede generar un seguimiento automático: se cierra
// como 'pasado_a_recobro' para que no haya gestión duplicada.
export async function crearRecobroDirecto(opts: {
  customerId: string;
  invoiceId: string | null;
  nuevaFactura: { invoice_number: string; invoice_date: string | null; due_date: string | null; total_amount: number } | null;
  dueDate: string | null;
  priority: RecoveryPriority;
  notes: string | null;
  userId: string | null;
  nominal?: number | null;          // nominal del recibo/vencimiento impagado
  gastos?: number | null;           // gastos de devolución
  numeroVencimiento?: string | null; // ej. "2/3" si la factura está partida
  fechaContabilizacion?: string | null; // fecha de contabilización de la devolución
}): Promise<void> {
  let invoiceId = opts.invoiceId;
  let pendiente = 0;
  let dueDate = opts.dueDate;

  if (invoiceId) {
    // Factura existente: comprobar que no tenga ya un recobro abierto
    const { data: caso } = await supabase.from("adm_recovery_cases")
      .select("id").eq("invoice_id", invoiceId).is("closed_at", null).maybeSingle();
    if (caso) throw new Error("Esta factura ya tiene un expediente de recobro abierto.");
    const { data: inv, error: invErr } = await supabase.from("adm_invoices")
      .select("pending_amount, due_date").eq("id", invoiceId).single();
    if (invErr) fail(invErr.message, "cargar factura");
    pendiente = Number((inv as { pending_amount: number }).pending_amount);
    if (pendiente <= 0) throw new Error("Esta factura no tiene importe pendiente.");
    dueDate = dueDate ?? (inv as { due_date: string | null }).due_date;
  } else if (opts.nuevaFactura) {
    const facturaPayload: Record<string, unknown> = {
      customer_id: opts.customerId,
      invoice_number: opts.nuevaFactura.invoice_number,
      due_date: opts.nuevaFactura.due_date,
      total_amount: opts.nuevaFactura.total_amount,
      pending_amount: opts.nuevaFactura.total_amount,
    };
    // fecha factura opcional: si no se indica, la BD usa la fecha de hoy
    if (opts.nuevaFactura.invoice_date) facturaPayload.invoice_date = opts.nuevaFactura.invoice_date;
    const { data: inv, error: invErr } = await supabase.from("adm_invoices").insert(facturaPayload).select("id").single();
    if (invErr) fail(invErr.message, "crear factura");
    invoiceId = (inv as { id: string }).id;
    pendiente = opts.nuevaFactura.total_amount;
    dueDate = dueDate ?? opts.nuevaFactura.due_date;
  } else {
    throw new Error("Indica una factura existente o los datos de la nueva.");
  }

  // Cerrar el seguimiento automático (si el trigger lo creó o ya existía)
  await supabase.from("adm_payment_tracking")
    .update({ status: "pasado_a_recobro", closed_at: new Date().toISOString() })
    .eq("invoice_id", invoiceId)
    .is("closed_at", null);

  const { data: nuevo, error } = await supabase.from("adm_recovery_cases").insert({
    customer_id: opts.customerId,
    invoice_id: invoiceId,
    due_date: dueDate,
    initial_amount: pendiente,
    pending_amount: pendiente,
    nominal_amount: opts.nominal ?? null,
    return_expenses: opts.gastos ?? null,
    installment_number: opts.numeroVencimiento ?? null,
    accounting_date: opts.fechaContabilizacion ?? null,
    status: "pendiente",
    priority: opts.priority,
    internal_notes: opts.notes,
  }).select("id").single();
  if (error) fail(error.message, "crear recobro");

  await supabase.from("adm_recovery_actions").insert({
    recovery_case_id: (nuevo as { id: string }).id,
    action_type: "nota",
    user_id: opts.userId,
    notes: "Expediente creado manualmente desde Recobros",
  });
}

// ── Editar datos generales de un expediente de recobro ───────
// Corrige factura, fechas y desglose; recalcula pendientes respetando
// los pagos ya registrados.
export async function editarDatosRecobro(opts: {
  caso: RecoveryCase;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  accountingDate: string | null;
  installment: string | null;
  nominal: number | null;
  gastos: number | null;
  total: number;
}): Promise<void> {
  const pagado = Math.max(Number(opts.caso.initial_amount) - Number(opts.caso.pending_amount), 0);
  const nuevoPendiente = Math.max(opts.total - pagado, 0);

  if (opts.caso.invoice_id) {
    const inv = opts.caso.invoice;
    const pagadoFactura = inv ? Math.max(Number(inv.total_amount) - Number(inv.pending_amount), 0) : pagado;
    const patch: Record<string, unknown> = {
      due_date: opts.dueDate,
      total_amount: opts.total,
      pending_amount: Math.max(opts.total - pagadoFactura, 0),
    };
    if (opts.invoiceNumber) patch.invoice_number = opts.invoiceNumber;
    if (opts.invoiceDate) patch.invoice_date = opts.invoiceDate;
    const { error } = await supabase.from("adm_invoices").update(patch).eq("id", opts.caso.invoice_id);
    if (error) fail(error.message, "actualizar factura");
  }

  const { error } = await supabase.from("adm_recovery_cases").update({
    due_date: opts.dueDate,
    accounting_date: opts.accountingDate,
    installment_number: opts.installment,
    nominal_amount: opts.nominal,
    return_expenses: opts.gastos,
    initial_amount: opts.total,
    pending_amount: nuevoPendiente,
  }).eq("id", opts.caso.id);
  if (error) fail(error.message, "actualizar recobro");
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
