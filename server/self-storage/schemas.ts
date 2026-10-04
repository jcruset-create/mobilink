/**
 * Validación de entrada (zod). Aquí sólo se comprueba FORMA; las reglas de
 * negocio (NIF, teléfonos, precios, estados) viven en `domain/`.
 *
 * Los objetos son `strict`: un campo que no se espera es un error, no se
 * ignora. Así nadie puede colar `empresaId`, `status` o `stripeCustomerId` en
 * un alta y descubrir que se guardaba.
 */

import { z } from "zod";
import {
  ACCESS_METHODS,
  CALL_DIRECTIONS,
  CALL_HANDLERS,
  CALL_STATUSES,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  PRIORITIES,
  CONNECTION_TYPES,
  DOOR_TYPES,
  CONTRACT_STATUSES,
  CUSTOMER_STATUSES,
  CUSTOMER_TYPES,
  INVOICE_ITEM_TYPES,
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  RECORD_STATUSES,
  UNIT_STATUSES,
} from "../../src/modules/self-storage/types/enums.ts";

const texto = (max: number) => z.string().trim().min(1, "no puede estar vacío").max(max);
const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();
const codigo = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,19}$/, "sólo letras, números, guion y guion bajo (máx. 20)");
const uuid = z.uuid("identificador no válido");
const cm = z.number().int("en centímetros, sin decimales").positive().max(10_000);
const medida = z.number().positive().max(100_000);
const importe = z.number().min(0).max(1_000_000);
const iva = z.number().min(0).max(100);
const urlHttps = z
  .string()
  .trim()
  .regex(/^https:\/\/\S+$/, "tiene que ser una URL https://")
  .max(1000)
  .nullable()
  .optional();
const idForma = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z_][\w.:-]*$/, "no es un id de SVG válido")
  .nullable()
  .optional();

// ── Centros y zonas ──────────────────────────────────────────────────────────

// Los esquemas de CAMBIO se construyen con los mismos campos pero SIN valores
// por defecto: en zod un `.default()` sobrevive a `.partial()`, y un PATCH que
// sólo cambia el nombre acabaría devolviendo el país a «ES» o la visibilidad a
// «false» sin que nadie lo pidiera.

const camposCentro = {
  name: texto(120),
  address: textoOpcional(200),
  postalCode: textoOpcional(10),
  city: textoOpcional(100),
  province: textoOpcional(100),
  country: z.string().trim().toUpperCase().length(2),
  timezone: z.string().trim().min(3).max(60),
  phone: textoOpcional(30),
  email: z.email("email no válido").nullable().optional(),
  publicVisible: z.boolean(),
};
export const centroAlta = z.strictObject({
  ...camposCentro,
  code: codigo,
  country: camposCentro.country.default("ES"),
  timezone: camposCentro.timezone.default("Europe/Madrid"),
  publicVisible: camposCentro.publicVisible.default(false),
});
export const centroCambio = z.strictObject({ ...camposCentro, status: z.enum(RECORD_STATUSES) }).partial();

const camposZona = {
  name: texto(120),
  floor: textoOpcional(40),
  sortOrder: z.number().int().min(0).max(10_000),
};
export const zonaAlta = z.strictObject({ ...camposZona, code: codigo, sortOrder: camposZona.sortOrder.default(0) });
export const zonaCambio = z.strictObject({ ...camposZona, status: z.enum(RECORD_STATUSES) }).partial();

// ── Tipos de trastero ────────────────────────────────────────────────────────

const camposTipo = {
  name: texto(120),
  widthCm: cm,
  lengthCm: cm,
  heightCm: cm,
  nominalAreaM2: medida,
  nominalVolumeM3: medida,
  image3dUrl: urlHttps,
  capacityDescription: textoOpcional(2000),
  capacityExamples: z.array(z.string().trim().min(1).max(120)).max(30),
  sortOrder: z.number().int().min(0).max(10_000),
  active: z.boolean(),
};
export const tipoAlta = z.strictObject({
  ...camposTipo,
  centerId: uuid.nullable().default(null),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_.-]{0,29}$/, "sólo letras, números, punto, guion y guion bajo (máx. 30)"),
  nominalAreaM2: medida.optional(),
  nominalVolumeM3: medida.optional(),
  capacityExamples: camposTipo.capacityExamples.default([]),
  sortOrder: camposTipo.sortOrder.default(0),
  active: camposTipo.active.default(true),
});
export const tipoCambio = z.strictObject(camposTipo).partial();

