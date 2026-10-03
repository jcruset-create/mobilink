/**
 * Cálculo de facturas: líneas, IVA, periodos y prorrateo. Puro.
 *
 * Reglas:
 *   · Cada línea redondea a céntimos su base y su cuota; el total de la
 *     factura es la SUMA de líneas (no se recalcula sobre el total): así cada
 *     línea impresa cuadra y la suma también.
 *   · El IVA es el de la línea: el del concepto del catálogo o el del contrato.
 *     Aquí no se presupone ninguno.
 *   · Fechas como 'YYYY-MM-DD' en calendario (sin horas ni zonas): un periodo de
 *     facturación es de días, no de instantes.
 */

import { redondear2 } from "./pricing.ts";
import type { InvoiceItemType } from "../../../src/modules/self-storage/types/enums.ts";

export type LineaEntrada = {
  itemType: InvoiceItemType;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  billingItemId?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
};

export type LineaCalculada = LineaEntrada & { subtotal: number; taxAmount: number; total: number };

export function calcularLinea(l: LineaEntrada): LineaCalculada {
  const subtotal = redondear2(l.quantity * l.unitPrice);
  const taxAmount = redondear2((subtotal * l.taxRate) / 100);
  return { ...l, subtotal, taxAmount, total: redondear2(subtotal + taxAmount) };
}

export function totales(lineas: LineaCalculada[]): { subtotal: number; tax: number; total: number } {
  const subtotal = redondear2(lineas.reduce((s, l) => s + l.subtotal, 0));
  const tax = redondear2(lineas.reduce((s, l) => s + l.taxAmount, 0));
  return { subtotal, tax, total: redondear2(subtotal + tax) };
}

/**
 * Desglose de un importe CON IVA (lo que cobra Stripe) en base + cuota, de
 * forma que base + cuota = importe exacto: la factura cuadra con el cargo.
 */
export function desglosarBruto(bruto: number, taxRate: number): { subtotal: number; taxAmount: number } {
  const subtotal = redondear2(bruto / (1 + taxRate / 100));
  return { subtotal, taxAmount: redondear2(bruto - subtotal) };
}

// ── Fechas de calendario ────────────────────────────────────────────────────

const aFecha = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const aTexto = (d: Date) => d.toISOString().slice(0, 10);
export const sumarDias = (s: string, n: number) => {
  const d = aFecha(s);
  d.setUTCDate(d.getUTCDate() + n);
  return aTexto(d);
};
export const diasEntre = (desde: string, hasta: string) => Math.round((aFecha(hasta).getTime() - aFecha(desde).getTime()) / 86_400_000);

/** El día `dia` del mes de `s` desplazado `meses`. `dia` va de 1 a 28: siempre existe. */
function diaDelMes(s: string, meses: number, dia: number): string {
  const d = aFecha(s);
  return aTexto(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + meses, dia)));
}

/** Primer día de facturación ESTRICTAMENTE posterior a `s`. */
export function siguienteAncla(s: string, diaFacturacion: number): string {
  const d = aFecha(s).getUTCDate();
  return d < diaFacturacion ? diaDelMes(s, 0, diaFacturacion) : diaDelMes(s, 1, diaFacturacion);
}

export type Periodo = { start: string; end: string; /** fracción del mes facturada (1 = completo) */ fraccion: number };

/**
 * Periodo que empieza en `inicio`. Si `inicio` es día de facturación, es un mes
 * completo; si no, va hasta la víspera del siguiente día de facturación y se
 * prorratea por días sobre la duración de ese mes de facturación.
 */
export function periodoDesde(inicio: string, diaFacturacion: number): Periodo {
  const ancla = siguienteAncla(inicio, diaFacturacion);
  const end = sumarDias(ancla, -1);
  if (aFecha(inicio).getUTCDate() === diaFacturacion) return { start: inicio, end, fraccion: 1 };
  const anclaAnterior = diaDelMes(ancla, -1, diaFacturacion);
  const diasMes = diasEntre(anclaAnterior, ancla);
  const dias = diasEntre(inicio, ancla);
  return { start: inicio, end, fraccion: dias / diasMes };
}

export type ContratoFacturable = {
  monthlyPrice: number;
  /**
   * PVP mensual pactado. Si está, el alquiler se factura DESDE él (base y
   * cuota se desglosan del PVP): lo que se cobra es exactamente lo firmado,
   * sin el céntimo de diferencia de redondear la base y volver a sumar el IVA.
   */
  monthlyPriceGross?: number | null;
  taxRate: number;
  depositAmount: number;
  depositTaxRate: number;
  billingDay: number;
  unitCode: string;
  extras: { itemType: InvoiceItemType; description: string; quantity: number; unitPrice: number; taxRate: number; isRecurring: boolean; billingItemId: string | null }[];
};

const fechaEs = (s: string) => s.split("-").reverse().join("/");

/**
 * Líneas de la factura de un periodo. La primera lleva además la fianza y los
 * conceptos de una sola vez (alta, candado…). Las recurrentes se prorratean
 * igual que el alquiler.
 */
export function lineasDelPeriodo(c: ContratoFacturable, periodo: Periodo, primera: boolean): LineaCalculada[] {
  const rango = `${fechaEs(periodo.start)} – ${fechaEs(periodo.end)}`;
  const prorrata = periodo.fraccion < 1 ? ` (prorrata ${Math.round(periodo.fraccion * 10000) / 100} %)` : "";
  const alquiler: LineaEntrada = {
    itemType: "rental",
    description: `Alquiler trastero ${c.unitCode} · ${rango}${prorrata}`,
    quantity: 1,
    unitPrice: redondear2(c.monthlyPrice * periodo.fraccion),
    taxRate: c.taxRate,
    periodStart: periodo.start,
    periodEnd: periodo.end,
  };
  const lineas: LineaEntrada[] = [];
  for (const e of c.extras.filter((x) => x.isRecurring)) {
    lineas.push({
      itemType: e.itemType,
      description: `${e.description} · ${rango}${prorrata}`,
      quantity: e.quantity,
      unitPrice: redondear2(e.unitPrice * periodo.fraccion),
      taxRate: e.taxRate,
      billingItemId: e.billingItemId,
      periodStart: periodo.start,
      periodEnd: periodo.end,
    });
  }
  if (primera) {
    if (c.depositAmount > 0) {
      lineas.push({ itemType: "deposit", description: `Fianza trastero ${c.unitCode}`, quantity: 1, unitPrice: c.depositAmount, taxRate: c.depositTaxRate });
    }
    for (const e of c.extras.filter((x) => !x.isRecurring)) {
      lineas.push({ itemType: e.itemType, description: e.description, quantity: e.quantity, unitPrice: e.unitPrice, taxRate: e.taxRate, billingItemId: e.billingItemId });
    }
  }
  return [lineaAlquiler(alquiler, c, periodo), ...lineas.map(calcularLinea)];
}

function lineaAlquiler(l: LineaEntrada, c: ContratoFacturable, periodo: Periodo): LineaCalculada {
  if (c.monthlyPriceGross == null) return calcularLinea(l);
  const total = redondear2(c.monthlyPriceGross * periodo.fraccion);
  const { subtotal, taxAmount } = desglosarBruto(total, c.taxRate);
  return { ...l, unitPrice: subtotal, subtotal, taxAmount, total };
}

/** «F-2026-000123». */
export function formatearNumero(serie: string, anio: number, n: number): string {
  return `${serie}-${anio}-${String(n).padStart(6, "0")}`;
}
