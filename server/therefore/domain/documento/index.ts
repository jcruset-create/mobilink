/**
 * Del PDF ya leído al albarán estructurado.
 *
 * Es el pegamento: elige parser, localiza los albaranes, se queda con el que
 * pide la incidencia y extrae sus líneas y sus datos. Sigue siendo puro —entra
 * texto con coordenadas, sale estructura— y por eso el caso difícil se prueba
 * sin PDF y sin base de datos.
 *
 * ── La regla que gobierna esta pieza ────────────────────────────────────────
 *
 * Localizar el albarán es DETERMINISTA o es revisión. Aquí no entra la IA ni
 * entra una heurística de «el que más se parezca»: si el número pedido no está
 * escrito en el documento, el análisis lo dice y para. Coger las líneas del
 * albarán equivocado produce un dato contable que cuadra consigo mismo y que
 * nadie va a volver a mirar, y ése es el fallo caro de todo el módulo.
 */

import {
  UMBRALES_ALBARAN_POR_DEFECTO,
  elegirAlbaran,
  normalizarAlbaran,
  type ResultadoMatch,
  type UmbralesAlbaran,
} from "../albaran.ts";
import type { Complementarios } from "./complementarios.ts";
import { sumaDeLineas, type ConceptoAdicional, type LineaArticulo, type OpcionesLineas } from "./lineas.ts";
import { parserGenerico, type CabeceraDocumento, type ParserDocumento } from "./generico.ts";
import type { OpcionesSecciones, SeccionAlbaran } from "./secciones.ts";
import type { DocumentoTexto } from "./tipos.ts";

export { parserGenerico } from "./generico.ts";
export type { CabeceraDocumento, ParserDocumento } from "./generico.ts";

/**
 * Cuánto tiene que ganarle un parser específico al genérico para usarlo.
 *
 * Sin margen, un parser que reconociera el formato «casi igual de bien» se
 * quedaría con documentos que no son suyos. Configurable:
 * `albaran.margen_parser_especifico`.
 */
export const MARGEN_PARSER_ESPECIFICO = 0.15;

/** Hoy sólo hay uno. Un parser de proveedor se añade aquí, con su documento. */
export const REGISTRO_PARSERS: readonly ParserDocumento[] = [parserGenerico];

export function seleccionarParser(
  doc: DocumentoTexto,
  registro: readonly ParserDocumento[] = REGISTRO_PARSERS,
  margen = MARGEN_PARSER_ESPECIFICO
): ParserDocumento {
  const base = parserGenerico.aplica(doc);
  let elegido = parserGenerico;
  let mejor = base;
  for (const p of registro) {
    if (p.clave === parserGenerico.clave) continue;
    const n = p.aplica(doc);
    if (n >= base + margen && n > mejor) {
      mejor = n;
      elegido = p;
    }
  }
  return elegido;
}

export type AnalisisAlbaran = {
  /** El que pedía la incidencia, tal y como lo escribió el correo. */
  numeroSolicitado: string;
  /** Cómo lo escribe el documento. `null` si no se ha localizado. */
  numeroDocumento: string | null;
  numeroNormalizado: string | null;
  resultadoMatch: ResultadoMatch;
  confianzaMatch: number;
  motivoMatch: string;
  /** Albaranes del documento que se parecen al pedido pero no son. */
  parecidos: string[];

  seccion: SeccionAlbaran | null;
  lineas: LineaArticulo[];
  conceptos: ConceptoAdicional[];
  complementarios: Complementarios;
  sumaLineasCentimos: number | null;

  paginaInicio: number | null;
  paginaFin: number | null;
  parserUsado: string;
  /** Cómo se leyó la tabla. `POSICIONAL` es una lectura razonable, no segura. */
  modoTabla: "CABECERA" | "POSICIONAL" | null;
  /** Filas con números que no se pudieron leer ni como línea ni como concepto. */
  filasDescartadas: number;
  /** Cuántas líneas se retiraron por repetirse en varias páginas. */
  lineasRepetidasRetiradas: number;
};

export type OpcionesAnalisis = {
  umbrales?: UmbralesAlbaran;
  secciones?: OpcionesSecciones;
  lineas?: OpcionesLineas;
  registro?: readonly ParserDocumento[];
  margenParser?: number;
};

const SIN_COMPLEMENTARIOS: Complementarios = {
  matricula: null,
  bastidor: null,
  fecha: null,
  observaciones: null,
  otros: {},
};

/** La cabecera del documento entero: número de factura, emisor y totales. */
export function analizarCabecera(
  doc: DocumentoTexto,
  opciones: OpcionesAnalisis = {}
): { cabecera: CabeceraDocumento; parserUsado: string } {
  const parser = seleccionarParser(doc, opciones.registro, opciones.margenParser);
  return { cabecera: parser.extraerCabecera(doc), parserUsado: parser.clave };
}