// ── Trasteros ────────────────────────────────────────────────────────────────

const camposTrastero = {
  zoneId: uuid,
  unitTypeId: uuid.nullable().optional(),
  code: z.string().trim().min(1).max(40),
  name: textoOpcional(120),
  widthCm: cm,
  lengthCm: cm,
  heightCm: cm,
  areaM2: medida,
  volumeM3: medida,
  monthlyPrice: importe,
  /** Cuota de IVA en EUROS (no porcentaje). El tipo es el IVA general. */
  vatAmount: importe,
  monthlyPriceGross: importe,
  depositAmount: importe,
  image3dUrl: urlHttps,
  floorPlanShapeId: idForma,
  publicVisible: z.boolean(),
  notes: textoOpcional(2000),
};
export const trasteroAlta = z.strictObject({
  ...camposTrastero,
  centerId: uuid,
  areaM2: medida.optional(),
  volumeM3: medida.optional(),
  monthlyPrice: importe.optional(),
  vatAmount: importe.optional(),
  monthlyPriceGross: importe.optional(),
  depositAmount: importe.default(0),
  publicVisible: z.boolean().default(true),
});
export const trasteroCambio = z.strictObject(camposTrastero).partial();

export const trasteroEstado = z.strictObject({
  status: z.enum(UNIT_STATUSES),
  reason: textoOpcional(500),
});

export const trasteroForma = z.strictObject({ shapeId: idForma });

export const filtroTrasteros = z.object({
  centerId: uuid.optional(),
  zoneId: uuid.optional(),
  unitTypeId: uuid.optional(),
  status: z.enum(UNIT_STATUSES).optional(),
  q: z.string().trim().max(60).optional(),
});

// ── Plano ────────────────────────────────────────────────────────────────────

export const planoSubida = z.strictObject({
  name: textoOpcional(80),
  svg: z.string().min(1).max(2_000_000),
});

// ── Clientes ─────────────────────────────────────────────────────────────────

const clienteBase = {
  customerType: z.enum(CUSTOMER_TYPES),
  firstName: textoOpcional(80),
  lastName: textoOpcional(120),
  companyName: textoOpcional(200),
  taxId: z.string().trim().min(1).max(30),
  phone: z.string().trim().min(6).max(30),
  email: z.email("email no válido").max(200),
  address: textoOpcional(200),
  postalCode: textoOpcional(10),
  city: textoOpcional(100),
  province: textoOpcional(100),
  country: z.string().trim().toUpperCase().length(2),
  notes: textoOpcional(2000),
};

export const clienteAlta = z.strictObject({ ...clienteBase, country: clienteBase.country.default("ES") });
export const clienteCambio = z
  .strictObject({
    ...clienteBase,
    status: z.enum(CUSTOMER_STATUSES),
    statusReason: textoOpcional(500),
  })
  .partial();

export const telefonoAlta = z.strictObject({
  phone: z.string().trim().min(6).max(30),
  label: textoOpcional(60),
  allowDoorAccess: z.boolean().default(false),
});

