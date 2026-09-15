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
import { extraerLineas, type ExtraccionLineas, type OpcionesLineas } from "./lineas.ts";
import {
  localizarAlbaranes,
  type Localizacion,
  type OpcionesSecciones,
  type SeccionAlbaran,
} from "./secciones.ts";
import { SINONIMOS_COLUMNA_POR_DEFECTO, titulosEnLaFila } from "./tabla.ts";
import { aplanar, type DocumentoTexto } from "./tipos.ts";

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

const NIF = /\b(?:[A-Z]\d{8}|\d{8}[A-Z]|[A-Z]\d{7}[A-Z0-9])\b/;

const ETIQUETAS_NUMERO = ["factura", "nº factura", "n. factura", "num. factura", "invoice"];
const ETIQUETAS_ABONO = ["abono", "nota de crédito", "nota de credito", "rectificativa"];

function valorTrasEtiqueta(texto: string, etiquetas: string[]): string | null {
  const t = normalizar(texto);
  const minus = t.toLowerCase();
  for (const e of etiquetas) {
    const pos = minus.indexOf(e.toLowerCase());
    if (pos < 0) continue;
    const resto = t.slice(pos + e.length).replace(/^[\s:nº.º-]+/i, "");
    const m = resto.match(/^[A-Z0-9][A-Z0-9/-]{2,}/i);
    if (m) return m[0];
  }
  return null;
}

/** El importe que sigue a una etiqueta de total, buscando en todo el documento. */
function importeTras(doc: DocumentoTexto, etiquetas: string[]): number | null {
  for (const l of aplanar(doc)) {
    const t = normalizar(l.texto);
    const minus = t.toLowerCase().replace(/\./g, "");
    for (const e of etiquetas) {
      const pos = minus.indexOf(e.toLowerCase().replace(/\./g, ""));
      if (pos < 0) continue;
      const resto = t.slice(pos);
      const m = resto.match(/[-−+]?\d[\d.,]*(?=\s*(?:€|EUR)?\s*$)/i);
      if (m) {
        const leido = leerImporte(m[0]);
        if (leido.centimos !== null) return leido.centimos;
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

    let numero: string | null = null;
    let tipo: CabeceraDocumento["tipoDocumento"] = "FACTURA";
    for (const f of arriba) {
      const abono = valorTrasEtiqueta(f.texto, ETIQUETAS_ABONO);
      if (abono && !numero) {
        numero = abono;
        tipo = "ABONO";
        break;
      }
      const factura = valorTrasEtiqueta(f.texto, ETIQUETAS_NUMERO);
      if (factura && !numero) {
        numero = factura;
        tipo = "FACTURA";
        break;
      }
    }

    let fecha: string | null = null;
    for (const f of arriba) {
      const m = normalizar(f.texto).match(/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/);
      if (m) {
        fecha = leerFecha(m[0]);
        if (fecha) break;
      }
    }

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
      baseCentimos: importeTras(doc, ["base imponible", "base imp"]),
      ivaCentimos: importeTras(doc, ["iva", "i.v.a"]),
      totalCentimos: importeTras(doc, ["total factura", "total documento", "total"]),
    };
  },

  localizarAlbaranes(doc, opciones) {
    return localizarAlbaranes(doc, {
      sinonimosColumna: Object.values(SINONIMOS_COLUMNA_POR_DEFECTO).flat(),
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
