/**
 * El parser que se usa mientras no haya un motivo real para escribir otro.
 *
 * Lee la forma que comparten casi todas las facturas de proveedor: una
 * cabecera con el número y el emisor, uno o varios albaranes con su tabla, y un
 * pie con los totales. No conoce a ningún proveedor y no debe conocerlo: el día
 * que haga falta uno específico se escribirá heredando de éste y cambiando sólo
 * lo que difiera, **con un documento real delante que lo justifique** (§48,
 * §49). Un parser escrito «por si acaso» para un formato que nadie ha visto es
 * código que nunca se ejecuta y que hay que mantener igual.
 *
 * `aplica()` devuelve lo seguro que está de reconocer el documento. El genérico
 * responde bajo a propósito: es el suelo contra el que se mide cualquier parser
 * específico, y si alguna vez ganara por goleada dejaría de haber motivo para
 * escribir ninguno.
 */

import { leerImporte } from "../correo/importes.ts";
import { leerFecha } from "../correo/importes.ts";
import { normalizar } from "../correo/texto.ts";
import { extraerComplementarios, type Complementarios } from "./complementarios.ts";
import { VOCABULARIO_CONCEPTOS, esCabeceraDeTotales, type VocabularioConceptos } from "./conceptos.ts";
import { extraerLineas, type ExtraccionLineas, type OpcionesLineas } from "./lineas.ts";
import {
  localizarAlbaranes,
  type Localizacion,
  type OpcionesSecciones,
  type SeccionAlbaran,
} from "./secciones.ts";
import { SINONIMOS_COLUMNA_POR_DEFECTO, titulosEnLaFila } from "./tabla.ts";
import { aplanar, type DocumentoTexto, type LineaTexto } from "./tipos.ts";

export type CabeceraDocumento = {
  tipoDocumento: "FACTURA" | "ABONO" | "ALBARAN" | "OTRO";
  numeroDocumento: string | null;
  /** `aaaa-mm-dd`. */
  fechaDocumento: string | null;
  proveedorNombre: string | null;
  proveedorNif: string | null;
  baseCentimos: number | null;
  ivaCentimos: number | null;
  totalCentimos: number | null;
};

export type ParserDocumento = {
  clave: string;
  /** 0 a 1: cuánto reconoce este parser el formato del documento. */
  aplica(doc: DocumentoTexto): number;
  extraerCabecera(doc: DocumentoTexto): CabeceraDocumento;
  localizarAlbaranes(doc: DocumentoTexto, opciones?: OpcionesSecciones): Localizacion;
  extraerLineas(
    seccion: SeccionAlbaran,
    opciones?: OpcionesLineas,
    cabeceraPrevia?: Localizacion["cabeceraDocumento"]
  ): ExtraccionLineas;
  extraerComplementarios(seccion: SeccionAlbaran, bandaPrevia?: Localizacion["cabeceraDocumento"]): Complementarios;
};

/** Con el prefijo del IVA intracomunitario opcional: «ESA80641897». */
const NIF = /\b(?:ES)?(?:[A-Z]\d{8}|\d{8}[A-Z]|[A-Z]\d{7}[A-Z0-9])\b/;

/*
 * Las etiquetas se buscan por PALABRAS, no por subcadenas: «factura» dentro
 * de «facturacion@proveedor.es» no es una etiqueta, y en la primera factura
 * real que entró era justo eso lo que salía como número de documento.
 */
/*
 * De la más específica a la más genérica, y se buscan EN ESE ORDEN por todo
 * el documento: «Nº Fra» gana a «Factura» aunque esté más abajo. Al revés, el
 * título «Factura rectificativa» de un recuadro se lleva el primer número que
 * encuentre debajo, que suele ser el CIF del cliente.
 */
