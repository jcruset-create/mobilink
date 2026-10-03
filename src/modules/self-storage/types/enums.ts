/**
 * Vocabulario de Mobilink Self Storage, compartido por el panel y el servidor.
 *
 * Es el espejo de los ENUM de PostgreSQL (`supabase/migrations/self_storage/`).
 * El servidor lo importa para validar con zod y el panel para pintar etiquetas:
 * una sola lista, para que no haya un estado que la base conoce y la pantalla
 * no (o al revés). Una prueba comprueba que coincide con la base.
 */

export const UNIT_STATUSES = ["available", "reserved", "occupied", "maintenance", "blocked"] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

export const CUSTOMER_TYPES = ["individual", "company"] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const CUSTOMER_STATUSES = ["active", "blocked", "inactive"] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const RECORD_STATUSES = ["active", "inactive"] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

export const RESERVATION_STATUSES = ["active", "converted", "expired", "cancelled"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const CONTRACT_STATUSES = [
  "draft",
  "pending_signature",
  "pending_payment",
  "active",
  "suspended",
  "terminated",
  "cancelled",
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

/** Estados de contrato que OCUPAN el trastero (índice único parcial en la base). */
export const LIVE_CONTRACT_STATUSES: readonly ContractStatus[] = ["pending_signature", "pending_payment", "active", "suspended"];

export const MEMBER_STATUSES = ["active", "suspended", "revoked"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

/** Motivos de bloqueo. Un pago sólo levanta `payment`. */
export const BLOCK_REASONS = ["payment", "security", "incident", "terminated", "manual"] as const;
export type BlockReason = (typeof BLOCK_REASONS)[number];

export const INVOICE_STATUSES = ["draft", "pending", "paid", "overdue", "cancelled", "refunded"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_ITEM_TYPES = ["rental", "deposit", "insurance", "lock", "penalty", "discount", "setup_fee", "other"] as const;
export type InvoiceItemType = (typeof INVOICE_ITEM_TYPES)[number];

export const PAYMENT_METHODS = ["card", "sepa", "bank_transfer", "cash"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ["pending", "processing", "succeeded", "failed", "refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const FIRST_SEPA_POLICIES = ["wait_for_success", "allow_while_processing"] as const;
export type FirstSepaPolicy = (typeof FIRST_SEPA_POLICIES)[number];

export const DUNNING_STATUSES = ["open", "resolved", "cancelled"] as const;
export type DunningStatus = (typeof DUNNING_STATUSES)[number];

export const ETIQUETA_INVOICE_STATUS: Record<InvoiceStatus, string> = {
  draft: "Borrador",
  pending: "Pendiente",
  paid: "Pagada",
  overdue: "Vencida",
  cancelled: "Anulada",
  refunded: "Reembolsada",
};

export const ETIQUETA_ITEM_TYPE: Record<InvoiceItemType, string> = {
  rental: "Alquiler",
  deposit: "Fianza",
  insurance: "Seguro",
  lock: "Candado",
  penalty: "Penalización",
  discount: "Descuento",
  setup_fee: "Alta",
  other: "Otros",
};

export const ETIQUETA_PAYMENT_METHOD: Record<PaymentMethod, string> = {
  card: "Tarjeta",
  sepa: "Domiciliación SEPA",
  bank_transfer: "Transferencia",
  cash: "Efectivo",
};

export const ETIQUETA_PAYMENT_STATUS: Record<PaymentStatus, string> = {
  pending: "Pendiente",
  processing: "En proceso",
  succeeded: "Cobrado",
  failed: "Fallido",
  refunded: "Reembolsado",
};

export const ETIQUETA_BLOCK_REASON: Record<BlockReason, string> = {
  payment: "Impago",
  security: "Seguridad",
  incident: "Incidencia",
  terminated: "Contrato finalizado",
  manual: "Manual",
};

export const IMPORT_STATUSES = ["validated", "applied", "failed"] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

/** Roles internos del módulo (los guarda `app_usuario_modulos.rol`). */
export const STAFF_ROLES = ["superadmin", "admin", "employee", "maintenance"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ETIQUETA_UNIT_STATUS: Record<UnitStatus, string> = {
  available: "Disponible",
  reserved: "Reservado",
  occupied: "Alquilado",
  maintenance: "Mantenimiento",
  blocked: "Bloqueado",
};

export const ETIQUETA_CUSTOMER_STATUS: Record<CustomerStatus, string> = {
  active: "Activo",
  blocked: "Bloqueado",
  inactive: "Inactivo",
};

export const ETIQUETA_CUSTOMER_TYPE: Record<CustomerType, string> = {
  individual: "Particular",
  company: "Empresa",
};

export const ETIQUETA_CONTRACT_STATUS: Record<ContractStatus, string> = {
  draft: "Borrador",
  pending_signature: "Pendiente de firma",
  pending_payment: "Pendiente de pago",
  active: "Activo",
  suspended: "Suspendido",
  terminated: "Finalizado",
  cancelled: "Cancelado",
};

export const ETIQUETA_ROLE: Record<StaffRole, string> = {
  superadmin: "Superadministrador",
  admin: "Administrador",
  employee: "Empleado",
  maintenance: "Mantenimiento",
};

/**
 * Color del plano por estado. Verde disponible, rojo alquilado, naranja
 * reservado, gris mantenimiento/bloqueado. Es el ÚNICO sitio que decide el
 * color: el plano del panel y el de la web pública lo leen de aquí.
 */
export const COLOR_PLANO: Record<UnitStatus, { fill: string; stroke: string; nombre: string }> = {
  available: { fill: "#22c55e", stroke: "#15803d", nombre: "verde" },
  occupied: { fill: "#ef4444", stroke: "#b91c1c", nombre: "rojo" },
  reserved: { fill: "#f97316", stroke: "#c2410c", nombre: "naranja" },
  maintenance: { fill: "#9ca3af", stroke: "#4b5563", nombre: "gris" },
  blocked: { fill: "#9ca3af", stroke: "#4b5563", nombre: "gris" },
};
