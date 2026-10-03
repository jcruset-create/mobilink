import { describe, expect, it } from "vitest";
import { accionesPosibles, exigirEditable, transicion } from "./contractState.ts";
import { calcularLinea, desglosarBruto, formatearNumero, lineasDelPeriodo, periodoDesde, siguienteAncla, totales } from "./facturacion.ts";
import { decidirMensualidad, decidirPrimerCobro } from "./cobros.ts";
import { accionesPendientes, validarPolitica } from "./impagos.ts";
import { levantablesPorPago, levantablesPorPersona, quedanBloqueos } from "./bloqueos.ts";
import { lineasDeFactura, metadataDeFactura, paymentIntentDeFactura, periodoDeFactura, suscripcionDeFactura } from "./stripeMapping.ts";

describe("estados del contrato", () => {
  it("el camino feliz y sus salidas", () => {
    expect(transicion("draft", "issue")).toBe("pending_signature");
    expect(transicion("pending_signature", "sign")).toBe("pending_payment");
    expect(transicion("pending_payment", "activate")).toBe("active");
    expect(transicion("active", "suspend")).toBe("suspended");
    expect(transicion("suspended", "reactivate")).toBe("active");
    expect(transicion("suspended", "terminate")).toBe("terminated");
  });
  it("cancelar sólo antes de activar; finalizar sólo lo activo", () => {
    expect(transicion("pending_payment", "cancel")).toBe("cancelled");
    expect(() => transicion("active", "cancel")).toThrow(/cancelar/);
    expect(() => transicion("pending_payment", "terminate")).toThrow(/finalizar/);
    expect(() => transicion("terminated", "reactivate")).toThrow();
    expect(accionesPosibles("active").sort()).toEqual(["suspend", "terminate"]);
  });
  it("sólo el borrador se edita", () => {
    expect(() => exigirEditable("draft")).not.toThrow();
    expect(() => exigirEditable("pending_signature")).toThrow(/borrador/);
  });
});

describe("facturación: líneas, totales y periodos", () => {
  it("cada línea redondea su base y su cuota; el total es la suma", () => {
    const l = [calcularLinea({ itemType: "rental", description: "a", quantity: 1, unitPrice: 49.59, taxRate: 21 }), calcularLinea({ itemType: "deposit", description: "f", quantity: 1, unitPrice: 60, taxRate: 0 })];
    expect(l[0]).toMatchObject({ subtotal: 49.59, taxAmount: 10.41, total: 60 });
    expect(totales(l)).toEqual({ subtotal: 109.59, tax: 10.41, total: 120 });
  });
  it("el desglose de un bruto de Stripe cuadra al céntimo", () => {
    for (const bruto of [60, 59.99, 0.01, 123.45, -10]) {
      const d = desglosarBruto(bruto, 21);
      expect(Math.round((d.subtotal + d.taxAmount) * 100)).toBe(Math.round(bruto * 100));
    }
  });
  it("siguiente día de facturación", () => {
    expect(siguienteAncla("2026-10-03", 1)).toBe("2026-11-01");
    expect(siguienteAncla("2026-10-01", 1)).toBe("2026-11-01");
    expect(siguienteAncla("2026-10-03", 15)).toBe("2026-10-15");
    expect(siguienteAncla("2026-12-20", 5)).toBe("2027-01-05");
  });
  it("periodo completo si se empieza el día de facturación; prorrata si no", () => {
    expect(periodoDesde("2026-10-01", 1)).toEqual({ start: "2026-10-01", end: "2026-10-31", fraccion: 1 });
    const p = periodoDesde("2026-10-16", 1);
    expect(p.start).toBe("2026-10-16");
    expect(p.end).toBe("2026-10-31");
    expect(p.fraccion).toBeCloseTo(16 / 31, 10);
    expect(periodoDesde("2026-02-01", 1).end).toBe("2026-02-28");
  });
  it("la primera factura lleva fianza y conceptos de una vez; las siguientes, no", () => {
    const c = {
      monthlyPrice: 49.59,
      taxRate: 21,
      depositAmount: 60,
      depositTaxRate: 0,
      billingDay: 1,
      unitCode: "2-014",
      extras: [
        { itemType: "insurance" as const, description: "Seguro", quantity: 1, unitPrice: 5, taxRate: 0, isRecurring: true, billingItemId: null },
        { itemType: "lock" as const, description: "Candado", quantity: 1, unitPrice: 10, taxRate: 21, isRecurring: false, billingItemId: null },
      ],
    };
    const primera = lineasDelPeriodo(c, periodoDesde("2026-10-01", 1), true);
    expect(primera.map((l) => l.itemType)).toEqual(["rental", "insurance", "deposit", "lock"]);
    const siguiente = lineasDelPeriodo(c, periodoDesde("2026-11-01", 1), false);
    expect(siguiente.map((l) => l.itemType)).toEqual(["rental", "insurance"]);
    const prorrata = lineasDelPeriodo(c, periodoDesde("2026-10-16", 1), false);
    expect(prorrata[0].unitPrice).toBe(25.59); // 49,59 × 16/31 = 25,5948…
  });
  it("con PVP pactado, el alquiler se factura por el PVP exacto (sin el céntimo del redondeo)", () => {
    // 55 € con IVA → base 45,45; 45,45 × 1,21 = 54,99. La factura tiene que decir 55.
    const c = { monthlyPrice: 45.45, monthlyPriceGross: 55, taxRate: 21, depositAmount: 0, depositTaxRate: 0, billingDay: 1, unitCode: "1-002", extras: [] };
    const [mes] = lineasDelPeriodo(c, periodoDesde("2026-10-01", 1), false);
    expect(mes).toMatchObject({ subtotal: 45.45, taxAmount: 9.55, total: 55 });
    const [medio] = lineasDelPeriodo(c, periodoDesde("2026-10-16", 1), false);
    expect(medio.total).toBe(28.39); // 55 × 16/31
    expect(medio.subtotal + medio.taxAmount).toBeCloseTo(medio.total, 10);
  });
  it("número de factura", () => {
    expect(formatearNumero("F", 2026, 1)).toBe("F-2026-000001");
    expect(formatearNumero("C", 2026, 123456)).toBe("C-2026-123456");
  });
});

