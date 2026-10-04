/**
 * Tipos de la API interna de Self Storage tal como los ve el panel. Son las
 * vistas que construye el servidor (`server/self-storage/domain/vistas.ts` y
 * los repositorios): aquí no hay ningún dato que el servidor no mande.
 */

import type {
  AccessMethod,
  AccessReason,
  CallDirection,
  CallHandler,
  CallStatus,
  IncidentStatus,
  IncidentType,
  Priority,
  BlockReason,
  ConnectionType,
  DoorType,
  ExecutionStatus,
  SyncStatus,
  ContractStatus,
  CustomerStatus,
  CustomerType,
  DunningStatus,
  FirstSepaPolicy,
  InvoiceItemType,
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
  RecordStatus,
  StaffRole,
  UnitStatus,
} from "./enums";

export * from "./enums";

export type Bootstrap = {
  /** Empresa con la que se trabaja (la propia, o la elegida por el superadministrador). */
  empresa?: { id: string; nombre: string };
  /** Sólo para el superadministrador: empresas con Self Storage entre las que elegir. */
  empresas?: { id: string; nombre: string }[] | null;
  rol: StaffRole | null;
  permisos: string[];
  usuario: { id: string; nombre: string };
  centros: { id: string; code: string; name: string; status: RecordStatus }[];
  vocabulario: {
    unitStatuses: UnitStatus[];
    customerStatuses: CustomerStatus[];
    customerTypes: CustomerType[];
    contractStatuses: ContractStatus[];
    etiquetas: {
      unitStatus: Record<UnitStatus, string>;
      customerStatus: Record<CustomerStatus, string>;
      customerType: Record<CustomerType, string>;
      contractStatus: Record<ContractStatus, string>;
      invoiceStatus: Record<InvoiceStatus, string>;
      itemType: Record<InvoiceItemType, string>;
      paymentMethod: Record<PaymentMethod, string>;
      paymentStatus: Record<PaymentStatus, string>;
      blockReason: Record<BlockReason, string>;
      accessReason?: Record<AccessReason, string>;
      accessMethod?: Record<AccessMethod, string>;
      doorType?: Record<DoorType, string>;
      connectionType?: Record<ConnectionType, string>;
      callStatus?: Record<CallStatus, string>;
      callHandler?: Record<CallHandler, string>;
      callDirection?: Record<CallDirection, string>;
      priority?: Record<Priority, string>;
      incidentType?: Record<IncidentType, string>;
      incidentStatus?: Record<IncidentStatus, string>;
    };
  };
};

export type Centro = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  country: string;
  timezone: string;
  phone: string | null;
  email: string | null;
  publicVisible: boolean;
  status: RecordStatus;
  zonas?: number;
  trasteros?: number;
};

export type Zona = {
  id: string;
  centerId: string;
  code: string;
  name: string;
  floor: string | null;
  sortOrder: number;
  status: RecordStatus;
  trasteros?: number;
};

export type TipoTrastero = {
  id: string;
  centerId: string | null;
  code: string;
  name: string;
  widthCm: number;
  lengthCm: number;
  heightCm: number;
  nominalAreaM2: number;
  nominalVolumeM3: number;
  image3dUrl: string | null;
  capacityDescription: string | null;
  capacityExamples: string[];
  sortOrder: number;
  active: boolean;
  trasteros: number;
};

export type Trastero = {
  id: string;
  centerId: string;
  code: string;
  name: string | null;
  zone: { id: string; code: string; name: string };
  unitType: { id: string; code: string | null; name: string | null } | null;
  widthCm: number;
  lengthCm: number;
  heightCm: number;
  areaM2: number;
  volumeM3: number;
  monthlyPrice: number;
  /** Tipo de IVA (porcentaje) vigente cuando se fijó el precio. */
  taxRate: number;
  /** Cuota de IVA en euros: base + cuota = PVP. */
  vatAmount: number;
  monthlyPriceGross: number;
  depositAmount: number;
  status: UnitStatus;
  statusReason: string | null;
  image3dUrl: string | null;
  floorPlanShapeId: string | null;
  publicVisible: boolean;
  notes: string | null;
  contract: {
    id: string;
    number: string;
    status: ContractStatus;
    startDate: string;
    endDate: string | null;
    monthlyPrice: number | null;
    monthlyPriceGross: number | null;
  } | null;
  customer: { id: string; name: string } | null;
  paymentStatus: EstadoCobros | null;
};