const ETIQUETAS_NUMERO = [
  "nº factura",
  "n factura",
  "num factura",
  "numero factura",
  "nº fra",
  "n fra",
  "num fra",
  "factura nº",
  "factura n",
  "fra",
  "factura",
  "abono",
  "nota de credito",
  "rectificativa",
  "invoice",
  "nº",
  "numero",
  "n",
];
/** Lo que delata que el documento es un abono, esté donde esté. */
const ETIQUETAS_ABONO = ["abono", "nota de credito", "factura rectificativa", "rectificativa"];
/** Las que anuncian la fecha del documento. */
const ETIQUETAS_FECHA = ["fecha de doc", "fecha doc", "fecha factura", "fecha de factura", "fecha", "data"];

/** Los totales. Las etiquetas más específicas van antes que las genéricas. */
const ETIQUETAS_BASE = ["base imponible", "base imp", "total sin iva", "importe neto", "subtotal"];
const ETIQUETAS_IVA = ["importe iva", "cuota iva", "iva"];
const ETIQUETAS_TOTAL = [
  "total factura",
  "total documento",
  "total abono",
  "total iva incluido",
  "total con iva",
  "total a pagar",
  "importe total",
  "total",
];

/** Una palabra con su sitio, lista para comparar con una etiqueta. */
type Token = { llano: string; raw: string; x0: number; x1: number };

/** Minúsculas, sin acentos ni puntos: «I.V.A.:» y «iva» son lo mismo. */
function llano(v: string): string {
  return normalizar(v).toLowerCase().replace(/[.:]/g, "").trim();
}

function tokensDe(linea: LineaTexto): Token[] {
  if (linea.palabras.length > 0) {
    return linea.palabras.map((p) => ({ llano: llano(p.texto), raw: p.texto, x0: p.x, x1: p.x + p.w }));
  }
  // Sin palabras (pruebas escritas a mano): se reparte la línea a ojo.
  const partes = linea.texto.split(/\s+/).filter(Boolean);
  const ancho = partes.length ? linea.w / partes.length : 0;
  return partes.map((t, i) => ({ llano: llano(t), raw: t, x0: linea.x + i * ancho, x1: linea.x + (i + 1) * ancho }));
}

/** Dónde aparece la etiqueta (como secuencia de palabras enteras) en la línea. */
function ocurrencias(tokens: Token[], etiqueta: string): { desde: number; hasta: number }[] {
  const partes = etiqueta.split(" ").map(llano).filter(Boolean);
  const salida: { desde: number; hasta: number }[] = [];
  for (let i = 0; i + partes.length <= tokens.length; i++) {
    let ok = true;
    for (let k = 0; k < partes.length; k++) {
      if (tokens[i + k].llano !== partes[k]) {
        ok = false;
        break;
      }
    }
    if (ok) salida.push({ desde: i, hasta: i + partes.length });
  }
  return salida;
}

/**
 * Un importe con o sin el símbolo pegado.
 *
 * Tiene que acabar en cifra: «Tomo 11513,» del pie legal de una factura no es
 * un importe, y leído como tal son once mil euros de IVA.
 */
const PARECE_IMPORTE = /^[-−+]?\d[\d.,]*(?<![.,])\s*(?:€|EUR)?$/i;
/** «N0000123456», «F-ABC26-0001234», «2026/000123»: letras y al menos tres dígitos. */
const PARECE_NUMERO_DOC = /^[A-Z0-9][A-Z0-9/.-]{2,}$/i;
const PARECE_FECHA = /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/;

/** Un importe de verdad: «23.09.2026» tiene su forma y es una fecha. */
function pareceImporte(v: string): boolean {
  return PARECE_IMPORTE.test(v) && !PARECE_FECHA.test(v);
}
/** Lo que puede haber entre una etiqueta y su valor sin significar nada. */
const RELLENO = /^[:.\-–—nº°]*$/i;

function esNumeroDoc(raw: string): boolean {
  return PARECE_NUMERO_DOC.test(raw) && !PARECE_FECHA.test(raw) && (raw.match(/\d/g) ?? []).length >= 3;
}

/**
 * El valor que hay DEBAJO de una etiqueta.
 *
 * Hay plantillas que ponen los títulos en una fila («FACTURA  FECHA») y los
 * valores en la de abajo («N0000123456  31/08/2026»), y otro tanto con el pie
 * («BASE IMPONIBLE  IVA  TOTAL» y los importes debajo). Se busca en las filas
 * siguientes, cerca, una palabra que se solape horizontalmente con la etiqueta.
 */