/** Todos los albaranes que trae el documento, para guardarlos en la cabecera. */
export function albaranesDelDocumento(
  doc: DocumentoTexto,
  opciones: OpcionesAnalisis = {}
): { numeroDocumento: string | null; normalizado: string | null; paginaInicio: number; paginaFin: number }[] {
  const parser = seleccionarParser(doc, opciones.registro, opciones.margenParser);
  return parser.localizarAlbaranes(doc, opciones.secciones).secciones.map((s) => ({
    numeroDocumento: s.numeroDocumento,
    normalizado: normalizarAlbaran(s.numeroDocumento)?.nucleo ?? null,
    paginaInicio: s.paginaInicio,
    paginaFin: s.paginaFin,
  }));
}

/**
 * Analiza UN albarán pedido dentro de un documento.
 *
 * Que el documento traiga cinco no cambia nada: cada actuación pide el suyo y
 * se analiza por separado. Es lo que permite que dos albaranes de la misma
 * factura tengan estados de análisis distintos, que es lo normal.
 */
export function analizarAlbaran(
  doc: DocumentoTexto,
  numeroSolicitado: string,
  opciones: OpcionesAnalisis = {}
): AnalisisAlbaran {
  const umbrales = opciones.umbrales ?? UMBRALES_ALBARAN_POR_DEFECTO;
  const parser = seleccionarParser(doc, opciones.registro, opciones.margenParser);
  const localizacion = parser.localizarAlbaranes(doc, opciones.secciones);

  const base: AnalisisAlbaran = {
    numeroSolicitado,
    numeroDocumento: null,
    numeroNormalizado: null,
    resultadoMatch: "NO_MATCH",
    confianzaMatch: 0,
    motivoMatch: "El documento no trae ningún albarán.",
    parecidos: [],
    seccion: null,
    lineas: [],
    conceptos: [],
    complementarios: SIN_COMPLEMENTARIOS,
    sumaLineasCentimos: null,
    paginaInicio: null,
    paginaFin: null,
    parserUsado: parser.clave,
    modoTabla: null,
    filasDescartadas: 0,
    lineasRepetidasRetiradas: localizacion.lineasRepetidasRetiradas,
  };

  if (localizacion.secciones.length === 0) return base;

  const unica = localizacion.secciones[0];
  let seccion: SeccionAlbaran | null;
  let resultado: ResultadoMatch;
  let confianza: number;
  let motivo: string;
  let parecidos: string[] = [];

  if (unica.documentoEntero) {
    /*
     * Nadie ha leído el número en ninguna parte. Las líneas pueden estar bien y
     * aun así no se puede afirmar que sean de este albarán, así que el techo es
     * UNCERTAIN: se enseña, se revisa y no se da por bueno solo.
     */
    seccion = unica;
    resultado = "UNCERTAIN";
    confianza = umbrales.incierto;
    motivo =
      "El documento no indica ningún número de albarán, así que no se puede confirmar que estas líneas sean las pedidas.";
  } else {
    const elegido = elegirAlbaran(
      numeroSolicitado,
      localizacion.secciones,
      (s) => s.numeroDocumento ?? "",
      umbrales
    );
    seccion = elegido.candidato;
    resultado = elegido.comparacion.resultado;
    confianza = elegido.comparacion.confianza;
    motivo = elegido.comparacion.motivo;
    parecidos = elegido.parecidos.map((s) => s.numeroDocumento ?? "").filter(Boolean);
  }

  if (!seccion) {
    return { ...base, resultadoMatch: resultado, confianzaMatch: confianza, motivoMatch: motivo, parecidos };
  }

  const extraidas = parser.extraerLineas(seccion, opciones.lineas, localizacion.cabeceraDocumento);
  const complementarios = parser.extraerComplementarios(seccion, localizacion.cabeceraDocumento);
  if (extraidas.notas.length > 0) {
    complementarios.observaciones = [complementarios.observaciones, ...extraidas.notas]
      .filter(Boolean)
      .join(" · ");
  }

  return {
    ...base,
    numeroDocumento: seccion.numeroDocumento,
    numeroNormalizado: normalizarAlbaran(seccion.numeroDocumento)?.nucleo ?? null,
    resultadoMatch: resultado,
    confianzaMatch: confianza,
    motivoMatch: motivo,
    parecidos,
    seccion,
    lineas: extraidas.lineas,
    conceptos: extraidas.conceptos,
    complementarios,
    sumaLineasCentimos: sumaDeLineas(extraidas.lineas),
    paginaInicio: seccion.paginaInicio,
    paginaFin: seccion.paginaFin,
    modoTabla: extraidas.rejilla.modo,
    filasDescartadas: extraidas.descartadas,
  };
}