export type Plano = {
  center: { id: string; code: string; name: string };
  plan: { id: string; version: number; name: string; svg: string; shapeIds: string[]; createdAt: string } | null;
  units: Trastero[];
  unlinkedShapes: string[];
  orphanUnits: { id: string; code: string; shapeId: string }[];
};

export type Cliente = {
  id: string;
  customerType: CustomerType;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  taxId: string;
  phone: string;
  email: string;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  country: string;
  status: CustomerStatus;
  statusReason: string | null;
  notes: string | null;
  hasPortalAccount: boolean;
  displayName: string;
  contratosVivos?: number;
};

export type Telefono = { id: string; phone: string; label: string | null; allowDoorAccess: boolean };

export type ContratoResumen = {
  id: string;
  contractNumber: string;
  status: ContractStatus;
  startDate: string;
  endDate: string | null;
  monthlyPrice: number;
  unitId: string;
  unitCode: string;
  centerId: string;
  centerName: string;
  members: number;
};

export type FichaCliente = Cliente & { phones: Telefono[]; contracts: ContratoResumen[] };

export type Indicadores = {
  total: number;
  available: number;
  reserved: number;
  occupied: number;
  maintenance: number;
  blocked: number;
  rentable: number;
  areaTotal: number;
  areaOcupada: number;
  occupancyPct: number | null;
  occupancyRentablePct: number | null;
  areaOccupancyPct: number | null;
};

export type Dashboard = {
  centerId: string | null;
  units: Indicadores;
  byCenter: (Indicadores & { id: string; code: string; name: string })[];
  byZone: (Indicadores & { id: string; code: string; name: string; centerName: string })[];
  customers: { active: number; blocked: number; total: number };
  billing: {
    monthlyInvoiced: number | null;
    pendingCollection: number | null;
    overdue: number | null;
    openDunning?: number | null;
    phase: number;
    /** false = el rol no ve la facturación (mantenimiento). */
    visible?: boolean;
  };
  access: { today: number | null; doors: unknown; phase: number };
};

export type FilaImportacion = {
  rowNumber: number;
  unitCode: string | null;
  raw: Record<string, string>;
  parsed: (Record<string, unknown> & { cambios?: string[] }) | null;
  errors: string[];
  warnings: string[];
  action: "create" | "update" | "skip" | "error";
  storageUnitId: string | null;
};

export type Importacion = {
  id: string;
  centerId: string;
  fileName: string;
  status: "validated" | "applied" | "failed";
  summary: {
    total: number;
    create: number;
    update: number;
    skip: number;
    error: number;
    warnings: number;
    columnasIgnoradas?: string[];
    creados?: number;
    actualizados?: number;
    tiposCreados?: string[];
    avisos?: string[];
    ivaGeneral?: number;
  };
  createdAt: string;
  appliedAt: string | null;
  rows?: FilaImportacion[];
};

// ── Fase 2: contratos, facturas, pagos e impagos ────────────────────────────

/** Estado de cobros de un contrato vivo, tal como lo resume el servidor. */
export type EstadoCobros = "up_to_date" | "pending" | "overdue";

export type AccionContrato = "issue" | "sign" | "activate" | "suspend" | "reactivate" | "terminate" | "cancel";