function valorBajo(
  filas: LineaTexto[],
  indice: number,
  x0: number,
  x1: number,
  acepta: (raw: string) => boolean,
  titulos: Token[]
): string | null {
  const etiqueta = filas[indice];
  const tope = etiqueta.y + Math.max(etiqueta.h, 8) * 3 + 8;
  const centro = (t: Token) => (t.x0 + t.x1) / 2;
  /*
   * El valor no tiene por qué caer justo debajo de su título: en una tabla con
   * recuadros el título va centrado y el número pegado a la derecha, y los dos
   * pueden no solaparse ni por un punto. Vale también el número cuyo título
   * MÁS CERCANO es éste, que es lo que ve quien la lee.
   */
  const suyo = (t: Token): boolean => {
    if (t.x0 < x1 && t.x1 > x0) return true;
    let cerca: Token | null = null;
    for (const titulo of titulos) {
      if (!cerca || Math.abs(centro(titulo) - centro(t)) < Math.abs(centro(cerca) - centro(t))) cerca = titulo;
    }
    return cerca !== null && centro(cerca) >= x0 && centro(cerca) <= x1;
  };

  for (let i = indice + 1; i < filas.length; i++) {
    const f = filas[i];
    if (f.pagina !== etiqueta.pagina || f.y > tope) break;
    for (const t of tokensDe(f)) {
      if (acepta(t.raw) && suyo(t)) return t.raw;
    }
  }
  return null;
}

/** El valor inmediatamente detrás de la etiqueta en la misma línea. */
function valorDetras(tokens: Token[], hasta: number, acepta: (raw: string) => boolean): string | null {
  for (let i = hasta; i < tokens.length; i++) {
    if (RELLENO.test(tokens[i].raw)) continue;
    return acepta(tokens[i].raw) ? tokens[i].raw : null;
  }
  return null;
}

/** La fecha que sigue a una etiqueta de fecha, detrás o debajo de ella. */
function etiquetadaEn(filas: LineaTexto[]): string | null {
  for (const e of ETIQUETAS_FECHA) {
    for (let i = 0; i < filas.length; i++) {
      const tokens = tokensDe(filas[i]);
      for (const o of ocurrencias(tokens, e)) {
        const crudo =
          valorDetras(tokens, o.hasta, (v) => PARECE_FECHA.test(v)) ??
          valorBajo(filas, i, tokens[o.desde].x0, tokens[o.hasta - 1].x1, (v) => PARECE_FECHA.test(v), tokens);
        const leida = crudo ? leerFecha(crudo) : null;
        if (leida) return leida;
      }
    }
  }
  return null;
}

/** Cuántas filas alrededor del número se miran buscando la fecha. */
const FILAS_ALREDEDOR = 5;

/** Cuántas palabras puede haber entre una etiqueta y su importe. */
const PALABRAS_HASTA_EL_IMPORTE = 4;

/**
 * El primer importe detrás de la etiqueta, saltando un «21 %» si lo hay.
 *
 * Tiene que venir pegado: entre «Total» y su cifra caben dos puntos y unos
 * puntos de relleno, no media frase. Sin ese límite, un «IVA:» del pie legal
 * se lleva el primer número que aparezca quince palabras más allá.
 */
function importeDetras(tokens: Token[], hasta: number): string | null {
  for (let i = hasta; i < Math.min(tokens.length, hasta + PALABRAS_HASTA_EL_IMPORTE); i++) {
    const t = tokens[i];
    if (!pareceImporte(t.raw)) continue;
    const siguiente = tokens[i + 1]?.raw ?? "";
    if (siguiente.startsWith("%") || t.raw.endsWith("%")) continue;
    return t.raw;
  }
  return null;
}

/**
 * ¿Esta ocurrencia de una etiqueta genérica está dentro de otra cosa?
 *
 * «total» dentro de «TOTAL SIN IVA» no es el total, e «iva» dentro de
 * «% IVA», «SIN IVA» o «IVA INCLUIDO» no es la cuota. Sólo se mira para las
 * etiquetas de una palabra; las compuestas ya dicen lo que son.
 */
