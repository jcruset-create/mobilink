/**
 * Las líneas de mercancía del albarán, leídas de SU PDF.
 *
 * Código PURO: recibe las filas que da el lector de PDF y devuelve qué viene y
 * cuánto. Ni base de datos, ni ficheros.
 *
 * ── Por qué hace falta ──────────────────────────────────────────────────────
 *
 * El correo de Soledad trae la tabla en HTML y, en texto plano, a veces llega
 * aplanada: cinco artículos en una sola línea. El lector del correo hace lo
 * que puede —una fila es «cantidad, descripción, importe»— y con el amasijo
 * saca una línea sola, con una cantidad que en realidad era un importe:
 *
 *     210,62 × «4.00 385/65R22.5 TORQUE TQ022 164K 211.28 2.00 385/65R22.5
 *               HANKOOK TM11 160K 424.17 1.00 …»
 *
 * Reconstruir eso del texto es adivinar: cantidad e importe se escriben igual
 * y no hay forma de saber dónde acaba una fila y empieza la siguiente. El PDF
 * sí lo sabe: cada artículo en su fila y cada número en su columna. Por eso,
 * cuando hay PDF, manda el PDF.
 *
 * ── Qué es mercancía y qué no ───────────────────────────────────────────────
 *
 * De la tabla se quedan fuera las filas que se cobran pero no llegan al muelle
 * —el descuento por unidad, la gestión de NFU— y las de adorno. Se usa la
 * MISMA lista que el lector del correo (`esConcepto`), para que el papel y el
 * correo no discrepen en qué es un neumático.
 */

import { esConcepto } from "./correo/index.ts";
import { leerEntregaInsa } from "./insa.ts";
import { filasConContinuaciones, filasDeLaTabla, formatoDelAlbaran, normalizar, type FilaPdf, type FilaTabla } from "./observaciones.ts";

/** Una línea de mercancía tal y como la escribe el proveedor en su papel. */
export type LineaPdf = {
  referencia: string | null;
  descripcion: string;
  cantidad: number;
  precioCentimos: number | null;
};

/**
 * Un importe suelto: «211.28», «1.054,80». Una medida de neumático no lo es
 * —«315/80X22.5» lleva UN decimal, no dos—, y por eso sirve para distinguir.
 */
const IMPORTE = /\d+[.,]\d{2}(?!\d)/g;

/** Cuántos importes hacen de una descripción un amasijo y no un artículo. */
const IMPORTES_DE_UN_AMASIJO = 2;

/**
 * ¿Esta descripción es en realidad una tabla entera aplanada?
 *
 *     «4.00 385/65R22.5 TORQUE TQ022 164K 211.28 2.00 385/65R22.5 HANKOOK
 *      TM11 160K 424.17 1.00 315/70R22.5 HANKOOK DL51 154L 439.37 …»
 *
 * Se reconoce por los importes: un artículo no lleva ninguno dentro de su
 * nombre, y este lleva uno por cada fila que se ha tragado. Con dos basta.
 *
 * Hace falta para saber si la línea de un pedido se puede tirar sin perder
 * nada: una línea así no describe nada que se pueda contar en el muelle.
 */
export function esAmasijo(descripcion: string): boolean {
  return (descripcion.match(IMPORTE) ?? []).length >= IMPORTES_DE_UN_AMASIJO;
}

/** «0107091840003»: la referencia del artículo, delante de la descripción. */
const REFERENCIA = /^\d{9,}$/;

/**
 * Una fila de la tabla de Soledad: referencia, descripción y sus tres números
 * —cantidad, precio e importe—. Devuelve `null` si no es mercancía.
 */
function lineaDeSoledad(fila: FilaTabla): LineaPdf | null {
  const [cantidad, precio] = fila.numeros;
  if (!Number.isFinite(cantidad) || cantidad <= 0) return null;

  const palabras = fila.descripcion.filter((p) => p.trim());
  if (palabras.length === 0) return null;
  const referencia = REFERENCIA.test(palabras[0]) ? palabras[0] : null;
  const descripcion = (referencia ? palabras.slice(1) : palabras).join(" ").replace(/\s+/g, " ").trim();
  // «.» y demás adornos: una descripción de verdad tiene letras o una medida.
  if (!/\p{L}/u.test(descripcion) && !/\d{2,}/.test(descripcion)) return null;
  if (esConcepto({ cantidad, descripcion })) return null;

  return { referencia, descripcion, cantidad, precioCentimos: precio > 0 ? Math.round(precio * 100) : null };
}

/**
 * Lo que trae el albarán, del papel. Lista vacía si el PDF no es de un formato
 * conocido o no se le saca nada en claro: sin líneas legibles no se toca lo
 * que ya hay, que es mejor que sustituirlo por algo peor.
 */
export function lineasDeMercancia(filas: readonly FilaPdf[]): LineaPdf[] {
  const formato = formatoDelAlbaran(filas);

  if (formato === "INSA") {
    const entrega = leerEntregaInsa(filas);
    return (entrega?.lineas ?? [])
      .filter((l) => l.cantidad > 0 && !esConcepto({ cantidad: l.cantidad, descripcion: l.descripcion }))
      .map((l) => ({ referencia: l.referencia, descripcion: l.descripcion, cantidad: l.cantidad, precioCentimos: l.precioCentimos }));
  }

  if (formato !== "SOLEDAD") return [];

  const salida: LineaPdf[] = [];
  for (const fila of filasConContinuaciones(filasDeLaTabla(filas))) {
    // La fila de gestión de NFU cierra la mercancía: lo que va detrás son
    // observaciones, y ahí ya no hay artículos que contar.
    if (normalizar(fila.descripcion.join(" ")).includes("GESTION DE NFU")) break;
    const linea = lineaDeSoledad(fila);
    if (linea) salida.push(linea);
  }
  return salida;
}
