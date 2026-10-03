/**
 * Precio del alquiler (base, IVA, PVP) y medidas del trastero.
 *
 * Reglas:
 *
 *   · El precio se guarda como base + tipo de IVA + PVP. La base de datos exige
 *     que |PVP − base × (1 + IVA)| ≤ 0,01: así se puede guardar el PVP redondo
 *     que publica el centro (60,00 €) aunque su base exacta tenga más decimales.
 *   · Si sólo llega el PVP, la base sale de él; si sólo llega la base, el PVP.
 *     Si llegan los dos y no cuadran, NO se elige uno en silencio: es un error.
 *   · Esto es el tratamiento fiscal del ALQUILER. No se presupone nada de otros
 *     conceptos (fianza, seguro, candado…): cada concepto tiene su política.
 *   · `iva` es SIEMPRE un tipo (porcentaje); la cuota en euros es otra cosa
 *     (`resolverPrecioTrastero`, `vat_amount`). Ningún tipo está escrito en el
 *     código: sale del ajuste `default_vat_rate` de la empresa.
 *
 */

import { ErrorSelfStorage } from "../errors.ts";

export const TOLERANCIA_PVP = 0.01;

/** «48,40 €», para los mensajes. */
const eur = (v: number) => `${v.toFixed(2).replace(".", ",")} €`;

/**
 * Redondeo a céntimos «de calculadora»: 1,005 → 1,01. `Math.round(v * 100)`
 * daría 1,00 porque 1,005 × 100 es 100,4999… en coma flotante; desplazando el
 * exponente en texto se evita.
 */
export function redondear2(v: number): number {
  const abs = Math.abs(v);
  const texto = String(abs);
  if (texto.includes("e")) return Math.round(v * 100) / 100; // notación científica: valores extremos
  const r = Number(Math.round(Number(`${texto}e2`)) + "e-2");
  return v < 0 ? -r : r;
}

export type Precio = { base: number; iva: number; pvp: number };

export function cuadraPvp(base: number, iva: number, pvp: number): boolean {
  return Math.abs(pvp - base * (1 + iva / 100)) <= TOLERANCIA_PVP + 1e-9;
}

/**
 * Completa base/PVP a partir de lo que haya. `iva` en porcentaje (21, no 0,21).
 */
export function resolverPrecio(entrada: { base?: number | null; iva: number; pvp?: number | null }): Precio {
  const { iva } = entrada;
  const base = entrada.base ?? null;
  const pvp = entrada.pvp ?? null;

  if (!Number.isFinite(iva) || iva < 0 || iva > 100) {
    throw new ErrorSelfStorage("IVA_NO_VALIDO", "El tipo de IVA tiene que estar entre 0 y 100.", 422);
  }
  if (base == null && pvp == null) {
    throw new ErrorSelfStorage("PRECIO_OBLIGATORIO", "Indica el precio (base) o el PVP.", 422);
  }
  for (const [nombre, v] of [["precio", base], ["PVP", pvp]] as const) {
    if (v != null && (!Number.isFinite(v) || v < 0)) {
      throw new ErrorSelfStorage("PRECIO_NO_VALIDO", `El ${nombre} no es un importe válido.`, 422);
    }
  }

  if (base != null && pvp != null) {
    const b = redondear2(base);
    const p = redondear2(pvp);
    if (!cuadraPvp(b, iva, p)) {
      throw new ErrorSelfStorage(
        "PVP_NO_CUADRA",
        `El PVP (${eur(p)}) no corresponde a la base (${eur(b)}) con IVA del ${iva} %: serían ${eur(b * (1 + iva / 100))}.`,
        422
      );
    }
    return { base: b, iva, pvp: p };
  }
  if (pvp != null) {
    const p = redondear2(pvp);
    // Base con dos decimales cuyo PVP, redondeado, vuelve a dar el publicado.
    const b = redondear2(p / (1 + iva / 100));
    return { base: b, iva, pvp: p };
  }
  const b = redondear2(base!);
  return { base: b, iva, pvp: redondear2(b * (1 + iva / 100)) };
}

// ── Precio comercial del trastero: base + CUOTA de IVA = PVP ────────────────

/** Precio del trastero: base, cuota de IVA en EUROS y PVP. `iva` = tipo (porcentaje) vigente al fijarlo. */
export type PrecioTrastero = { base: number; cuota: number; pvp: number; iva: number };

/**
 * Completa el precio del trastero a partir de lo que llegue.
 *
 *   · base + cuota + PVP: tienen que cuadrar (base + cuota = PVP, ±0,01 €). Si
 *     no, es un error: no se elige uno en silencio.
 *   · dos de los tres: el tercero sale de los otros dos (sin usar ningún tipo).
 *   · sólo base o sólo PVP: se usa el IVA GENERAL configurado (`ivaGeneral`,
 *     porcentaje). Nunca se deduce el tipo de los valores importados.
 *
 * `iva` del resultado es siempre el IVA general: el tipo vigente cuando se
 * fijó el precio. La cuota NO se interpreta jamás como porcentaje.
 */
