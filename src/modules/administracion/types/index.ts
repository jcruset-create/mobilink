// ── Roles ────────────────────────────────────────────────────
export type Rol = "admin" | "administracion" | "recepcion" | "supervisor" | "tecnico";

export const ROL_LABELS: Record<Rol, string> = {
  admin: "Admin",
  administracion: "Administración",
  recepcion: "Recepción",
  supervisor: "Supervisor",
  tecnico: "Técnico",
};

export type Perfil = {
  id: string;
  nombre: string;
  email: string;
  rol: Rol;
  activo: boolean;
};

// ── Centros ──────────────────────────────────────────────────
export type Centro = "tarragona" | "reus";
export const CENTRO_LABELS: Record<Centro, string> = { tarragona: "Tarragona", reus: "Reus" };
export const CENTROS: Centro[] = ["tarragona", "reus"];

// ── Clientes ─────────────────────────────────────────────────
export type Customer = {
  id: string;
  name: string;
  customer_code: string | null;
  tax_id: string | null;
  phone: string | null;
  email: string | null;
  payment_method: string | null;
  has_direct_debit: boolean;
  requires_payment_tracking: boolean;
  expected_payment_days: number;
  admin_email: string | null;
  admin_phone: string | null;
  payment_contact_name: string | null;
  internal_credit_limit: number | null;
  economic_notes: string | null;
  created_at: string;
  updated_at: string;
};

// ── OTs ──────────────────────────────────────────────────────
export type WorkOrderStatus = "abierta" | "cerrada" | "anulada";
export type WorkOrder = {
  id: string;
  customer_id: string;
  ot_number: string | null;
  vehicle_plate: string | null;
  status: WorkOrderStatus;
  total_amount: number;
  center: Centro;
  created_at: string;
  closed_at: string | null;
  customer?: Customer | null;
};

// ── Facturas ─────────────────────────────────────────────────
export type InvoiceStatus = "pendiente" | "parcial" | "pagada" | "anulada";
export type Invoice = {
  id: string;
  customer_id: string;
  work_order_id: string | null;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  total_amount: number;
  pending_amount: number;
  status: InvoiceStatus;
  created_at: string;
  updated_at: string;
  customer?: Customer | null;
};

// ── Formas de pago ───────────────────────────────────────────
export type PaymentMethod = {
  id: string;
  name: string;
  active: boolean;
  sort_order: number;
};

// ── Cobros ───────────────────────────────────────────────────
export type Payment = {
  id: string;
  customer_id: string | null;
  work_order_id: string | null;
  invoice_id: string | null;
  payment_date: string;
  amount: number;
  payment_method: string;
  reference: string | null;
  registered_by: string | null;
  center: Centro;
  notes: string | null;
  is_cancelled: boolean;
  cancellation_reason: string | null;
  created_at: string;
  customer?: Customer | null;
  work_order?: WorkOrder | null;
  invoice?: Invoice | null;
  registered_by_user?: { nombre: string } | null;
};

// ── Seguimiento de pagos ─────────────────────────────────────
export type TrackingStatus =
  | "pendiente"
  | "recordatorio_enviado"
  | "esperando_transferencia"
  | "pago_parcial"
  | "pago_confirmado"
  | "pasado_a_recobro"
  | "cerrado";

export const TRACKING_STATUS_LABELS: Record<TrackingStatus, string> = {
  pendiente: "Pendiente de pago",
  recordatorio_enviado: "Recordatorio enviado",
  esperando_transferencia: "Esperando transferencia",
  pago_parcial: "Pago parcial",
  pago_confirmado: "Pago confirmado",
  pasado_a_recobro: "Pasado a recobro",
  cerrado: "Cerrado",
};

// Colores de badge por estado (píldoras estilo TyreControl)
export const TRACKING_STATUS_COLORS: Record<TrackingStatus, string> = {
  pendiente: "bg-amber-500/20 text-amber-300",
  recordatorio_enviado: "bg-sky-500/20 text-sky-300",
  esperando_transferencia: "bg-indigo-500/20 text-indigo-300",
  pago_parcial: "bg-orange-500/20 text-orange-300",
  pago_confirmado: "bg-emerald-500/20 text-emerald-300",
  pasado_a_recobro: "bg-rose-500/20 text-rose-300",
  cerrado: "bg-slate-700 text-slate-400",
};

// Columnas del tablero Kanban (en orden)
export const KANBAN_COLUMNS: TrackingStatus[] = [
  "pendiente",
  "recordatorio_enviado",
  "esperando_transferencia",
  "pago_parcial",
  "pago_confirmado",
];