export const filtroClientes = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(CUSTOMER_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ── Importación ──────────────────────────────────────────────────────────────

export const importacionAlta = z.strictObject({
  fileName: texto(200),
  /** Contenido del CSV como texto (UTF-8). 5 MB dan para decenas de miles de filas. */
  content: z.string().min(1).max(5_000_000),
  defaultZoneId: uuid.nullable().optional(),
  measureUnit: z.enum(["auto", "m", "cm"]).default("auto"),
  /** Crear al aplicar los tipos (columna `tipo`) que todavía no existan. */
  createMissingTypes: z.boolean().default(true),
});

// ── Fase 2: conceptos, contratos, facturas y pagos ───────────────────────────

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha AAAA-MM-DD");
const motivo = z.string().trim().min(1, "indica el motivo").max(500);

const camposConcepto = {
  name: texto(120),
  defaultPrice: z.number().min(-100_000).max(100_000),
  /** `inherit_default`: usa el IVA general; `custom`: `customTaxRate`. */
  vatPolicy: z.enum(["inherit_default", "custom"]),
  customTaxRate: iva.nullable(),
  taxExemptionReason: textoOpcional(300),
  isRecurring: z.boolean(),
  isRentalComponent: z.boolean(),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(10_000),
};
export const conceptoAlta = z.strictObject({
  ...camposConcepto,
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_-]{0,29}$/, "sólo letras, números, guion y guion bajo"),
  itemType: z.enum(INVOICE_ITEM_TYPES),
  defaultPrice: camposConcepto.defaultPrice.default(0),
  vatPolicy: camposConcepto.vatPolicy.default("inherit_default"),
  customTaxRate: iva.nullable().optional(),
  isRecurring: z.boolean().default(false),
  isRentalComponent: z.boolean().default(false),
  active: z.boolean().default(true),
  sortOrder: camposConcepto.sortOrder.default(100),
}).refine((d) => d.vatPolicy === "inherit_default" || d.customTaxRate != null, {
  message: "con IVA propio hay que indicar el tipo",
  path: ["customTaxRate"],
});
export const conceptoCambio = z.strictObject(camposConcepto).partial();

const extra = z.strictObject({
  billingItemId: uuid,
  quantity: z.number().positive().max(1000).default(1),
  unitPrice: z.number().min(-100_000).max(100_000).nullable().optional(),
  description: textoOpcional(200),
});

const camposContrato = {
  startDate: fecha,
  endDate: fecha.nullable().optional(),
  // Precio comercial: si no se da, se copia el del trastero.
  monthlyPrice: importe.nullable().optional(),
  monthlyPriceGross: importe.nullable().optional(),
  taxRate: iva.nullable().optional(),
  depositAmount: importe.optional(),
  billingDay: z.number().int().min(1).max(28).optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable().optional(),
  notes: textoOpcional(2000),
  extras: z.array(extra).max(20).optional(),
};
export const contratoAlta = z
  .strictObject({ ...camposContrato, customerId: uuid, unitId: uuid })
  .refine((d) => !d.endDate || d.endDate >= d.startDate, { message: "la fecha de fin no puede ser anterior al inicio", path: ["endDate"] });
export const contratoCambio = z.strictObject(camposContrato).partial();

export const filtroContratos = z.object({
  status: z.enum(CONTRACT_STATUSES).optional(),
  customerId: uuid.optional(),
  unitId: uuid.optional(),
  centerId: uuid.optional(),
  q: z.string().trim().max(60).optional(),
});

export const firmaContrato = z.strictObject({
  signerName: texto(200),
  documentId: uuid.optional(),
  // Confirmación explícita: la aceptación no se deduce de un clic accidental.
  accepted: z.literal(true, { message: "hay que aceptar las condiciones" }),
});
export const conMotivo = z.strictObject({ reason: motivo });
export const suspension = z.strictObject({ reason: z.enum(["security", "incident", "manual"]), notes: motivo });
export const finalizacion = z.strictObject({ endDate: fecha.nullable().optional(), reason: motivo });
export const anexo = z.strictObject({ text: z.string().trim().min(1).max(5000) });

export const facturaBorrador = z.strictObject({
  customerId: uuid,
  contractId: uuid.nullable().optional(),
  dueDate: fecha.nullable().optional(),
  notes: textoOpcional(1000),
  lines: z
    .array(
      z.strictObject({
        billingItemId: uuid,
        quantity: z.number().positive().max(10_000),
        unitPrice: z.number().min(-100_000).max(100_000).nullable().optional(),
        description: textoOpcional(300),
      })
    )
    .min(1)
    .max(50),
});

export const filtroFacturas = z.object({
  customerId: uuid.optional(),
  contractId: uuid.optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
  q: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const pagoManual = z.strictObject({
  invoiceId: uuid,
  paymentMethod: z.enum(["bank_transfer", "cash"]),
  paidAt: z.iso.datetime({ offset: true }).optional(),
  notes: textoOpcional(500),
});

export const filtroPagos = z.object({
  customerId: uuid.optional(),
  contractId: uuid.optional(),
  invoiceId: uuid.optional(),
  status: z.enum(PAYMENT_STATUSES).optional(),
});

export const ajusteCambio = z.strictObject({ value: z.unknown(), centerId: uuid.nullable().optional() });

// ── Fase 3: accesos físicos ──────────────────────────────────────────────────

const instante = z.iso.datetime({ offset: true });
const telefonoTexto = z.string().trim().min(6).max(30);
const jsonPlano = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));