function envuelta(tokens: Token[], o: { desde: number; hasta: number }): boolean {
  if (o.hasta - o.desde > 1) return false;
  const antes = tokens[o.desde - 1]?.llano ?? "";
  const despues = tokens[o.hasta]?.llano ?? "";
  return ["%", "sin", "con", "s"].includes(antes) || ["incluido", "incl", "inc"].includes(despues);
}

/**
 * El importe de una etiqueta de total: detrás de ella o debajo de ella.
 *
 * Se busca DE ABAJO ARRIBA. El pie va al final del documento, y por encima
 * puede haber cien filas que digan «Total»: hay plantillas que rematan cada
 * artículo con el suyo, y la primera coincidencia sería el total de un
 * neumático en vez del de la factura.
 */
/**
 * Dónde empieza el pie del documento: la última fila de títulos de totales.
 *
 * Es la que separa «el total de la factura» de «el total de este artículo»,
 * que hay plantillas que rematan cada línea con el suyo. Si el documento no
 * tiene una fila así, se busca desde el principio, como se ha hecho siempre.
 */
function indiceDelPie(filas: LineaTexto[], conceptos: VocabularioConceptos): number {
  for (let i = filas.length - 1; i >= 0; i--) {
    if (esCabeceraDeTotales(filas[i].texto, conceptos)) return i;
  }
  return 0;
}

function importeDe(filas: LineaTexto[], etiquetas: string[]): number | null {
  for (let i = indiceDelPie(filas, VOCABULARIO_CONCEPTOS); i < filas.length; i++) {
    const tokens = tokensDe(filas[i]);
    for (const e of etiquetas) {
      for (const o of ocurrencias(tokens, e)) {
        if (envuelta(tokens, o)) continue;
        const detras = importeDetras(tokens, o.hasta);
        const raw =
          detras ??
          valorBajo(filas, i, tokens[o.desde].x0, tokens[o.hasta - 1].x1, pareceImporte, tokens);
        if (!raw) continue;
        const leido = leerImporte(raw.replace(/€|EUR/i, "").trim());
        if (leido.centimos !== null) return leido.centimos;
      }
    }
  }
  return null;
}

/** El número de documento tras (o bajo) una de las etiquetas, y dónde estaba. */
function numeroDe(
  filas: LineaTexto[],
  etiquetas: string[]
): { numero: string; etiqueta: string; indice: number } | null {
  for (const e of etiquetas) {
    for (let i = 0; i < filas.length; i++) {
      const tokens = tokensDe(filas[i]);
      for (const o of ocurrencias(tokens, e)) {
        const detras = valorDetras(tokens, o.hasta, esNumeroDoc);
        if (detras) return { numero: detras, etiqueta: e, indice: i };
        // «Nº» a secas sólo vale con el valor al lado: debajo de un «Nº» puede
        // haber cualquier cosa.
        if (e.length <= 2 || e === "numero") continue;
        const bajo = valorBajo(filas, i, tokens[o.desde].x0, tokens[o.hasta - 1].x1, esNumeroDoc, tokens);
        if (bajo) return { numero: bajo, etiqueta: e, indice: i };
      }
    }
  }
  return null;
}

