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