export function resolverPrecioTrastero(entrada: { base?: number | null; cuota?: number | null; pvp?: number | null }, ivaGeneral: number): PrecioTrastero {
  if (!Number.isFinite(ivaGeneral) || ivaGeneral < 0 || ivaGeneral > 100) {
    throw new ErrorSelfStorage("IVA_NO_VALIDO", "El IVA general configurado no es válido.", 422);
  }
  const base = entrada.base ?? null;
  const cuota = entrada.cuota ?? null;
  const pvp = entrada.pvp ?? null;
  for (const [nombre, v] of [["El precio base", base], ["La cuota de IVA", cuota], ["El PVP", pvp]] as const) {
    if (v != null && (!Number.isFinite(v) || v < 0)) {
      throw new ErrorSelfStorage("PRECIO_NO_VALIDO", `${nombre} no es un importe válido.`, 422);
    }
  }
  const r = (b: number, c: number, p: number): PrecioTrastero => ({ base: redondear2(b), cuota: redondear2(c), pvp: redondear2(p), iva: ivaGeneral });

  if (base != null && cuota != null && pvp != null) {
    if (Math.abs(redondear2(base) + redondear2(cuota) - redondear2(pvp)) > TOLERANCIA_PVP + 1e-9) {
      throw new ErrorSelfStorage(
        "PVP_NO_CUADRA",
        `Precio base (${eur(base)}) + cuota de IVA (${eur(cuota)}) = ${eur(base + cuota)}, que no es el PVP (${eur(pvp)}).`,
        422
      );
    }
    return r(base, cuota, pvp);
  }
  if (base != null && pvp != null) {
    if (pvp + 1e-9 < base) throw new ErrorSelfStorage("PVP_NO_CUADRA", `El PVP (${eur(pvp)}) es menor que el precio base (${eur(base)}).`, 422);
    return r(base, pvp - base, pvp);
  }
  if (base != null && cuota != null) return r(base, cuota, base + cuota);
  if (cuota != null && pvp != null) {
    if (pvp + 1e-9 < cuota) throw new ErrorSelfStorage("PVP_NO_CUADRA", `El PVP (${eur(pvp)}) es menor que la cuota de IVA (${eur(cuota)}).`, 422);
    return r(pvp - cuota, cuota, pvp);
  }
  if (base != null) {
    const c = redondear2((redondear2(base) * ivaGeneral) / 100);
    return r(base, c, redondear2(base) + c);
  }
  if (pvp != null) {
    const p = redondear2(pvp);
    const b = redondear2(p / (1 + ivaGeneral / 100));
    return r(b, p - b, p);
  }
  throw new ErrorSelfStorage("PRECIO_OBLIGATORIO", "Indica el precio base o el PVP.", 422);
}

/**
 * ¿La cuota corresponde al IVA general sobre la base? Sólo para AVISAR (un
 * precio con otro tipo es posible: el importador no lo rechaza ni lo corrige).
 */
export function cuotaCuadraConIva(base: number, cuota: number, ivaGeneral: number): boolean {
  return Math.abs(redondear2((base * ivaGeneral) / 100) - cuota) <= TOLERANCIA_PVP + 1e-9;
}

/** m² a partir de cm, con dos decimales. */
export const areaM2 = (anchoCm: number, largoCm: number) => redondear2((anchoCm * largoCm) / 10_000);

/** m³ a partir de cm, con dos decimales. */
export const volumenM3 = (anchoCm: number, largoCm: number, altoCm: number) =>
  redondear2((anchoCm * largoCm * altoCm) / 1_000_000);

/** Diferencia relativa entre un valor declarado y el calculado (0,05 = 5 %). */
export function desviacion(declarado: number, calculado: number): number {
  if (calculado === 0) return declarado === 0 ? 0 : Infinity;
  return Math.abs(declarado - calculado) / calculado;
}

/**
 * Número en formato español o internacional: «1.234,56», «1234.56», «49,59 €»,
 * «21%». Devuelve null si está vacío; lanza si no es un número.
 */
export function leerNumero(texto: unknown): number | null {
  if (texto == null) return null;
  if (typeof texto === "number") return Number.isFinite(texto) ? texto : NaN;
  let s = String(texto).trim().replace(/[€%\s]/g, "").replace(/^EUR|EUR$/i, "");
  if (s === "") return null;
  const coma = s.lastIndexOf(",");
  const punto = s.lastIndexOf(".");
  if (coma >= 0 && punto >= 0) {
    // El último separador es el decimal; el otro, de miles.
    s = coma > punto ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (coma >= 0) {
    s = s.replace(",", ".");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

/**
 * Medida en cm a partir de un número que puede venir en metros o en cm. Por
 * debajo de 20 se entiende que son metros (no existe un trastero de 20 cm de
 * lado; sí uno de 20 m… no en este negocio). Con `unidad` explícita no se adivina.
 */
export function medidaACm(valor: number, unidad: "auto" | "m" | "cm" = "auto"): number {
  const enMetros = unidad === "m" || (unidad === "auto" && valor < 20);
  return Math.round(enMetros ? valor * 100 : valor);
}