describe("cobros: primer pago frente a mensualidad", () => {
  it("primer SEPA en processing: espera por defecto, activa con la política permisiva", () => {
    expect(decidirPrimerCobro("sepa", "processing", "wait_for_success")).toBe("esperar");
    expect(decidirPrimerCobro("sepa", "processing", "allow_while_processing")).toBe("activar");
    expect(decidirPrimerCobro("card", "processing", "allow_while_processing")).toBe("esperar");
    expect(decidirPrimerCobro("card", "succeeded", "wait_for_success")).toBe("activar");
    expect(decidirPrimerCobro("sepa", "failed", "allow_while_processing")).toBe("fallido");
  });
  it("una mensualidad en processing no es un impago", () => {
    expect(decidirMensualidad("processing")).toBe("nada");
    expect(decidirMensualidad("pending")).toBe("nada");
    expect(decidirMensualidad("failed")).toBe("abrir_impago");
    expect(decidirMensualidad("succeeded")).toBe("cerrar_impago");
  });
});

describe("impagos", () => {
  const p = { firstNoticeDays: 3, secondNoticeDays: 7, suspendDays: 10 };
  const dia0 = new Date("2026-10-01T10:00:00Z");
  const en = (d: number) => new Date(dia0.getTime() + d * 86_400_000);
  const caso = { openedAt: dia0, firstNoticeAt: null, secondNoticeAt: null, suspendedAt: null };
  it("cada plazo a su día, y cada acción una sola vez", () => {
    expect(accionesPendientes(caso, en(2), p)).toEqual([]);
    expect(accionesPendientes(caso, en(3), p)).toEqual(["first_notice"]);
    expect(accionesPendientes({ ...caso, firstNoticeAt: en(3) }, en(8), p)).toEqual(["second_notice"]);
    expect(accionesPendientes(caso, en(10), p)).toEqual(["first_notice", "second_notice", "suspend"]);
    expect(accionesPendientes({ ...caso, firstNoticeAt: en(3), secondNoticeAt: en(7), suspendedAt: en(10) }, en(40), p)).toEqual([]);
  });
  it("los plazos tienen que ir en orden", () => {
    expect(() => validarPolitica({ firstNoticeDays: 7, secondNoticeDays: 3, suspendDays: 10 })).toThrow();
    expect(validarPolitica(p)).toEqual(p);
  });
});

describe("bloqueos por motivo", () => {
  const b = (id: string, reason: any, lifted = false) => ({ id, reason, liftedAt: lifted ? new Date() : null });
  it("un pago sólo levanta el de impago", () => {
    const todos = [b("1", "payment"), b("2", "security"), b("3", "manual"), b("4", "payment", true)];
    expect(levantablesPorPago(todos).map((x) => x.id)).toEqual(["1"]);
    expect(quedanBloqueos(todos, ["1"]).map((x) => x.reason)).toEqual(["security", "manual"]);
    expect(quedanBloqueos([b("1", "payment")], ["1"])).toEqual([]);
  });
  it("seguridad sólo la levanta un administrador; terminado no se levanta", () => {
    expect(levantablesPorPersona("security", false)).toBe(false);
    expect(levantablesPorPersona("security", true)).toBe(true);
    expect(levantablesPorPersona("manual", false)).toBe(true);
    expect(levantablesPorPersona("terminated", true)).toBe(false);
  });
});

describe("lectura de objetos de Stripe (dos versiones de la API)", () => {
  const nueva = {
    parent: { subscription_details: { subscription: "sub_1", metadata: { ss_contract_id: "k1" } } },
    payments: { data: [{ payment: { payment_intent: "pi_1" } }] },
    lines: { data: [{ amount: 6000, quantity: 1, description: "x", pricing: { price_details: { product: "prod_1" } }, period: { start: 1793491200, end: 1796083200 } }] },
  };
  const vieja = {
    subscription: "sub_2",
    subscription_details: { metadata: { ss_contract_id: "k2" } },
    payment_intent: "pi_2",
    lines: { data: [{ amount: 100, price: { product: "prod_2" }, period: {} }] },
  };
  it("suscripción, metadatos, PaymentIntent y producto", () => {
    expect(suscripcionDeFactura(nueva)).toBe("sub_1");
    expect(suscripcionDeFactura(vieja)).toBe("sub_2");
    expect(metadataDeFactura(nueva).ss_contract_id).toBe("k1");
    expect(metadataDeFactura(vieja).ss_contract_id).toBe("k2");
    expect(paymentIntentDeFactura(nueva)).toBe("pi_1");
    expect(paymentIntentDeFactura(vieja)).toBe("pi_2");
    expect(lineasDeFactura(nueva)[0]).toMatchObject({ productId: "prod_1", amountCents: 6000, periodStart: "2026-11-01", periodEnd: "2026-11-30" });
    expect(lineasDeFactura(vieja)[0].productId).toBe("prod_2");
    expect(periodoDeFactura(lineasDeFactura(nueva))).toEqual({ start: "2026-11-01", end: "2026-11-30" });
  });
});
