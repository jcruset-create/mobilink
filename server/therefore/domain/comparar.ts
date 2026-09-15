/**
 * El papel contra el ERP: en qué se diferencian.
 *
 * Es lo que necesita quien tiene que MODIFICAR un albarán: no «qué dice el
 * PDF» ni «qué dice el ERP», sino qué hay que cambiar. Se comparan línea a
 * línea por referencia y se dice, de cada una, si cuadra, si difiere y en qué,
 * si falta en un lado o sobra en el otro.
 *
 * ── Lo que NO se hace ───────────────────────────────────────────────────────
 *
 * No se decide quién tiene razón. El PDF es lo que el proveedor dice haber
 * entregado y el ERP lo que la empresa dio por recibido; una diferencia puede
 * ser un error del proveedor, un error al grabar, o una entrega parcial. La
 * comparación enseña la diferencia con los dos valores al lado y una persona
 * decide. Ponerle un «correcto» a uno de los dos lados sería inventarse la
 * decisión.
 *
 * Y no se empareja por parecido. Una referencia que no está en el otro lado
 * es una línea que falta, aunque haya otra con la misma cantidad y el mismo
 * importe: dos artículos distintos al mismo precio es lo más normal del mundo
 * en un albarán de recambios.
 */

import type { LineaAlbaranErp } from "../erp/puerto.ts";

/** Lo mínimo de una línea del papel que hace falta para comparar. */
export type LineaPapel = {
  referencia: string | null;
  descripcion: string | null;
  cantidad: number | null;
  importeCentimos: number | null;
};

export type DiferenciaLinea =
  | { tipo: "IGUAL"; referencia: string; papel: LineaPapel; erp: LineaAlbaranErp }
  | {
      tipo: "DIFIERE";
      referencia: string;
      papel: LineaPapel;
      erp: LineaAlbaranErp;
      /** Qué campos no coinciden, por su nombre. */
      campos: ("cantidad" | "importe")[];
    }
  | { tipo: "FALTA_EN_ERP"; referencia: string; papel: LineaPapel }
  | { tipo: "SOBRA_EN_ERP"; referencia: string; erp: LineaAlbaranErp }
  | { tipo: "SIN_REFERENCIA"; papel: LineaPapel };

export type Comparacion = {
  /** Todas las líneas cuadran y no falta ni sobra ninguna. */
  coincide: boolean;
  lineas: DiferenciaLinea[];
  /** Suma del papel menos suma del ERP, en céntimos. `null` si falta alguna. */
  diferenciaTotalCentimos: number | null;
  resumen: { iguales: number; difieren: number; faltanEnErp: number; sobranEnErp: number; sinReferencia: number };
};

/** La clave de emparejamiento: la referencia sin espacios, guiones ni puntos, en mayúsculas. */
export function claveReferencia(v: string | null | undefined): string | null {
  if (!v) return null;
  const k = v.toUpperCase().replace(/[\s.\-/]/g, "");
  return k || null;
}

function cantidadesIguales(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  // Tres decimales: es la precisión con la que se guardan las cantidades.
  return Math.abs(a - b) < 0.0005;
}

export function compararConErp(
  papel: readonly LineaPapel[],
  erp: readonly LineaAlbaranErp[],
  toleranciaCentimos = 2
): Comparacion {
  const lineas: DiferenciaLinea[] = [];
  const resumen = { iguales: 0, difieren: 0, faltanEnErp: 0, sobranEnErp: 0, sinReferencia: 0 };

  // Por referencia, y varias líneas con la misma referencia se comparan en orden.
  const enErp = new Map<string, LineaAlbaranErp[]>();
  for (const l of erp) {
    const k = claveReferencia(l.referencia);
    if (!k) continue;
    const lista = enErp.get(k);
    if (lista) lista.push(l);
    else enErp.set(k, [l]);
  }

  for (const p of papel) {
    const k = claveReferencia(p.referencia);
    if (!k) {
      lineas.push({ tipo: "SIN_REFERENCIA", papel: p });
      resumen.sinReferencia++;
      continue;
    }
    const candidata = enErp.get(k)?.shift();
    if (!candidata) {
      lineas.push({ tipo: "FALTA_EN_ERP", referencia: k, papel: p });
      resumen.faltanEnErp++;
      continue;
    }
    const campos: ("cantidad" | "importe")[] = [];
    if (!cantidadesIguales(p.cantidad, candidata.cantidad)) campos.push("cantidad");
    const pi = p.importeCentimos;
    const ei = candidata.importeCentimos;
    if (pi === null || ei === null ? pi !== ei : Math.abs(pi - ei) > toleranciaCentimos) campos.push("importe");
    if (campos.length === 0) {
      lineas.push({ tipo: "IGUAL", referencia: k, papel: p, erp: candidata });
      resumen.iguales++;
    } else {
      lineas.push({ tipo: "DIFIERE", referencia: k, papel: p, erp: candidata, campos });
      resumen.difieren++;
    }
  }

  for (const [k, restantes] of enErp) {
    for (const l of restantes) {
      lineas.push({ tipo: "SOBRA_EN_ERP", referencia: k, erp: l });
      resumen.sobranEnErp++;
    }
  }

  const sumaPapel = papel.reduce<number | null>((t, l) => (t === null || l.importeCentimos === null ? null : t + l.importeCentimos), 0);
  const sumaErp = erp.reduce<number | null>((t, l) => (t === null || l.importeCentimos === null ? null : t + l.importeCentimos), 0);

  return {
    coincide: resumen.difieren + resumen.faltanEnErp + resumen.sobranEnErp + resumen.sinReferencia === 0 && papel.length > 0,
    lineas,
    diferenciaTotalCentimos: sumaPapel === null || sumaErp === null ? null : sumaPapel - sumaErp,
    resumen,
  };
}