export type Contrato = {
  id: string;
  contractNumber: string;
  status: ContractStatus;
  centerId: string;
  centerName: string;
  customerId: string;
  customerName: string;
  unitId: string;
  unitCode: string;
  zoneName: string;
  startDate: string;
  endDate: string | null;
  listMonthlyPrice: number | null;
  monthlyPrice: number;
  taxRate: number;
  monthlyPriceGross: number;
  depositAmount: number;
  depositTaxRate: number;
  billingDay: number;
  billingPeriod: string;
  paymentMethod: PaymentMethod | null;
  collectionMethod: "stripe" | "manual";
  notes: string | null;
  termsVersion: string | null;
  signedAt: string | null;
  signatureName: string | null;
  signedByType: string | null;
  activatedAt: string | null;
  suspendedAt: string | null;
  terminatedAt: string | null;
  terminationReason: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  stripeSubscriptionId: string | null;
  stripeSubscriptionStatus: string | null;
  firstSepaPaymentAccessPolicy: FirstSepaPolicy;
  firstPaymentStatus: string | null;
  activationOverrideReason: string | null;
  nextInvoiceDate: string | null;
  createdAt: string;
  pendingAmount?: number;
  inDunning?: boolean;
};

export type LineaContrato = {
  id: string;
  billingItemId: string | null;
  itemType: InvoiceItemType;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  isRecurring: boolean;
};

export type DocumentoContrato = {
  id: string;
  documentType: "contract" | "annex";
  version: number;
  status: "draft" | "final";
  termsVersion: string | null;
  sha256: string;
  sizeBytes: number;
  acceptedAt: string | null;
  acceptedByType: string | null;
  acceptedName: string | null;
  acceptedIp: string | null;
  createdAt: string;
};

export type Bloqueo = {
  id: string;
  reason: BlockReason;
  source: string;
  notes: string | null;
  createdAt: string;
  liftedAt: string | null;
  liftReason: string | null;
};

export type FacturaResumen = {
  id: string;
  invoiceNumber: string | null;
  status: InvoiceStatus;
  total: number;
  issueDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  kind: "rent" | "one_off" | "rectifying";
};

export type ContratoDetalle = Contrato & {
  actions: AccionContrato[];
  items: LineaContrato[];
  documents: DocumentoContrato[];
  blocks: Bloqueo[];
  invoices: FacturaResumen[];
};

