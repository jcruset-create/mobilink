/**
 * Facturación y cobro (fase 2). Sólo tipos en la fase 1.
 *
 * La factura es NUESTRA (numeración correlativa, instantáneas fiscales, PDF);
 * Stripe es el medio de cobro. El tratamiento fiscal es por CONCEPTO y
 * configurable: el código no decide si una fianza lleva IVA.
 */

export const INVOICE_ITEM_TYPES = ["rental", "deposit", "insurance", "lock", "penalty", "discount", "other"] as const;
export type InvoiceItemType = (typeof INVOICE_ITEM_TYPES)[number];

/** Tratamiento fiscal de un concepto facturable (catálogo configurable). */
export type BillingConcept = {
  code: string;
  itemType: InvoiceItemType;
  name: string;
  taxRate: number;
  /** Motivo legal cuando no lleva IVA (exento / no sujeto). */
  taxExemptionReason: string | null;
};

/** Primer cobro SEPA de un cliente NUEVO: por defecto, esperar a que se confirme. */
export type FirstSepaPaymentAccessPolicy = "wait_for_success" | "allow_while_processing";

/** Instantánea fiscal que se congela al emitir una factura. */
export type InvoiceSnapshot = {
  customer: { name: string; taxId: string; address: string | null; postalCode: string | null; city: string | null; province: string | null; country: string };
  issuer: { name: string; taxId: string; address: string };
};
