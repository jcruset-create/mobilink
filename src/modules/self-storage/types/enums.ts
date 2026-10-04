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
export const STAFF_ROLES = ["superadmin", "admin", "employee", "maintenance", "call_center"] as const;
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
  call_center: "Call Center",
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

// ── Fase 3: accesos físicos ──────────────────────────────────────────────────

export const DOOR_TYPES = ["main", "zone", "internal", "other"] as const;
export type DoorType = (typeof DOOR_TYPES)[number];
export const ETIQUETA_DOOR_TYPE: Record<DoorType, string> = {
  main: "Principal",
  zone: "De zona",
  internal: "Interior",
  other: "Otra",
};

/** Cómo se llega al dispositivo. Sólo lo usa el adapter; el dominio no lo mira. */
export const CONNECTION_TYPES = ["mock", "direct_http", "vpn_http", "rms"] as const;
export type ConnectionType = (typeof CONNECTION_TYPES)[number];
export const ETIQUETA_CONNECTION_TYPE: Record<ConnectionType, string> = {
  mock: "Simulador",
  direct_http: "API RutOS directa (HTTPS)",
  vpn_http: "API RutOS por VPN",
  rms: "Teltonika RMS (preparado)",
};

export const DEVICE_STATUSES = ["unknown", "online", "offline"] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export const ACCESS_METHODS = ["app", "phone", "admin", "temporary_link"] as const;
export type AccessMethod = (typeof ACCESS_METHODS)[number];
export const ETIQUETA_ACCESS_METHOD: Record<AccessMethod, string> = {
  app: "App",
  phone: "Llamada",
  admin: "Administración",
  temporary_link: "Enlace temporal",
};

/** Motivo de la decisión de `evaluateAccess`. GRANTED es el único que abre. */
export const ACCESS_REASONS = [
  "GRANTED",
  "DOOR_DISABLED",
  "METHOD_NOT_ALLOWED",
  "PERSON_NOT_FOUND",
  "CUSTOMER_BLOCKED",
  "CUSTOMER_NOT_ACTIVE",
  "MEMBER_NOT_ACTIVE",
  "CONTRACT_NOT_ACTIVE",
  "CONTRACT_TERMINATED",
  "PAYMENT_BLOCK",
  "SECURITY_BLOCK",
  "INCIDENT_BLOCK",
  "MANUAL_BLOCK",
  "DOOR_NOT_ALLOWED",
  "PERMISSION_EXPIRED",
  "OUTSIDE_SCHEDULE",
  "TEMPORARY_ACCESS_NOT_STARTED",
  "TEMPORARY_ACCESS_EXPIRED",
  "TEMPORARY_ACCESS_EXHAUSTED",
  "TEMPORARY_ACCESS_REVOKED",
  "DEVICE_NOT_CONFIGURED",
  "DEVICE_DISABLED",
  "DEVICE_OFFLINE",
  "RATE_LIMITED",
] as const;
export type AccessReason = (typeof ACCESS_REASONS)[number];
export const ETIQUETA_ACCESS_REASON: Record<AccessReason, string> = {
  GRANTED: "Permitido",
  DOOR_DISABLED: "Puerta deshabilitada",
  METHOD_NOT_ALLOWED: "Método no permitido en esta puerta",
  PERSON_NOT_FOUND: "Persona no reconocida",
  CUSTOMER_BLOCKED: "Cliente bloqueado",
  CUSTOMER_NOT_ACTIVE: "Cliente no activo",
  MEMBER_NOT_ACTIVE: "Persona autorizada no activa",
  CONTRACT_NOT_ACTIVE: "Contrato no activo",
  CONTRACT_TERMINATED: "Contrato finalizado",
  PAYMENT_BLOCK: "Bloqueo por impago",
  SECURITY_BLOCK: "Bloqueo por seguridad",
  INCIDENT_BLOCK: "Bloqueo por incidencia",
  MANUAL_BLOCK: "Bloqueo manual",
  DOOR_NOT_ALLOWED: "Puerta no autorizada",
  PERMISSION_EXPIRED: "Permiso fuera de fechas",
  OUTSIDE_SCHEDULE: "Fuera de horario",
  TEMPORARY_ACCESS_NOT_STARTED: "Acceso temporal aún no vigente",
  TEMPORARY_ACCESS_EXPIRED: "Acceso temporal caducado",
  TEMPORARY_ACCESS_EXHAUSTED: "Acceso temporal ya usado",
  TEMPORARY_ACCESS_REVOKED: "Acceso temporal revocado",
  DEVICE_NOT_CONFIGURED: "Puerta sin dispositivo",
  DEVICE_DISABLED: "Dispositivo deshabilitado",
  DEVICE_OFFLINE: "Dispositivo sin conexión",
  RATE_LIMITED: "Demasiados intentos",
};

