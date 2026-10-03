/**
 * Lectura defensiva de objetos de Stripe. Puro.
 *
 * La API cambia de sitio los campos entre versiones (la suscripción de una
 * factura estaba en `invoice.subscription` y ahora en
 * `invoice.parent.subscription_details`; el producto de una línea, en
 * `line.price.product` o en `line.pricing.price_details.product`). Todo lo que
 * leemos de Stripe pasa por aquí, que acepta las dos formas: un webhook de una
 * versión distinta no puede dejar un cobro sin aplicar.
 */

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const id = (v: unknown): string | null => (typeof v === "string" ? v : typeof o(v).id === "string" ? (o(v).id as string) : null);

export function suscripcionDeFactura(inv: Obj): string | null {
  return id(o(o(inv.parent).subscription_details).subscription) ?? id(inv.subscription);
}

export function metadataDeFactura(inv: Obj): Record<string, string> {
  const m = o(o(o(inv.parent).subscription_details).metadata);
  const viejo = o(o(inv.subscription_details).metadata);
  return { ...(viejo as Record<string, string>), ...(m as Record<string, string>) };
}

export function clienteDe(obj: Obj): string | null {
  return id(obj.customer);
}

export function paymentIntentDeFactura(inv: Obj): string | null {
  const pagos = o(inv.payments).data;
  if (Array.isArray(pagos)) {
    for (const p of pagos) {
      const pi = id(o(o(p).payment).payment_intent);
      if (pi) return pi;
    }
  }
  return id(inv.payment_intent);
}

export type LineaStripe = {
  productId: string | null;
  /** Céntimos con IVA de la línea completa (cantidad incluida). */
  amountCents: number;
  quantity: number;
  description: string;
  periodStart: string | null;
  periodEnd: string | null;
};

const fecha = (unix: unknown) => (typeof unix === "number" ? new Date(unix * 1000).toISOString().slice(0, 10) : null);

export function lineasDeFactura(inv: Obj): LineaStripe[] {
  const data = o(inv.lines).data;
  if (!Array.isArray(data)) return [];
  return data.map((l): LineaStripe => {
    const linea = o(l);
    const producto =
      id(o(o(linea.pricing).price_details).product) ?? id(o(linea.price).product) ?? id(o(o(linea.plan)).product);
    const periodo = o(linea.period);
    return {
      productId: producto,
      amountCents: Number(linea.amount ?? 0),
      quantity: Number(linea.quantity ?? 1) || 1,
      description: String(linea.description ?? ""),
      periodStart: fecha(periodo.start),
      // Stripe da el final como instante exclusivo; nuestro periodo es inclusivo.
      periodEnd: typeof periodo.end === "number" ? new Date((periodo.end - 1) * 1000).toISOString().slice(0, 10) : null,
    };
  });
}

/** Periodo de alquiler de la factura: el de la primera línea recurrente con periodo. */
export function periodoDeFactura(lineas: LineaStripe[]): { start: string; end: string } | null {
  const l = lineas.find((x) => x.periodStart && x.periodEnd && x.periodEnd >= x.periodStart);
  return l ? { start: l.periodStart!, end: l.periodEnd! } : null;
}

export const centimosAEuros = (c: number) => Math.round(c) / 100;
export const eurosACentimos = (e: number) => Math.round(e * 100);