const camposSalida = {
  outputNumber: z.number().int().min(1).max(64),
  name: texto(80),
  outputType: z.enum(["relay", "digital_output"]),
  pulseDurationMs: z.number().int().min(100).max(30_000),
  enabled: z.boolean(),
};
export const salidaAlta = z.strictObject({
  ...camposSalida,
  outputType: camposSalida.outputType.default("digital_output"),
  pulseDurationMs: camposSalida.pulseDurationMs.default(1500),
  enabled: z.boolean().default(true),
});
export const salidaCambio = z.strictObject(camposSalida).partial();

const camposDispositivo = {
  name: texto(120),
  manufacturer: texto(60),
  model: texto(60),
  serial: textoOpcional(80),
  imei: textoOpcional(30),
  phoneNumber: telefonoTexto.nullable().optional(),
  connectionType: z.enum(CONNECTION_TYPES),
  endpoint: z.string().trim().regex(/^https?:\/\/[^\s@]+$/, "URL http(s)://host[:puerto]").max(300).nullable().optional(),
  /** NOMBRE de la variable de entorno con las credenciales. Nunca la credencial. */
  credentialsSecretName: z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,80}$/, "nombre de variable de entorno en MAYÚSCULAS").nullable().optional(),
  driverOptions: jsonPlano,
  simulation: jsonPlano,
  phoneAccessMode: z.enum(["none", "rut_whitelist"]),
  enabled: z.boolean(),
  notes: textoOpcional(1000),
};
export const dispositivoAlta = z.strictObject({
  ...camposDispositivo,
  centerId: uuid,
  manufacturer: camposDispositivo.manufacturer.default("Teltonika"),
  model: camposDispositivo.model.default("RUT241"),
  connectionType: camposDispositivo.connectionType.default("mock"),
  driverOptions: jsonPlano.optional(),
  simulation: jsonPlano.optional(),
  phoneAccessMode: camposDispositivo.phoneAccessMode.default("rut_whitelist"),
  enabled: z.boolean().default(true),
  outputs: z.array(z.strictObject({ ...camposSalida, outputType: camposSalida.outputType.default("digital_output"), pulseDurationMs: camposSalida.pulseDurationMs.default(1500), enabled: z.boolean().default(true) })).max(64).default([{ outputNumber: 1, name: "Salida 1", outputType: "digital_output", pulseDurationMs: 1500, enabled: true }]),
});
export const dispositivoCambio = z.strictObject(camposDispositivo).partial();

const horario = z
  .strictObject({
    timezone: z.string().trim().max(60).optional(),
    rules: z.array(z.strictObject({ days: z.array(z.number().int().min(1).max(7)).min(1).max(7), from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) })).max(20),
  })
  .nullable();

const camposPuerta = {
  zoneId: uuid.nullable().optional(),
  name: texto(120),
  doorType: z.enum(DOOR_TYPES),
  deviceOutputId: uuid.nullable().optional(),
  enabled: z.boolean(),
  allowApp: z.boolean(),
  allowPhone: z.boolean(),
  accessSchedule: horario.optional(),
  sortOrder: z.number().int().min(0).max(10_000),
};
export const puertaAlta = z.strictObject({
  ...camposPuerta,
  centerId: uuid,
  doorType: camposPuerta.doorType.default("main"),
  enabled: z.boolean().default(true),
  allowApp: z.boolean().default(true),
  allowPhone: z.boolean().default(true),
  sortOrder: camposPuerta.sortOrder.default(0),
});
export const puertaCambio = z.strictObject(camposPuerta).partial();

export const aperturaAdmin = z.strictObject({ reason: textoOpcional(300) });
export const aperturaPortal = z.strictObject({ doorId: uuid });
export const aperturaEnlace = z.strictObject({ token: z.string().trim().min(20).max(100), doorId: uuid });

