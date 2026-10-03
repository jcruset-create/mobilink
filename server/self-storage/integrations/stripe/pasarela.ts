/**
 * Pasarela de cobro: la ÚNICA puerta del módulo hacia la API de Stripe.
 *
 * El resto del código habla con esta interfaz, no con el SDK. Así:
 *   · el secreto de Stripe sólo lo toca este fichero (y sólo en el servidor);
 *   · las pruebas sustituyen la pasarela por una en memoria y recorren el
 *     circuito completo sin red;
 *   · cambiar de versión de la API afecta a un fichero.
 *
 * Las claves: SELF_STORAGE_STRIPE_SECRET_KEY (o, si no hay, la STRIPE_SECRET_KEY
 * común de Mobilink). El webhook del módulo tiene SU secreto propio
 * (SELF_STORAGE_STRIPE_WEBHOOK_SECRET): es otro endpoint.
 */

import Stripe from "stripe";
import { ErrorSelfStorage } from "../../errors.ts";

export type TipoMetodo = "card" | "sepa_debit";

export type LineaCheckout = {
  productId: string;
  /** Céntimos CON IVA (Stripe cobra el importe final; el desglose fiscal es nuestro). */
  unitAmountCents: number;
  quantity: number;
  recurring: boolean;
};

export type MetodoPago = { id: string; type: string; brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null; isDefault: boolean };

export interface PasarelaStripe {
  crearCliente(d: { email: string; name: string; metadata: Record<string, string>; idempotencyKey: string }): Promise<{ id: string }>;
  crearProducto(d: { name: string; metadata: Record<string, string>; idempotencyKey: string }): Promise<{ id: string }>;
  /** Checkout en modo suscripción: primer cobro, mandato SEPA y SCA los gestiona Stripe. */
  crearCheckoutSuscripcion(d: {
    customerId: string;
    lineas: LineaCheckout[];
    billingCycleAnchor: number | null;
    metodos: TipoMetodo[];
    metadata: Record<string, string>;
    successUrl: string;
    cancelUrl: string;
    idempotencyKey: string;
  }): Promise<{ id: string; url: string }>;
  /** Checkout en modo pago: una factura nuestra que se paga con tarjeta/SEPA. */
  crearCheckoutPago(d: {
    customerId: string;
    amountCents: number;
    description: string;
    metodos: TipoMetodo[];
    metadata: Record<string, string>;
    successUrl: string;
    cancelUrl: string;
    idempotencyKey: string;
  }): Promise<{ id: string; url: string }>;
  /** Checkout en modo setup: añadir o cambiar el método de pago. */
  crearCheckoutMetodo(d: { customerId: string; metodos: TipoMetodo[]; metadata: Record<string, string>; successUrl: string; cancelUrl: string }): Promise<{ id: string; url: string }>;
  listarMetodosPago(customerId: string): Promise<MetodoPago[]>;
  /** Tras añadir un método con Checkout setup, que sea el de las próximas facturas. */
  fijarMetodoPorDefecto(customerId: string, setupIntentId: string, subscriptionIds: string[]): Promise<void>;
  cancelarSuscripcion(subscriptionId: string): Promise<void>;
}

// ── Implementación real (SDK de Stripe) ─────────────────────────────────────

let instancia: Stripe | null = null;

export function claveSecreta(): string | null {
  return process.env.SELF_STORAGE_STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY || null;
}

function sdk(): Stripe {
  const clave = claveSecreta();
  if (!clave) throw new ErrorSelfStorage("STRIPE_NO_CONFIGURADO", "Stripe no está configurado en este servidor.", 503);
  instancia ??= new Stripe(clave, { apiVersion: "2026-04-22.dahlia" });
  return instancia;
}

