/**
 * Leer la ENTREGA de INSA TURBO de su PDF.
 *
 * Código PURO: recibe las filas que da el lector de PDF y devuelve lo que dice
 * el papel. Ni base de datos, ni ficheros, ni decisiones de negocio.
 *
 * ── Por qué hace falta leer el PDF, y no el correo ──────────────────────────
 *
 * Soledad manda los datos EN EL CUERPO del correo y el PDF aparte, por un
 * enlace. INSA TURBO manda el cuerpo casi vacío y la entrega ADJUNTA en PDF:
 * si no se lee el adjunto, del correo no sale nada que meter en la bandeja.
 *
 * ── Cómo es el papel ────────────────────────────────────────────────────────
 *
 *     Entrega Nº   Fecha        S/Referencia  Volumen  Neto(Kg)  Bruto(Kg)
 *     D26 26031188 18/09/2026   333778        0,00
 *     ...
 *     Referencias    Descripción                      Cantidad  Precio      Total
 *     PEDIDO Nº 26001072 FECHA 12/08/2026
 *     021300001012 295/80X22.5 INSA TURBO K25 BASE 1ª 10,000UD  190,000 EUR 1.900,000
 *     CASCOS HANKOOK o CONTINENTAL, PED. ALBERTO
 *     TALLER RIU CLAR
 *     PEDIDO Nº 26001215 FECHA 18/09/2026
 *     021000000259 315/80X22.5 INSA TURBO TDO-3 SM 1ªOT 4,000UD 140,000 EUR  560,000
 *     ...
 *     ****************************************************************
 *     CAMION (TRUCK) 26,000
 *     IMPORTE BRUTO  DESCUENTO  BASE IMPONIBLE  % IVA  IMPORTE IVA  LÍQUIDO
 *
 * Tres cosas que este formato tiene y el de Soledad no:
 *
 * 1. La cantidad va pegada a la unidad y con tres decimales: «10,000UD».
 * 2. Entre el precio y el descuento se cuela la moneda: «190,000 EUR 0,00».
 * 3. Una entrega trae VARIOS pedidos del proveedor, cada uno con sus líneas.
 *    Aquí eso se lee y se devuelve tal cual —cada línea sabe de qué pedido
 *    es—; qué hacer con ello lo decide quien llama, no este lector.
 *
 * Lo que NO se inventa: el transportista (su columna viene vacía y lo que dice
 * la observación «AGENCIA TRANSAHER…» es una frase, no un campo) ni el
 * almacén de origen.
 */

import { leerFecha, leerImporte } from "../../therefore/domain/correo/importes.ts";
import {
  ADORNO,
  CABECERA_INSA,
  CANTIDAD_INSA,
  FIN_INSA,
  GRUPO_INSA,
  REFERENCIA_INSA,
  TOTALES,
  normalizar,
  observacionesInsa,
  type FilaPdf,
} from "./observaciones.ts";

/** Una línea de mercancía de la entrega. */
export type LineaInsa = {
  referencia: string | null;
  descripcion: string;
  cantidad: number;
  precioCentimos: number | null;
  /** El pedido del proveedor al que pertenece, si el papel lo agrupa. */
  pedidoProveedor: string | null;
};

export type EntregaInsa = {
  /** «D26-26031188», como la nombra el propio proveedor en su fichero. */
  numeroAlbaran: string | null;
  /** ISO. La fecha de la entrega. */
  fecha: string | null;
  /** «S/Referencia»: nuestro número, el que le dimos al pedir. */
  referenciaCliente: string | null;
  pedidos: { numero: string; fecha: string | null }[];
  lineas: LineaInsa[];
  observaciones: string[];
  /** La localidad del destinatario, de la cabecera. */
  destinoLocalidad: string | null;
};