const camposMiembro = {
  fullName: texto(160),
  phone: telefonoTexto.nullable().optional(),
  email: z.email().nullable().optional(),
  allowApp: z.boolean(),
  allowPhone: z.boolean(),
  notes: textoOpcional(500),
};
export const miembroAlta = z.strictObject({ ...camposMiembro, allowApp: z.boolean().default(false), allowPhone: z.boolean().default(false) });
export const miembroCambio = z.strictObject({ ...camposMiembro, status: z.enum(["active", "suspended", "revoked"]) }).partial();

export const permisoManual = z
  .strictObject({ doorId: uuid, validFrom: instante.nullable().optional(), validUntil: instante.nullable().optional(), notes: textoOpcional(300) })
  .refine((d) => !d.validFrom || !d.validUntil || d.validUntil > d.validFrom, { message: "la fecha de fin tiene que ser posterior al inicio", path: ["validUntil"] });

export const temporalAlta = z
  .strictObject({
    centerId: uuid.nullable().optional(),
    contractId: uuid.nullable().optional(),
    customerId: uuid.nullable().optional(),
    holderType: z.enum(["holder", "guest"]).default("guest"),
    fullName: texto(160),
    phone: telefonoTexto.nullable().optional(),
    email: z.email().nullable().optional(),
    startsAt: instante,
    endsAt: instante,
    /** null = sin límite dentro de las fechas. */
    maxUses: z.number().int().min(1).max(1000).nullable().optional(),
    doorIds: z.array(uuid).min(1).max(20),
    withLink: z.boolean().default(false),
    notes: textoOpcional(500),
  })
  .refine((d) => new Date(d.endsAt) > new Date(d.startsAt), { message: "el fin tiene que ser posterior al inicio", path: ["endsAt"] });

export const filtroEventos = z.object({
  doorId: uuid.optional(),
  customerId: uuid.optional(),
  contractId: uuid.optional(),
  centerId: uuid.optional(),
  decision: z.enum(["granted", "denied"]).optional(),
  method: z.enum(ACCESS_METHODS).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});


// ── Call Center ─────────────────────────────────────────────────────────────

const codigoCatalogo = z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/, "código: minúsculas, números y _");
const idioma = z.string().trim().regex(/^[a-z]{2}$/, "idioma: código de dos letras (es, ca…)");

/** Alta de una llamada. Quien llama no se convierte en cliente por llamar. */
export const llamadaAlta = z.strictObject({
  phone: telefonoTexto.nullable().optional(),
  callerName: textoOpcional(160),
  centerId: uuid.nullable().optional(),
  direction: z.enum(CALL_DIRECTIONS).default("incoming"),
  handledBy: z.enum(CALL_HANDLERS).default("human"),
  language: idioma.nullable().optional(),
  reasonCode: codigoCatalogo.nullable().optional(),
  priority: z.enum(PRIORITIES).optional(),
  notes: textoOpcional(4000),
  /** La persona ya está hablando: la llamada empieza contestada. */
  answered: z.boolean().default(true),
});

/** Cambios durante la llamada (no el resultado: ese tiene su propia acción). */
export const llamadaCambio = z
  .strictObject({
    callerName: textoOpcional(160),
    centerId: uuid.nullable(),
    customerId: uuid.nullable(),
    contractId: uuid.nullable(),
    language: idioma.nullable(),
    reasonCode: codigoCatalogo.nullable(),
    priority: z.enum(PRIORITIES),
    summary: textoOpcional(4000),
    notes: textoOpcional(4000),
    transcript: textoOpcional(100_000),
  })
  .partial();

export const llamadaResultado = z.strictObject({
  resultCode: codigoCatalogo,
  summary: textoOpcional(4000),
  notes: textoOpcional(4000),
  /** Para resultados con seguimiento; por defecto, mañana. */
  followUpAt: instante.nullable().optional(),
});

export const llamadaEscalado = z.strictObject({
  reason: texto(500),
  summary: textoOpcional(4000),
  priority: z.enum(PRIORITIES).optional(),
});

export const llamadaSeguimiento = z.strictObject({
  followUpAt: instante.nullable().optional(),
  done: z.boolean().default(false),
  notes: textoOpcional(2000),
});

