/**
 * Qué clase de matrícula es, para dibujarla como la placa real.
 *
 * Solo decide el DIBUJO. No valida ni corrige: una matrícula que no encaja en
 * ningún formato español se enseña tal cual está escrita, en un recuadro liso.
 *
 * La misma regla está en la tablet (flutter_app/lib/services/matricula_es.dart)
 * y tiene que decir lo mismo: si aquí un remolque sale rojo y allí blanco, el
 * operario y la oficina no están viendo el mismo vehículo.
 */

export type TipoMatricula = "actual" | "remolque" | "antigua" | "otra";

export type MatriculaDibujo = {
  tipo: TipoMatricula;
  /** Los grupos, para pintarlos separados: «6084» «FRG». */
  partes: string[];
};

// Las matrículas actuales no llevan vocales ni Ñ ni Q.
const LETRAS = "BCDFGHJKLMNPRSTVWXYZ";

const ACTUAL = new RegExp(`^(\\d{4})([${LETRAS}]{3})$`);
const REMOLQUE = new RegExp(`^(R)(\\d{4})([${LETRAS}]{3})$`);
const ANTIGUA = /^([A-Z]{1,2})(\d{4})([A-Z]{1,2})$/;

/**
 * Siglas de provincia del sistema anterior (hasta el año 2000). Sin esta
 * lista, cualquier matrícula extranjera con forma de «letras-4 cifras-letras»
 * saldría dibujada como española.
 */
const PROVINCIAS = new Set([
  "A", "AB", "AL", "AV", "B", "BA", "BI", "BU", "C", "CA", "CC", "CE", "CO", "CR", "CS", "CU",
  "GC", "GE", "GI", "GR", "GU", "H", "HU", "IB", "J", "L", "LE", "LO", "LU", "M", "MA", "ML",
  "MU", "NA", "O", "OR", "OU", "P", "PM", "PO", "S", "SA", "SE", "SG", "SO", "SS", "T", "TE",
  "TF", "TO", "V", "VA", "VI", "Z", "ZA",
]);

export function dibujoMatricula(matricula: unknown): MatriculaDibujo {
  const m = String(matricula ?? "").toUpperCase().replace(/[\s\-.]/g, "");
  let r = REMOLQUE.exec(m);
  if (r) return { tipo: "remolque", partes: [r[1], r[2], r[3]] };
  r = ACTUAL.exec(m);
  if (r) return { tipo: "actual", partes: [r[1], r[2]] };
  r = ANTIGUA.exec(m);
  if (r && PROVINCIAS.has(r[1])) return { tipo: "antigua", partes: [r[1], r[2], r[3]] };
  return { tipo: "otra", partes: [String(matricula ?? "").trim().toUpperCase()] };
}