export const EXECUTION_STATUSES = ["not_attempted", "pending", "succeeded", "failed", "timeout"] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const SYNC_STATUSES = ["pending", "synced", "failed"] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

// ── Call Center ─────────────────────────────────────────────────────────────

export const CALL_DIRECTIONS = ["incoming", "outgoing"] as const;
export type CallDirection = (typeof CALL_DIRECTIONS)[number];
export const ETIQUETA_CALL_DIRECTION: Record<CallDirection, string> = { incoming: "Entrante", outgoing: "Saliente" };

/** Quién atiende: una persona, la IA o las dos (la IA con un humano detrás). */
export const CALL_HANDLERS = ["human", "ai", "hybrid"] as const;
export type CallHandler = (typeof CALL_HANDLERS)[number];
export const ETIQUETA_CALL_HANDLER: Record<CallHandler, string> = { human: "Humano", ai: "IA", hybrid: "Híbrido" };

export const CALL_STATUSES = ["started", "in_progress", "finished", "escalated", "follow_up", "closed"] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];
export const ETIQUETA_CALL_STATUS: Record<CallStatus, string> = {
  started: "Iniciada",
  in_progress: "En curso",
  finished: "Finalizada",
  escalated: "Escalada",
  follow_up: "Pendiente de seguimiento",
  closed: "Cerrada",
};

export const PRIORITIES = ["normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const ETIQUETA_PRIORITY: Record<Priority, string> = { normal: "Normal", high: "Alta", urgent: "Urgente" };

/** Idiomas preparados. Se guarda el código ISO de dos letras. */
export const CALL_LANGUAGES = ["es", "ca"] as const;
export const ETIQUETA_LANGUAGE: Record<string, string> = { es: "Castellano", ca: "Català", en: "English", fr: "Français" };

export const INCIDENT_TYPES = [
  "no_access",
  "security",
  "unauthorized_access",
  "emergency",
  "facility_failure",
  "billing",
  "documentation",
  "complaint",
  "cancellation",
  "administrative",
  "other",
] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];
/** Siempre urgentes (lo exige también la base: `self_storage_incidents_urgent_chk`). */
export const URGENT_INCIDENT_TYPES: readonly IncidentType[] = ["no_access", "security", "unauthorized_access", "emergency", "facility_failure"];
export const ETIQUETA_INCIDENT_TYPE: Record<IncidentType, string> = {
  no_access: "No puede acceder",
  security: "Problema de seguridad",
  unauthorized_access: "Acceso no autorizado",
  emergency: "Emergencia",
  facility_failure: "Fallo grave de instalaciones",
  billing: "Facturación",
  documentation: "Documentación",
  complaint: "Reclamación",
  cancellation: "Baja",
  administrative: "Consulta administrativa",
  other: "Otra",
};

export const INCIDENT_STATUSES = ["open", "in_progress", "resolved", "closed", "cancelled"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export const ETIQUETA_INCIDENT_STATUS: Record<IncidentStatus, string> = {
  open: "Abierta",
  in_progress: "En curso",
  resolved: "Resuelta",
  closed: "Cerrada",
  cancelled: "Anulada",
};