export type EntradaHistorial = {
  id: string;
  occurredAt: string;
  actorType: string;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

export type Factura = {
  id: string;
  customerId: string;
  contractId: string | null;
  kind: "rent" | "one_off" | "rectifying";
  collectionMethod: "stripe" | "manual";
  series: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  dueDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  status: InvoiceStatus;
  customerName: string | null;
  customerTaxId: string | null;
  customerAddress: string | null;
  issuerName: string | null;
  issuerTaxId: string | null;
  issuerAddress: string | null;
  stripeInvoiceId: string | null;
  stripeHostedUrl: string | null;
  rectifiesInvoiceId: string | null;
  rectificationReason: string | null;
  paidAt: string | null;
  notes: string | null;
  createdAt: string;
  contractNumber: string | null;
  displayCustomer: string;
  amountPaid: number;
};

export type LineaFactura = {
  id: string;
  itemType: InvoiceItemType;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  subtotal: number;
  taxAmount: number;
  total: number;
  periodStart: string | null;
  periodEnd: string | null;
};

export type PagoDeFactura = {
  id: string;
  amount: number;
  refundedAmount: number;
  paymentMethod: PaymentMethod;
  status: PaymentStatus;
  paidAt: string | null;
  failureReason: string | null;
  createdAt: string;
};

export type FacturaDetalle = Factura & { lines: LineaFactura[]; payments: PagoDeFactura[] };

export type Pago = PagoDeFactura & {
  customerId: string;
  contractId: string | null;
  invoiceId: string | null;
  currency: string;
  stripePaymentIntentId: string | null;
  stripeInvoiceId: string | null;
  invoiceNumber: string | null;
  customerName: string;
};

export type CasoImpago = {
  id: string;
  status: DunningStatus;
  openedAt: string;
  failureReason: string | null;
  firstNoticeAt: string | null;
  secondNoticeAt: string | null;
  suspendedAt: string | null;
  resolvedAt: string | null;
  resolution: string | null;
  invoiceId: string;
  invoiceNumber: string | null;
  total: number;
  invoiceStatus: InvoiceStatus;
  customerId: string;
  customerName: string | null;
  contractId: string | null;
  contractNumber: string | null;
  contractStatus: ContractStatus | null;
};

export type Concepto = {
  id: string;
  code: string;
  name: string;
  itemType: InvoiceItemType;
  defaultPrice: number;
  /** `inherit_default`: usa el IVA general; `custom`: `customTaxRate`. */
  vatPolicy: "inherit_default" | "custom";
  customTaxRate: number | null;
  /** Tipo EFECTIVO hoy (lo resuelve el servidor). */
  taxRate: number;
  taxExemptionReason: string | null;
  isRecurring: boolean;
  isRentalComponent: boolean;
  active: boolean;
  sortOrder: number;
};

export type Deuda = { pendiente: number; vencida: number; facturas: number };

export type CobrosCliente = { debt: Deuda; invoices: Factura[]; payments: Pago[] };

export type MetodoPago = {
  id: string;
  type: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
};

export type Emisor = { name: string; taxId: string; address: string; email?: string; phone?: string };

/** Valores efectivos de la configuración; `isDefault` = nadie lo ha tocado. */
export type Ajustes = {
  /** IVA general de la empresa (porcentaje). */
  default_vat_rate: { value: number; isDefault: boolean };
  "access.rate_limit_per_minute": { value: number; isDefault: boolean };
  "reservations.ttl_minutes": { value: number; isDefault: boolean };
  "billing.first_sepa_payment_access_policy": { value: FirstSepaPolicy; isDefault: boolean };
  "billing.issuer": { value: Emisor | null; isDefault: boolean };
  "billing.invoice_series": { value: string; isDefault: boolean };
  "billing.rectifying_series": { value: string; isDefault: boolean };
  "contracts.series": { value: string; isDefault: boolean };
  "billing.due_days": { value: number; isDefault: boolean };
  "dunning.policy": { value: { firstNoticeDays: number; secondNoticeDays: number; suspendDays: number }; isDefault: boolean };
  "contracts.terms_version": { value: string; isDefault: boolean };
  "contracts.terms_text": { value: string; isDefault: boolean };
  "call_center.enabled": { value: boolean; isDefault: boolean };
  "call_center.default_center_id": { value: string | null; isDefault: boolean };
  "call_center.links": { value: EnlacesCallCenter; isDefault: boolean };
  "call_center.store_transcripts": { value: boolean; isDefault: boolean };
  "call_center.transcript_retention_days": { value: number; isDefault: boolean };
  "call_center.store_audio": { value: false; isDefault: boolean };
  "ai_assistant.enabled": { value: boolean; isDefault: boolean };
  "ai_assistant.mode": { value: "ai" | "human" | "hybrid"; isDefault: boolean };
  "ai_assistant.provider": { value: string; isDefault: boolean };
  "ai_assistant.fallback_provider": { value: string | null; isDefault: boolean };
  "ai_assistant.voice_provider": { value: string | null; isDefault: boolean };
  "ai_assistant.telephony_provider": { value: string | null; isDefault: boolean };
  "ai_assistant.languages": { value: string[]; isDefault: boolean };
  "ai_assistant.store_transcripts": { value: boolean; isDefault: boolean };
  "ai_assistant.store_summary": { value: boolean; isDefault: boolean };
  "ai_assistant.human_escalation": { value: boolean; isDefault: boolean };
  "ai_assistant.extra_rules": { value: string[]; isDefault: boolean };
  "ai_assistant.tools": { value: Record<string, { active: boolean; requiresConfirmation: boolean }>; isDefault: boolean };
  "ai_assistant.max_turns": { value: number; isDefault: boolean };
};
export type ClaveAjuste = keyof Ajustes;

export const TRABAJOS = ["facturacion", "vencimientos", "impagos", "notificaciones", "stripe_reintentos", "accesos", "llamadas_retencion"] as const;
export type Trabajo = (typeof TRABAJOS)[number];

// ── Fase 3: accesos físicos ─────────────────────────────────────────────────

export type ReglaHorario = { days: number[]; from: string; to: string };
export type Horario = { timezone?: string; rules: ReglaHorario[] } | null;

export type SalidaDispositivo = {
  id: string;
  outputNumber: number;
  name: string;
  outputType: "relay" | "digital_output";
  pulseDurationMs: number;
  enabled: boolean;
  doorId: string | null;
  doorName: string | null;
};

export type Dispositivo = {
  id: string;
  centerId: string;
  centerName: string;
  name: string;
  manufacturer: string;
  model: string;
  serial: string | null;
  imei: string | null;
  phoneNumber: string | null;
  connectionType: ConnectionType;
  endpoint: string | null;
  /** NOMBRE de la variable de entorno con las credenciales (nunca la credencial). */
  credentialsSecretName: string | null;
  driverOptions: Record<string, string | number | boolean | null>;
  simulation: Record<string, string | number | boolean | null>;
  phoneAccessMode: "none" | "rut_whitelist";
  firmware: string | null;
  status: "unknown" | "online" | "offline";
  lastSeenAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  enabled: boolean;
  notes: string | null;
  syncStatus: SyncStatus | null;
  syncDesired: string[] | null;
  syncActual: string[] | null;
  syncLastAttemptAt: string | null;
  syncLastSuccessAt: string | null;
  syncError: string | null;
  syncAttempts: number | null;
  syncNextAttemptAt: string | null;
  outputs: SalidaDispositivo[];
};

export type Puerta = {
  id: string;
  centerId: string;
  zoneId: string | null;
  zoneName: string | null;
  name: string;
  doorType: DoorType;
  deviceOutputId: string | null;
  enabled: boolean;
  allowApp: boolean;
  allowPhone: boolean;
  accessSchedule: Horario;
  sortOrder: number;
  outputNumber: number | null;
  outputName: string | null;
  outputEnabled: boolean | null;
  deviceId: string | null;
  deviceName: string | null;
  deviceModel: string | null;
  connectionType: ConnectionType | null;
  deviceStatus: "unknown" | "online" | "offline" | null;
  deviceEnabled: boolean | null;
  lastSeenAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastOpenedAt: string | null;
  syncStatus: SyncStatus | null;
};

export type EventoAcceso = {
  id: string;
  requestedAt: string;
  method: AccessMethod;
  decision: "granted" | "denied";
  reason: AccessReason;
  executionStatus: ExecutionStatus;
  executedAt: string | null;
  latencyMs: number | null;
  actorType: string;
  actorName: string | null;
  doorId: string | null;
  doorName: string | null;
  deviceId: string | null;
  deviceName: string | null;
  contractId: string | null;
  contractNumber: string | null;
  customerId: string | null;
  contractMemberId: string | null;
  temporaryAccessId: string | null;
  adminReason: string | null;
  deviceResponse: { ok: boolean; code: string | null; message: string | null } | null;
};

export type ResultadoApertura = {
  eventId: string;
  opened: boolean;
  decision: "granted" | "denied";
  reason: AccessReason;
  executionStatus: ExecutionStatus;
  message: string;
};

export type MiembroContrato = {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  status: "active" | "suspended" | "revoked";
  allowApp: boolean;
  allowPhone: boolean;
  notes: string | null;
  hasPortalAccount: boolean;
};

export type AccesosContrato = {
  permisos: { id: string; doorId: string; doorName: string; source: "contract" | "manual"; status: "active" | "revoked"; validFrom: string | null; validUntil: string | null; notes: string | null; createdAt: string; revokedAt: string | null }[];
  puertas: { doorId: string; doorName: string; doorType: DoorType; granted: boolean; reason: AccessReason }[];
};

export type AccesoTemporal = {
  id: string;
  centerId: string;
  contractId: string | null;
  contractNumber: string | null;
  customerId: string | null;
  holderType: "holder" | "guest";
  fullName: string;
  phone: string | null;
  email: string | null;
  startsAt: string;
  endsAt: string;
  maxUses: number | null;
  usesCount: number;
  hasLink: boolean;
  status: "active" | "revoked";
  notes: string | null;
  createdAt: string;
  revokedAt: string | null;
  doors: { id: string; name: string }[];
  /** Sólo en la respuesta de alta, una vez. */
  token?: string | null;
};

// ── Call Center ─────────────────────────────────────────────────────────────

export type EnlacesCallCenter = { brandName: string | null; web: string | null; calculator: string | null; contracting: string | null; virtualVisit: string | null };

export type EstadoCallCenter = { global: boolean; empresa: boolean; enabled: boolean; links: EnlacesCallCenter };

export type EntradaCatalogo = {
  id: string;
  kind: "reason" | "result";
  code: string;
  label: string;
  active: boolean;
  sortOrder: number;
  defaultPriority: Priority | null;
  isSystem: boolean;
};

export type Llamada = {
  id: string;
  centerId: string | null;
  centerName: string | null;
  customerId: string | null;
  customerName: string | null;
  contractId: string | null;
  contractNumber: string | null;
  leadId: string | null;
  phone: string | null;
  phoneRaw: string | null;
  callerName: string | null;
  direction: CallDirection;
  channel: "phone";
  handledBy: CallHandler;
  operatorUserId: string | null;
  operatorName: string | null;
  telephonyProvider: string | null;
  externalCallId: string | null;
  language: string | null;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  reasonCode: string | null;
  reasonLabel: string | null;
  resultCode: string | null;
  resultLabel: string | null;
  status: CallStatus;
  priority: Priority;
  requiresHuman: boolean;
  summary: string | null;
  notes: string | null;
  escalatedAt: string | null;
  escalationReason: string | null;
  followUpAt: string | null;
  followUpDoneAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EventoLlamada = { id: string; occurredAt: string; actorType: string; actorName: string | null; eventType: string; data: Record<string, unknown> };

export type LlamadaDetalle = Llamada & {
  transcript: string | null;
  events: EventoLlamada[];
  incidents: { id: string; incidentType: IncidentType; priority: Priority; status: IncidentStatus; title: string; createdAt: string }[];
};

export type FichaMinima = {
  customerId: string;
  name: string;
  status: CustomerStatus;
  match: "customer" | "authorized_person";
  matchedPersonName: string | null;
  accessBlocked: boolean;
  hasPendingPayments: boolean;
  openIncidents: number;
  contracts: { id: string; contractNumber: string; status: ContractStatus; unitCode: string; zoneName: string | null; centerId: string; centerName: string; startDate: string }[];
};

export type Identificacion = {
  phone: string | null;
  interested: boolean;
  matches: FichaMinima[];
  previousCalls: { id: string; startedAt: string; reasonCode: string | null; resultCode: string | null; status: CallStatus; summary: string | null }[];
};

export type InfoCentroCallCenter = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  phone: string | null;
  email: string | null;
  links: EnlacesCallCenter;
};

export type DisponibilidadCentro = {
  centerId: string;
  centerName: string;
  checkedAt: string;
  notice: string;
  types: { unitTypeId: string; name: string; areaM2: number; volumeM3: number; available: boolean }[];
};

export type DashboardCallCenter = {
  kpis: {
    today: number;
    week: number;
    month: number;
    total: number;
    avgDurationSeconds: number | null;
    incoming: number;
    outgoing: number;
    resolved: number;
    escalated: number;
    ai: number;
    human: number;
    hybrid: number;
    existingCustomers: number;
    newInterested: number;
    visitRequests: number;
    priceQueries: number;
    sizeQueries: number;
    sentToCalculator: number;
    sentToContracting: number;
    pendingFollowUps: number;
    resolvedPct: number;
    escalatedPct: number;
    aiPct: number;
    humanPct: number;
    hybridPct: number;
    incidentsOpen: number;
    incidentsUrgent: number;
    incidentsFromCalls: number;
  };
  series: {
    porDia: { day: string; calls: number; avgDurationSeconds: number | null; resolved: number; escalated: number; human: number; ai: number; hybrid: number }[];
    porMotivo: { code: string; label: string; calls: number }[];
    porResultado: { code: string; label: string; calls: number }[];
    porIdioma: { code: string; calls: number }[];
    porCentro: { centerId: string | null; label: string; calls: number }[];
  };
};

export type OperadorCallCenter = {
  operatorUserId: string | null;
  operatorName: string | null;
  handledBy: CallHandler;
  calls: number;
  avgDurationSeconds: number | null;
  escalated: number;
  closed: number;
  lastCallAt: string | null;
};

export type EventoCallCenter = EventoLlamada & { callId: string; phone: string | null; centerId: string | null; customerId: string | null };

export type Incidencia = {
  id: string;
  centerId: string;
  centerName: string;
  customerId: string | null;
  customerName: string | null;
  contractId: string | null;
  contractNumber: string | null;
  callId: string | null;
  incidentType: IncidentType;
  priority: Priority;
  status: IncidentStatus;
  source: "panel" | "call" | "system" | "portal";
  title: string;
  description: string | null;
  resolution: string | null;
  openedBy: string | null;
  openedByName: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
};

export type Pagina<T> = { total: number; items: T[] };

// ── Asistente IA ────────────────────────────────────────────────────────────

export type EstadoAsistente = { global: boolean; empresa: boolean; enabled: boolean; provider: string; providerAvailable: boolean; fallbackProvider: string | null; mode: "ai" | "human" | "hybrid" };

export type EntradaConocimiento = {
  id: string;
  centerId: string | null;
  category: string;
  question: string;
  answer: string;
  language: string;
  active: boolean;
  priority: number;
  seedKey: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RiesgoHerramienta = "READ_ONLY" | "WRITE_SAFE" | "SENSITIVE";
export type HerramientaIA = { nombre: string; descripcion: string; riesgo: RiesgoHerramienta; permiso: string | null; parametros: string; active: boolean; requiresConfirmation: boolean };

export type ProveedoresIA = {
  ai: { nombre: string; disponible: boolean; modelo: string }[];
  voice: { nombre: string; disponible: boolean }[];
  telephony: { nombre: string; conectado: boolean }[];
  selected: { provider: string; fallbackProvider: string | null; voiceProvider: string | null; telephonyProvider: string | null };
  available: { ai: string[]; voice: string[]; telephony: string[] };
};

export type SesionIA = {
  id: string;
  callId: string | null;
  centerId: string | null;
  centerName: string | null;
  provider: string;
  model: string | null;
  language: string | null;
  mode: "console" | "call";
  status: "active" | "finished" | "escalated" | "error";
  startedAt: string;
  endedAt: string | null;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  audioSeconds: number;
  costEstimate: number | null;
  summary: string | null;
  error: string | null;
  escalatedAt: string | null;
  escalationReason: string | null;
  flaggedForReview: boolean;
  flagReason: string | null;
  reviewStatus: "correct" | "partial" | "incorrect" | null;
  reviewNotes: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  createdBy: string | null;
  createdByName: string | null;
  callPhone: string | null;
};

export type LlamadaHerramienta = {
  id: string;
  sessionId?: string;
  callId?: string | null;
  tool: string;
  risk: RiesgoHerramienta | "UNKNOWN";
  outcome: "success" | "error" | "blocked";
  params: unknown;
  result: unknown;
  error: string | null;
  durationMs: number;
  createdAt: string;
  provider?: string;
};

export type SesionIADetalle = SesionIA & { messages: { id: string; role: "user" | "assistant" | "tool" | "system"; content: string; createdAt: string }[]; toolCalls: LlamadaHerramienta[] };

export type TurnoIA = {
  reply: string;
  action: "responder" | "herramienta" | "escalar" | "finalizar" | "error";
  language: string;
  tools: { tool: string; outcome: "success" | "error" | "blocked"; error?: string }[];
  session: SesionIADetalle;
};

export type DashboardIA = {
  kpis: {
    sessions: number;
    finished: number;
    escalated: number;
    errors: number;
    active: number;
    avgDurationSeconds: number | null;
    inputTokens: number;
    outputTokens: number;
    costEstimate: number | null;
    flagged: number;
    pendingReview: number;
    reviewCorrect: number;
    reviewPartial: number;
    reviewIncorrect: number;
    resolutionPct: number;
    unresolvedQueries: number;
  };
  herramientas: { tool: string; calls: number; success: number; errors: number; blocked: number }[];
  porIdioma: { code: string; sessions: number }[];
  porProveedor: { provider: string; model: string; sessions: number }[];
};
