/**
 * Los descuentos de una línea, en orden y sin colapsar.
 *
 * `60% + 10%` son DOS descuentos encadenados, no uno del 64 %. Aritméticamente
 * da lo mismo —0,4 × 0,9 = 0,36 = 1 − 0,64— y aun así no se pueden juntar: el
 * ERP los pide como están impresos, y lo pactado con el proveedor es «60 y 10».
 * El día que alguien discuta la factura, «64 %» es un número que no aparece en
 * ningún papel.
 *
 * Por eso cada descuento es una fila con su `orden`, y `raw` conserva la celda
 * entera tal y como estaba escrita. Lo que no se entiende no se descarta en
 * silencio: se marca como no reconocido y la línea pide revisión.
 */

export type Descuento = {
  /** 1, 2, 3… El orden en que están impresos, que es el orden en que se aplican. */
  orden: number;
  /** 60 significa 60 %. Puede llevar decimales. */
  porcentaje: number;
  /** El trozo tal y como estaba: «60%». */
  raw: string;
};

export type DescuentosLeidos = {
  descuentos: Descuento[];
  /** La celda entera, sin tocar. Es lo que se guarda en `raw_value`. */
  raw: string;
  /**
   * ¿Se ha entendido TODO lo que había en la celda?
   *
   * Falso cuando queda texto que no es un porcentaje ni un separador. Una celda
   * con «60% y el resto según acuerdo» tiene un descuento legible y una
   * condición que este parser no sabe leer; fingir que sólo había un 60 % es
   * perder la mitad del trato.
   */
  reconocido: boolean;
  /** Lo que sobró sin entender. Se enseña en la validación. */
  sobrante: string;
};

const VACIO: DescuentosLeidos = { descuentos: [], raw: "", reconocido: true, sobrante: "" };

/**
 * Un porcentaje, con su decimal opcional.
 *
 * La coma es a la vez separador decimal y separador entre descuentos —`7,5%` y
 * `60%,10%` se escriben las dos cosas—, así que NO se puede partir la celda por
 * comas y leer los trozos: `7,5%` se convertiría en un 7 % y un 5 %. Se extraen
 * los porcentajes enteros con su forma completa y lo que sobra se mira después.
 */
const PORCENTAJE = /\d{1,3}(?:[.,]\d{1,3})?\s*%/g;

/** Una celda que es un número a secas: hay plantillas que no repiten el «%». */
const SOLO_NUMERO = /^\d{1,3}(?:[.,]\d{1,3})?$/;

/** Lo que puede quedar entre descuentos sin significar nada. */
const RELLENO = /^[+,;/\s.-]*$/;

/** «Sin descuento», escrito de las formas en que se escribe. */
const SIN_DESCUENTO = /^(?:-|—|0|0\s*%|n\/a)$/i;

export function leerDescuentos(celda: unknown): DescuentosLeidos {
  if (typeof celda !== "string" || !celda.trim()) return VACIO;
  const raw = celda.trim();

  if (SIN_DESCUENTO.test(raw)) return { descuentos: [], raw, reconocido: true, sobrante: "" };

  const descuentos: Descuento[] = [];
  let resto = raw;
  for (const m of raw.matchAll(PORCENTAJE)) {
    descuentos.push({
      orden: descuentos.length + 1,
      porcentaje: Number(m[0].replace(/\s|%/g, "").replace(",", ".")),
      raw: m[0].trim(),
    });
    resto = resto.replace(m[0], " ");
  }

  if (descuentos.length === 0 && SOLO_NUMERO.test(raw)) {
    return {
      descuentos: [{ orden: 1, porcentaje: Number(raw.replace(",", ".")), raw }],
      raw,
      reconocido: true,
      sobrante: "",
    };
  }

  const sobrante = resto
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t && !RELLENO.test(t))
    .join(" ");

  return { descuentos, raw, reconocido: sobrante === "", sobrante };
}

/**
 * El factor que queda tras encadenarlos: 60 % y 10 % dejan 0,36.
 *
 * Se devuelve el factor y no el «descuento total» a propósito: el factor es lo
 * que multiplica al importe bruto, y el porcentaje equivalente es un número que
 * no está impreso en ningún sitio.
 */
export function factorRestante(descuentos: Descuento[]): number {
  return descuentos.reduce((f, d) => f * (1 - d.porcentaje / 100), 1);
}