const pasarelaReal: PasarelaStripe = {
  async crearCliente(d) {
    const c = await sdk().customers.create({ email: d.email, name: d.name, metadata: d.metadata }, { idempotencyKey: d.idempotencyKey });
    return { id: c.id };
  },
  async crearProducto(d) {
    const p = await sdk().products.create({ name: d.name, metadata: d.metadata }, { idempotencyKey: d.idempotencyKey });
    return { id: p.id };
  },
  async crearCheckoutSuscripcion(d) {
    const s = await sdk().checkout.sessions.create(
      {
        mode: "subscription",
        customer: d.customerId,
        payment_method_types: d.metodos,
        line_items: d.lineas.map((l) => ({
          quantity: l.quantity,
          price_data: {
            currency: "eur",
            product: l.productId,
            unit_amount: l.unitAmountCents,
            ...(l.recurring ? { recurring: { interval: "month" as const } } : {}),
          },
        })),
        subscription_data: {
          metadata: d.metadata,
          ...(d.billingCycleAnchor ? { billing_cycle_anchor: d.billingCycleAnchor } : {}),
        },
        metadata: d.metadata,
        success_url: d.successUrl,
        cancel_url: d.cancelUrl,
      },
      { idempotencyKey: d.idempotencyKey }
    );
    return { id: s.id, url: s.url ?? "" };
  },
  async crearCheckoutPago(d) {
    const s = await sdk().checkout.sessions.create(
      {
        mode: "payment",
        customer: d.customerId,
        payment_method_types: d.metodos,
        line_items: [{ quantity: 1, price_data: { currency: "eur", unit_amount: d.amountCents, product_data: { name: d.description } } }],
        payment_intent_data: { metadata: d.metadata },
        metadata: d.metadata,
        success_url: d.successUrl,
        cancel_url: d.cancelUrl,
      },
      { idempotencyKey: d.idempotencyKey }
    );
    return { id: s.id, url: s.url ?? "" };
  },
  async crearCheckoutMetodo(d) {
    const s = await sdk().checkout.sessions.create({
      mode: "setup",
      customer: d.customerId,
      payment_method_types: d.metodos,
      metadata: d.metadata,
      success_url: d.successUrl,
      cancel_url: d.cancelUrl,
    });
    return { id: s.id, url: s.url ?? "" };
  },
  async listarMetodosPago(customerId) {
    const [cliente, metodos] = await Promise.all([
      sdk().customers.retrieve(customerId),
      sdk().paymentMethods.list({ customer: customerId, limit: 20 }),
    ]);
    const porDefecto = !("deleted" in cliente && cliente.deleted) ? (cliente as Stripe.Customer).invoice_settings?.default_payment_method : null;
    const idDefecto = typeof porDefecto === "string" ? porDefecto : porDefecto?.id;
    return metodos.data.map((m) => ({
      id: m.id,
      type: m.type,
      brand: m.card?.brand ?? null,
      last4: m.card?.last4 ?? m.sepa_debit?.last4 ?? null,
      expMonth: m.card?.exp_month ?? null,
      expYear: m.card?.exp_year ?? null,
      isDefault: m.id === idDefecto,
    }));
  },
  async fijarMetodoPorDefecto(customerId, setupIntentId, subscriptionIds) {
    const si = await sdk().setupIntents.retrieve(setupIntentId);
    const pm = typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id;
    if (!pm) return;
    await sdk().customers.update(customerId, { invoice_settings: { default_payment_method: pm } });
    for (const sub of subscriptionIds) await sdk().subscriptions.update(sub, { default_payment_method: pm });
  },
  async cancelarSuscripcion(subscriptionId) {
    await sdk().subscriptions.cancel(subscriptionId);
  },
};

let actual: PasarelaStripe = pasarelaReal;

export function pasarela(): PasarelaStripe {
  return actual;
}

/** Sólo pruebas: sustituye la pasarela por una en memoria. */
export function fijarPasarela(p: PasarelaStripe | null) {
  actual = p ?? pasarelaReal;
}

// ── Webhook: verificación de firma ──────────────────────────────────────────

export function secretoWebhook(): string | null {
  return process.env.SELF_STORAGE_STRIPE_WEBHOOK_SECRET || null;
}

/**
 * Verifica la firma con el SDK (no hace falta red ni clave de API). Lanza si
 * la firma no es buena o si no hay secreto configurado: un webhook sin
 * verificar no se procesa nunca.
 */
export function verificarEvento(cuerpo: Buffer, firma: string | undefined): Stripe.Event {
  const secreto = secretoWebhook();
  if (!secreto) throw new ErrorSelfStorage("WEBHOOK_SIN_SECRETO", "El webhook de Self Storage no tiene secreto configurado.", 503);
  if (!firma) throw new ErrorSelfStorage("FIRMA_AUSENTE", "Falta la cabecera stripe-signature.", 400);
  try {
    return Stripe.webhooks.constructEvent(cuerpo, firma, secreto);
  } catch (e) {
    throw new ErrorSelfStorage("FIRMA_NO_VALIDA", `Firma de Stripe no válida: ${e instanceof Error ? e.message : String(e)}`, 400);
  }
}