export type PaymentTracking = {
  id: string;
  customer_id: string;
  work_order_id: string | null;
  invoice_id: string | null;
  total_amount: number;
  pending_amount: number;
  expected_payment_date: string | null;
  expected_payment_method: string | null;
  status: TrackingStatus;
  next_action_date: string | null;
  next_action_note: string | null;
  responsible_user: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  customer?: Customer | null;
  work_order?: WorkOrder | null;
  invoice?: Invoice | null;
  responsible?: { nombre: string } | null;
};

export type TrackingAction = {
  id: string;
  payment_tracking_id: string;
  action_type: string;
  action_date: string;
  user_id: string | null;
  notes: string | null;
  next_action_date: string | null;
  user?: { nombre: string } | null;
};

// ── Recobros ─────────────────────────────────────────────────
export type RecoveryStatus =
  | "pendiente"
  | "primer_aviso"
  | "segundo_aviso"
  | "llamada_realizada"
  | "compromiso_pago"
  | "pago_parcial"
  | "pago_recibido"
  | "cerrado";

export const RECOVERY_STATUS_LABELS: Record<RecoveryStatus, string> = {
  pendiente: "Pendiente",
  primer_aviso: "Primer aviso enviado",
  segundo_aviso: "Segundo aviso enviado",
  llamada_realizada: "Llamada realizada",
  compromiso_pago: "Compromiso de pago",
  pago_parcial: "Pago parcial",
  pago_recibido: "Pago recibido",
  cerrado: "Cerrado",
};

export const RECOVERY_STATUS_COLORS: Record<RecoveryStatus, string> = {
  pendiente: "bg-amber-500/20 text-amber-300",
  primer_aviso: "bg-sky-500/20 text-sky-300",
  segundo_aviso: "bg-indigo-500/20 text-indigo-300",
  llamada_realizada: "bg-violet-500/20 text-violet-300",
  compromiso_pago: "bg-teal-500/20 text-teal-300",
  pago_parcial: "bg-orange-500/20 text-orange-300",
  pago_recibido: "bg-emerald-500/20 text-emerald-300",
  cerrado: "bg-slate-700 text-slate-400",
};

export type RecoveryPriority = "normal" | "alta" | "urgente";
export const PRIORITY_LABELS: Record<RecoveryPriority, string> = {
  normal: "Normal",
  alta: "Alta",
  urgente: "Urgente",
};
export const PRIORITY_COLORS: Record<RecoveryPriority, string> = {
  normal: "bg-slate-700 text-slate-300",
  alta: "bg-amber-500/20 text-amber-300",
  urgente: "bg-rose-500/20 text-rose-300",
};

export type RecoveryCase = {
  id: string;
  customer_id: string;
  invoice_id: string | null;
  work_order_id: string | null;
  due_date: string | null;
  initial_amount: number;
  pending_amount: number;
  nominal_amount: number | null;
  return_expenses: number | null;
  installment_number: string | null;
  status: RecoveryStatus;
  priority: RecoveryPriority;
  responsible_user: string | null;
  next_action_date: string | null;
  next_action_note: string | null;
  internal_notes: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  customer?: Customer | null;
  invoice?: Invoice | null;
  work_order?: WorkOrder | null;
  responsible?: { nombre: string } | null;
};

export type RecoveryAction = {
  id: string;
  recovery_case_id: string;
  action_type: string;
  action_date: string;
  user_id: string | null;
  notes: string | null;
  next_action_date: string | null;
  user?: { nombre: string } | null;
};

// ── Tipos de acción (historial) ──────────────────────────────
export const ACTION_TYPE_LABELS: Record<string, string> = {
  recordatorio_email: "Recordatorio por email",
  whatsapp: "Mensaje WhatsApp",
  llamada: "Llamada",
  nota: "Nota",
  pago_parcial: "Pago parcial",
  pago_total: "Pago total",
  primer_aviso: "Primer aviso",
  segundo_aviso: "Segundo aviso",
  compromiso_pago: "Compromiso de pago",
  pasado_a_recobro: "Pasado a recobro",
  cambio_estado: "Cambio de estado",
  cierre: "Cierre",
};

// ── Utilidades ───────────────────────────────────────────────
export function fmtEur(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

export function fmtFecha(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function fmtFechaHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function diasVencidos(dueDate: string | null | undefined): number {
  if (!dueDate) return 0;
  const due = new Date(dueDate + "T00:00:00");
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((hoy.getTime() - due.getTime()) / 86400000));
}