/** «Entrega Nº Fecha S/Referencia …»: la cabecera de los datos de la entrega. */
const CABECERA_ENTREGA = /ENTREGA\s+N.{0,2}\s+FECHA/;
/** «D26»: la serie del número de entrega. */
const SERIE = /^[A-Z]\d{0,3}$/;
/** «26031188»: el número. */
const NUMERO = /^\d{4,}$/;
/** «18/09/2026». */
const FECHA = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;
/** «43006 TARRAGONA»: código postal y localidad, al final de la fila. */
const CP_LOCALIDAD = /\b\d{5},?\s+([\p{Lu}][\p{Lu}\s.'-]{2,40})\s*$/u;

/** ¿Es una entrega de INSA? Se reconoce por su cabecera de columnas. */
export function esEntregaInsa(filas: readonly FilaPdf[]): boolean {
  return filas.some((f) => CABECERA_INSA.test(normalizar(f.palabras.join(" "))));
}

/** «10,000UD» → 10. Tres decimales a la española, y la unidad pegada. */
function cantidadInsa(palabra: string): number | null {
  const m = palabra.match(/^(-?[\d.]*\d(?:,\d+)?)\s*UD/i);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** El número de pedido y su fecha de «PEDIDO Nº 26001072 FECHA 12/08/2026». */
function grupoDePedido(palabras: readonly string[]): { numero: string; fecha: string | null } | null {
  if (!GRUPO_INSA.test(normalizar(palabras.join(" ")))) return null;
  const numero = palabras.find((p) => NUMERO.test(p));
  if (!numero) return null;
  const fecha = palabras.find((p) => FECHA.test(p));
  return { numero, fecha: fecha ? leerFecha(fecha) : null };
}

/**
 * Una línea de mercancía: referencia delante, la descripción hasta la cantidad
 * y el precio detrás. La moneda se salta, que es lo que la separa del
 * descuento.
 */
function lineaDeMercancia(palabras: readonly string[], pedido: string | null): LineaInsa | null {
  if (palabras.length < 3 || !REFERENCIA_INSA.test(palabras[0])) return null;
  const i = palabras.findIndex((p) => cantidadInsa(p) !== null);
  if (i < 2) return null;
  const cantidad = cantidadInsa(palabras[i])!;
  const descripcion = palabras.slice(1, i).join(" ").replace(/\s+/g, " ").trim();
  if (!descripcion) return null;
  // El precio unitario es el primer número de después de la cantidad.
  const siguiente = palabras.slice(i + 1).find((p) => /\d/.test(p) && !/^[A-Z]{3}$/i.test(p));
  const precio = siguiente ? leerImporte(siguiente) : null;
  return { referencia: palabras[0], descripcion, cantidad, precioCentimos: precio?.centimos ?? null, pedidoProveedor: pedido };
}

/** La primera fila de verdad: se saltan las rayas de guiones y los huecos. */
function primeraFilaConDatos(filas: readonly FilaPdf[]): string[] {
  for (const fila of filas) {
    const palabras = fila.palabras.filter((p) => p.trim());
    if (palabras.length === 0 || palabras.every((p) => ADORNO.test(p))) continue;
    return palabras;
  }
  return [];
}

/** La localidad a la que va, de la cabecera: la última «43006 TARRAGONA». */
function destinoDeLaCabecera(filas: readonly FilaPdf[]): string | null {
  let ultima: string | null = null;
  for (const fila of filas) {
    const texto = fila.palabras.join(" ");
    if (CABECERA_INSA.test(normalizar(texto))) break; // ya es la tabla
    const m = texto.match(CP_LOCALIDAD);
    if (m) ultima = m[1].replace(/\s+/g, " ").trim();
  }
  return ultima;
}

/**
 * Lee la entrega. Devuelve `null` si el PDF no es una entrega de INSA; lo que
 * no encuentre queda a `null` o vacío, y nunca se inventa nada: quien llama
 * decide si con eso se puede dar de alta un albarán o hay que mirarlo a mano.
 */
export function leerEntregaInsa(filas: readonly FilaPdf[]): EntregaInsa | null {
  if (!esEntregaInsa(filas)) return null;

  let numeroAlbaran: string | null = null;
  let fecha: string | null = null;
  let referenciaCliente: string | null = null;

  // Los datos de la entrega van DEBAJO de su cabecera, pero no en la fila de
  // justo debajo: INSA mete una raya de guiones entre las dos.
  for (const [i, fila] of filas.entries()) {
    if (!CABECERA_ENTREGA.test(normalizar(fila.palabras.join(" ")))) continue;
    const datos = primeraFilaConDatos(filas.slice(i + 1, i + 5));
    const iFecha = datos.findIndex((p) => FECHA.test(p));
    const antes = iFecha < 0 ? datos : datos.slice(0, iFecha);
    const numero = antes.find((p) => NUMERO.test(p));
    const serie = antes.find((p) => SERIE.test(p) && p !== numero);
    if (numero) numeroAlbaran = serie ? `${serie}-${numero}` : numero;
    if (iFecha >= 0) {
      fecha = leerFecha(datos[iFecha]);
      referenciaCliente = datos.slice(iFecha + 1).find((p) => NUMERO.test(p)) ?? null;
    }
    break;
  }

  const pedidos: { numero: string; fecha: string | null }[] = [];
  const lineas: LineaInsa[] = [];
  let dentro = false;
  let pedidoActual: string | null = null;
  for (const fila of filas) {
    const palabras = fila.palabras.filter((p) => p.trim());
    if (palabras.length === 0) continue;
    const n = normalizar(palabras.join(" "));
    if (!dentro) {
      if (CABECERA_INSA.test(n)) dentro = true;
      continue;
    }
    if (TOTALES.test(n) || FIN_INSA.test(palabras.join(""))) break;
    if (palabras.every((p) => ADORNO.test(p))) continue;

    const grupo = grupoDePedido(palabras);
    if (grupo) {
      pedidoActual = grupo.numero;
      if (!pedidos.some((p) => p.numero === grupo.numero)) pedidos.push(grupo);
      continue;
    }
    if (!CANTIDAD_INSA.test(n)) continue; // texto: es observación, no mercancía
    const linea = lineaDeMercancia(palabras, pedidoActual);
    if (linea) lineas.push(linea);
  }

  return {
    numeroAlbaran,
    fecha,
    referenciaCliente,
    pedidos,
    lineas,
    observaciones: observacionesInsa(filas),
    destinoLocalidad: destinoDeLaCabecera(filas),
  };
}