export const filtroLlamadas = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  centerId: uuid.optional(),
  customerId: uuid.optional(),
  phone: z.string().trim().max(30).optional(),
  language: idioma.optional(),
  reasonCode: codigoCatalogo.optional(),
  resultCode: codigoCatalogo.optional(),
  status: z.enum(CALL_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  handledBy: z.enum(CALL_HANDLERS).optional(),
  direction: z.enum(CALL_DIRECTIONS).optional(),
  operatorUserId: uuid.optional(),
  telephonyProvider: z.string().trim().max(40).optional(),
  pendingFollowUp: z.enum(["1", "true"]).optional(),
  interested: z.enum(["1", "true"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const catalogoAlta = z.strictObject({
  kind: z.enum(["reason", "result"]),
  code: codigoCatalogo,
  label: texto(80),
  defaultPriority: z.enum(PRIORITIES).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});
export const catalogoCambio = z
  .strictObject({
    label: texto(80),
    active: z.boolean(),
    defaultPriority: z.enum(PRIORITIES).nullable(),
    sortOrder: z.number().int().min(0).max(10_000),
  })
  .partial();

// ── Incidencias ─────────────────────────────────────────────────────────────

export const incidenciaAlta = z.strictObject({
  centerId: uuid,
  customerId: uuid.nullable().optional(),
  contractId: uuid.nullable().optional(),
  callId: uuid.nullable().optional(),
  incidentType: z.enum(INCIDENT_TYPES),
  /** Las de acceso, seguridad y emergencia se fuerzan a urgente. */
  priority: z.enum(PRIORITIES).optional(),
  title: texto(200),
  description: textoOpcional(4000),
});

export const incidenciaCambio = z
  .strictObject({
    status: z.enum(INCIDENT_STATUSES),
    priority: z.enum(PRIORITIES),
    resolution: textoOpcional(4000),
    description: textoOpcional(4000),
    assignedTo: uuid.nullable(),
  })
  .partial();

export const filtroIncidencias = z.object({
  centerId: uuid.optional(),
  customerId: uuid.optional(),
  callId: uuid.optional(),
  status: z.enum(INCIDENT_STATUSES).optional(),
  open: z.enum(["1", "true"]).optional(),
  priority: z.enum(PRIORITIES).optional(),
  incidentType: z.enum(INCIDENT_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

// ── Asistente IA ────────────────────────────────────────────────────────────

const idiomaIA = z.string().trim().regex(/^[a-z]{2}$/, "idioma: código de dos letras (es, ca…)");
const categoriaIA = z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/, "categoría: minúsculas, números y _");

export const conocimientoAlta = z.strictObject({
  centerId: uuid.nullable().optional(),
  category: categoriaIA,
  question: texto(500),
  answer: texto(4000),
  language: idiomaIA.default("es"),
  active: z.boolean().default(true),
  priority: z.number().int().min(0).max(100).default(0),
});
export const conocimientoCambio = z
  .strictObject({
    centerId: uuid.nullable(),
    category: categoriaIA,
    question: texto(500),
    answer: texto(4000),
    language: idiomaIA,
    active: z.boolean(),
    priority: z.number().int().min(0).max(100),
  })
  .partial();
export const conocimientoInicial = z.strictObject({ pack: z.enum(["tlc"]), centerId: uuid.nullable().optional() });

/** Empezar una sesión: sobre una llamada existente, creando una (simulada) o sin llamada (consola). */
export const sesionAlta = z.strictObject({
  callId: uuid.nullable().optional(),
  centerId: uuid.nullable().optional(),
  language: idiomaIA.nullable().optional(),
  simulateCall: z.strictObject({ phone: telefonoTexto.nullable().optional(), callerName: textoOpcional(160) }).nullable().optional(),
});
export const sesionMensaje = z.strictObject({ text: texto(2000) });
export const sesionEscalado = z.strictObject({ reason: texto(500) });
export const sesionRevision = z.strictObject({ reviewStatus: z.enum(["correct", "partial", "incorrect"]), notes: textoOpcional(2000) });
export const herramientaCambio = z.strictObject({ active: z.boolean(), requiresConfirmation: z.boolean() }).partial();
export const filtroSesiones = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  status: z.enum(["active", "finished", "escalated", "error"]).optional(),
  provider: z.string().trim().max(40).optional(),
  language: idiomaIA.optional(),
  flagged: z.enum(["1", "true"]).optional(),
  reviewStatus: z.enum(["correct", "partial", "incorrect", "pending"]).optional(),
  callId: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