export const parserGenerico: ParserDocumento = {
  clave: "generico",

  aplica(doc) {
    const filas = aplanar(doc);
    if (filas.length === 0) return 0;
    const conTabla = filas.some((f) => titulosEnLaFila(f, SINONIMOS_COLUMNA_POR_DEFECTO) >= 3);
    const conImportes = filas.filter((f) => /\d+[.,]\d{2}\s*(?:€|EUR)?\s*$/i.test(f.texto)).length;
    // El suelo: reconoce algo en cualquier documento con números, y un poco
    // más si además encuentra una cabecera de tabla.
    if (conTabla && conImportes >= 2) return 0.5;
    if (conImportes >= 2) return 0.35;
    return 0.15;
  },

  extraerCabecera(doc) {
    const filas = aplanar(doc);
    const arriba = filas.slice(0, Math.min(filas.length, 40));

    /*
     * El número se busca ARRIBA, que es donde va, y si no aparece se busca en
     * todo el documento: hay plantillas que ponen el recuadro del cliente y su
     * número de factura ABAJO, debajo de las líneas. Primero arriba y después
     * en todo, y no al revés, para que una mención de paso en el pie legal no
     * le gane al número de verdad.
     */
    const hallado = numeroDe(arriba, ETIQUETAS_NUMERO) ?? numeroDe(filas, ETIQUETAS_NUMERO);
    const numero = hallado?.numero ?? null;
    /*
     * Que sea abono no lo dice la etiqueta del número sino el documento: hay
     * rectificativas que numeran bajo «Factura» y lo dicen en el recuadro de
     * al lado. Se mira en todo el papel, que es donde puede estar.
     */
    const esAbono = filas.some((f) =>
      ETIQUETAS_ABONO.some((e) => ocurrencias(tokensDe(f), e).length > 0)
    );
    const tipo: CabeceraDocumento["tipoDocumento"] = esAbono ? "ABONO" : "FACTURA";

    /*
     * La fecha del documento es la que está JUNTO A SU NÚMERO. Buscar la
     * primera del papel funciona hasta que una factura empieza por la fecha
     * de su primer albarán, y entonces el documento queda fechado el día que
     * salió la mercancía.
     */
    const sueltaEn = (donde: LineaTexto[]): string | null => {
      for (const f of donde) {
        const m = normalizar(f.texto).match(/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/);
        const leida = m ? leerFecha(m[0]) : null;
        if (leida) return leida;
      }
      return null;
    };
    const cerca = hallado
      ? filas.slice(
          Math.max(0, hallado.indice - FILAS_ALREDEDOR),
          hallado.indice + FILAS_ALREDEDOR + 1
        )
      : [];
    // Primero la que lleva su etiqueta al lado, y sólo si no la hay, la
    // primera que aparezca: junto al número también está el vencimiento.
    const fecha = etiquetadaEn(cerca) ?? sueltaEn(cerca) ?? etiquetadaEn(arriba) ?? sueltaEn(arriba);

    let nif: string | null = null;
    for (const f of arriba) {
      const m = normalizar(f.texto).toUpperCase().match(NIF);
      if (m) {
        nif = m[0];
        break;
      }
    }

    /*
     * El nombre del emisor es la primera línea con letras de la primera página
     * que no sea una etiqueta ni un número. Es una heurística, y por eso el
     * dato del CORREO nunca se sobrescribe con éste: se guardan los dos y, si
     * difieren, sale la validación CORREO_VS_DOCUMENTO.
     */
    let proveedor: string | null = null;
    for (const f of arriba) {
      const t = f.texto.trim();
      if (t.length < 4 || t.length > 80) continue;
      if (/\d{3,}/.test(t) || /[:]/.test(t)) continue;
      if (!/[A-Za-zÁÉÍÓÚÑ]{3,}/.test(t)) continue;
      proveedor = t;
      break;
    }

    return {
      tipoDocumento: tipo,
      numeroDocumento: numero,
      fechaDocumento: fecha,
      proveedorNombre: proveedor,
      proveedorNif: nif,
      baseCentimos: importeDe(filas, ETIQUETAS_BASE),
      ivaCentimos: importeDe(filas, ETIQUETAS_IVA),
      totalCentimos: importeDe(filas, ETIQUETAS_TOTAL),
    };
  },

  localizarAlbaranes(doc, opciones) {
    return localizarAlbaranes(doc, {
      columnas: SINONIMOS_COLUMNA_POR_DEFECTO,
      ...opciones,
    });
  },

  extraerLineas(seccion, opciones, cabeceraPrevia) {
    return extraerLineas(seccion.lineas, opciones, cabeceraPrevia ?? []);
  },

  extraerComplementarios(seccion, bandaPrevia) {
    return extraerComplementarios(seccion.lineas, bandaPrevia ?? []);
  },
};
