/**
 * El informe técnico de tacógrafo en PDF, leído campo a campo.
 *
 * El centro entrega dos cosas con los mismos datos dentro: un Excel mensual
 * con todas las intervenciones —que es lo que lee `parser.ts`— y, por cada
 * intervención, este impreso oficial en PDF. Este módulo saca del PDF una
 * `FilaTacografo`, la MISMA que produce el Excel, para que `importar.ts` y
 * `escribir.ts` no se enteren de por dónde entró el dato.
 *
 * ── La clave: el A1 es el `id_origen` ───────────────────────────────────────
 *
 * «A1. Nº de orden de la intervención» es exactamente el identificador que
 * trae el Excel. Comprobado contra producción: de los seis informes de
 * ejemplo, cinco están ya entre las 1.744 intervenciones importadas con ese
 * mismo número. Por eso se puede saber si una intervención ya está dada de
 * alta sin adivinar nada: se busca su A1.
 *
 * ── Trampa 1 · las cruces NO están donde el texto las pone ──────────────────
 *
 * Las marcas del impreso son objetos de texto sueltos, colocados por
 * coordenadas. Leído como texto en orden de lectura, el mismo campo sale así:
 *
 *     N63. SÍ ( )
 *     x N64. NO ( )
 *
 * La `x` aparece ANTES de la etiqueta siguiente, y cualquiera diría que lo
 * marcado es «NO». La geometría dice lo contrario: la `x` está en x=62 y la
 * casilla de N63 ocupa de 60 a 67, mientras que la de N64 empieza en 117. Lo
 * marcado es «SÍ».
 *
 * Y no es un detalle de adorno: el mismo patrón son `V85`/`V86`
 * FAVORABLE/DESFAVORABLE, que es el campo `resultado` con el que
 * `vencimiento.ts` decide si el plazo se reinicia. Equivocarlo convierte un
 * tacógrafo favorable en uno desfavorable en la pantalla de control.
 *
 * Por eso este módulo NO lee texto plano: lee líneas con su caja, y una
 * casilla está marcada cuando hay una `x` DENTRO de su caja.
 *
 * ── Trampa 2 · cada PDF trae el impreso dos veces ───────────────────────────
 *
 * Son 7 páginas: el impreso completo (3), una en blanco, y el mismo impreso
 * otra vez (3). Uno es «Ejemplar para el taller» y el otro «Ejemplar para el
 * cliente». Si se acumulan las dos copias sale una intervención con todo
 * duplicado.
 *
 * Se lee cada copia por separado y se exige que digan lo mismo. Si discrepan
 * no se elige ninguna: se dice qué campo discrepa. Un impreso con dos números
 * de serie distintos es un impreso que hay que mirar a mano.
 *
 * ── Trampa 3 · «km anterior» guarda la lectura POSTERIOR ────────────────────
 *
 * El Excel llama a sus columnas «Cuentakm (viejo)» y «Cuentakm (nuevo)», y el
 * importador las guardó tal cual. Pero en producción 1.529 de las 1.543 filas
 * con los dos datos tienen el «anterior» MÁS ALTO que el «nuevo», y contra
 * este PDF cuadra el motivo:
 *
 *     km_anterior = 652266 = S78 (lectura al acabar el calibrado)
 *     km_nuevo    = 652259 = E27 (lectura de recepción)
 *
 * Así que aquí se hace igual de «mal»: `kmAnterior ← S78`, `kmNuevo ← E27`.
 * La coherencia con las 1.744 filas que ya existen vale más que el nombre de
 * la columna: la ficha enseña `kmNuevo`, y una fila creada desde el PDF con
 * el criterio opuesto saldría con siete kilómetros de diferencia respecto a
 * sus vecinas sin que nada lo explique.
 *
 * ── Trampa 4 · el Excel normaliza y el PDF no ───────────────────────────────
 *
 * El mismo campo, en el mismo informe:
 *
 *     I42 nº de pieza VU    PDF: 1381.7550303007   Excel: 13817550303007
 *     M56 nº serie sensor   PDF: 0015105011        Excel: 15105011
 *
 * El Excel quita el punto y los ceros a la izquierda. Si el PDF los deja, el
 * mismo tacógrafo sale como dos aparatos distintos en «Datos técnicos» de la
 * ficha, que coge cada campo de la intervención más reciente que lo traía.
 * Ver `soloDigitos()`.
 *
 * ── Lo que el PDF NO trae ───────────────────────────────────────────────────
 *
 * En los informes de las unidades VDO, la versión de software (`30041`,
 * `21010` en el Excel) no aparece: sale de la impresión de datos técnicos del
 * aparato, que no forma parte de este impreso. Se queda a null y no pasa
 * nada: la ficha ya enseña cada dato técnico con la fecha de la intervención
 * de la que sale, justamente porque no todas las intervenciones traen todos
 * los campos. En los tacógrafos inteligentes sí viene, en el campo I46, y de
 * ahí se coge (ver `versionesDe()`).
 *
 * ── El fabricante: la marca, no la razón social ─────────────────────────────
 *
 * El impreso pone en I41 la razón social del fabricante («Aumovio Germany
 * GmbH», «Stoneridge Electronics AB») y el Excel guarda la marca. Y la lista
 * de marcas de producción es de tres: VDO (1.665 filas), STONERIDGE (78) y
 * ASELSAN (1).
 *
 * Con tres valores y una correspondencia evidente, se traduce. No es una
 * tabla de equivalencias inventada: es que la ficha coge cada dato técnico de
 * la intervención más reciente que lo traía, y un vehículo con «Aumovio
 * Germany GmbH» al lado de otro con «VDO» obliga a quien lo lea a averiguar
 * si cambió el aparato o cambió el programa.
 *
 * La razón social literal no se pierde: está en el PDF que se queda
 * adjunto, que es justamente de lo que va todo esto. Y un fabricante que no
 * esté en la lista se guarda tal cual y se avisa, en vez de meterlo con
 * calzador en la marca más parecida.
 */

import { normalizarMatricula } from "../matricula.ts";
import { normalizar as normalizarMedida } from "./medidas.ts";
import {
  type FilaTacografo, type Problema, fechaDe, numeroDe, tgdDe,
} from "./parser.ts";

/** Una línea del PDF con su caja, en puntos y con el origen arriba a la izquierda. */
export interface LineaPdf {
  /** Página del documento, 1-indexada. */
  pagina: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Cuerpo de la fuente. En este impreso las cabeceras de bloque van a 10 y
   * el contenido a 8, y eso es lo que distingue «D. TIPO DE INTERVENCIÓN» de
   * lo que pone debajo.
   */
  tamano: number;
  texto: string;
}

export interface LecturaInforme {
  /** La intervención leída, o `null` si no se ha podido. */
  fila: FilaTacografo | null;
  problemas: Problema[];
  /** Cuántas copias del impreso traía el PDF. Lo normal es 2. */
  copias: number;
}

/** Lo que este módulo sabe reconocer. Otro impreso no se adivina. */
const CABECERA = /INFORME\s+T[ÉE]CNICO|TAC[ÓO]GRAFO\s+DIGITAL/i;

/**
 * El tipo de intervención del impreso, traducido al vocabulario del Excel.
 *
 * El bloque D no tiene casillas numeradas: son líneas de texto, y son más
 * finas que las tres categorías que usa el Excel («Control periódico de un
 * tacógrafo + Calibrado de un tacógrafo» para un calibrado, «Transferencia de
 * datos + Sustitución de un tacógrafo» para una transferencia). Hay que
 * traducirlas, porque `tipo_operacion` es lo que mira el vencimiento y las
 * 1.744 filas que ya están usan las tres de abajo.
 *
 * Las dos primeras familias están comprobadas contra producción con informes
 * que ya estaban importados. La de instalación NO: no hay ningún PDF de una
 * instalación entre los ejemplos, así que sus pistas son las palabras del
 * propio impreso y nada más. Si algún día no encaja, el informe lo dirá en
 * vez de caer en la categoría más probable.
 */
const FAMILIAS: Array<{ familia: string; pistas: RegExp[] }> = [
  {
    familia: "Calibrado o Parametrización / Control / Reparación",
    pistas: [/calibrad/i, /control\s+peri/i, /parametriz/i, /reparaci/i],
  },
  {
    familia: "Instalación / Activación",
    pistas: [/instalaci[óo]n\s+de\s+un\s+tac/i, /activaci/i],
  },
  {
    familia: "Transferencia / Certificado de intransferibilidad / Sustitución",
    pistas: [/transferencia/i, /intransferibilidad/i, /sustituci/i],
  },
];

/**
 * La razón social del impreso, traducida a la marca que usa el Excel.
 *
 * VDO es hoy Aumovio: la división de tacógrafos de Continental cambió de
 * nombre, y el impreso ya lo refleja mientras las 1.744 filas importadas
 * siguen diciendo VDO.
 */
const MARCAS: Array<{ marca: string; pista: RegExp }> = [
  { marca: "VDO", pista: /aumovio|continental|vdo/i },
  { marca: "STONERIDGE", pista: /stoneridge/i },
  { marca: "ASELSAN", pista: /aselsan/i },
];

/**
 * Las líneas del PDF, con su caja.
 *
 * Con `mupdf` y no con `pdftotext`: el binario de poppler existe en esta
 * máquina pero no en el servidor, y de todas formas su salida es texto plano,
 * que es justo lo que no sirve (trampa 1).
 */
export async function lineasDeInforme(pdf: Buffer): Promise<LineaPdf[]> {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(pdf, "application/pdf");
  const lineas: LineaPdf[] = [];
  for (let p = 0; p < doc.countPages(); p += 1) {
    const texto = JSON.parse(doc.loadPage(p).toStructuredText("preserve-spans").asJSON());
    for (const bloque of (texto.blocks ?? [])) {
      for (const linea of (bloque.lines ?? [])) {
        const t = String(linea.text ?? "").trim();
        if (t === "") continue;
        lineas.push({
          pagina: p + 1,
          x: linea.bbox.x, y: linea.bbox.y, w: linea.bbox.w, h: linea.bbox.h,
          tamano: Number(linea.font?.size ?? 0),
          texto: t,
        });
      }
    }
  }
  return lineas;
}

/**
 * Las copias del impreso que trae el PDF.
 *
 * Cada copia acaba en la página que pone «Ejemplar para el …». Las páginas en
 * blanco que el centro mete entre las dos no estorban: no llevan ninguna
 * línea, así que no abren copia.
 */
export function copiasDelInforme(lineas: LineaPdf[]): LineaPdf[][] {
  const porPagina = new Map<number, LineaPdf[]>();
  for (const l of lineas) {
    const lista = porPagina.get(l.pagina) ?? [];
    lista.push(l);
    porPagina.set(l.pagina, lista);
  }

  const copias: LineaPdf[][] = [];
  let actual: LineaPdf[] = [];
  for (const pagina of [...porPagina.keys()].sort((a, b) => a - b)) {
    const dela = porPagina.get(pagina)!;
    actual = actual.concat(dela);
    if (dela.some((l) => /Ejemplar\s+para\s+el/i.test(l.texto))) {
      copias.push(actual);
      actual = [];
    }
  }
  // Lo que quede sin cerrar es una copia a medias, pero es una copia: un PDF
  // de una sola página con los datos vale más que no leer nada.
  if (actual.length > 0) copias.push(actual);
  return copias;
}

/** Hasta dónde se admite que el valor de un campo esté a la derecha, en puntos. */
const ANCHO_COLUMNA = 260;

/** Lo que parece una etiqueta y no un valor. */
const ES_ETIQUETA = /^[A-Z]{1,2}\d{0,2}\s*\.|:\s*$/;

/**
 * Contenido, no cabecera de bloque.
 *
 * El impreso pone las cabeceras a cuerpo 10 y todo lo demás a 8, y hace falta
 * distinguirlas: la etiqueta «C13. Fecha de caducidad de la tarjeta…» tiene a
 * dos puntos de distancia, y a su derecha, la segunda línea del título del
 * bloque de al lado («INSTALACIÓN DEL», de «G. PLACA DE INSTALACIÓN DEL
 * TACÓGRAFO»). Sin este filtro, la fecha de caducidad de la tarjeta del
 * técnico sale valiendo «INSTALACIÓN DEL».
 */
const esContenido = (l: LineaPdf): boolean => l.tamano < 9;

/**
 * La línea de la etiqueta de un código, la primera que aparezca.
 *
 * Vale tanto para los códigos del impreso (`E22.Matrícula:`, sin espacio
 * después del punto) como para los dos campos que no tienen código y se
 * buscan por su rótulo (`Modelo:`, `Test de reloj:`).
 */
function etiquetaDe(lineas: LineaPdf[], codigo: string): LineaPdf | null {
  const re = new RegExp(`^${codigo}\\s*[.:]`);
  return lineas.find((l) => re.test(l.texto)) ?? null;
}

/**
 * El valor de un campo con código.
 *
 * Se busca por geometría y no por el texto que sigue a los dos puntos, porque
 * en los pies de página varios campos comparten línea y lo que sigue a los
 * dos puntos de uno es la etiqueta del siguiente.
 *
 * El impreso coloca el valor a la derecha de su etiqueta y un punto más
 * arriba (diferencia de línea base), salvo en la portada, donde lo pone
 * debajo. Se admiten las dos.
 */
export function valorDe(lineas: LineaPdf[], codigo: string): string | null {
  const et = etiquetaDe(lineas, codigo);
  if (!et) return null;

  const derecha = lineas
    .filter((l) => l.pagina === et.pagina
      && Math.abs(l.y - et.y) <= 3
      && l.x > et.x + et.w - 2
      && l.x < et.x + ANCHO_COLUMNA
      && esContenido(l)
      && !ES_ETIQUETA.test(l.texto))
    .sort((a, b) => a.x - b.x);
  if (derecha.length > 0) return derecha[0].texto;

  // En la portada el valor va debajo, alineado con la etiqueta, y la etiqueta
  // puede ocupar dos líneas («C12. Identificación completa de la» / «tarjeta
  // del centro de ensayo:»). De ahí la ventana de 45 puntos. Lo que la hace
  // segura es la alineación: un valor de otro campo va a la derecha de SU
  // etiqueta, no debajo de esta.
  const debajo = lineas
    .filter((l) => l.pagina === et.pagina
      && l.y > et.y + 4 && l.y < et.y + 45
      && Math.abs(l.x - et.x) <= 6
      && esContenido(l)
      && !ES_ETIQUETA.test(l.texto))
    .sort((a, b) => a.y - b.y);
  return debajo.length > 0 ? debajo[0].texto : null;
}

/**
 * Un valor que ocupa varias líneas, como el nombre del técnico.
 *
 * «PEDRO RAMON FERRAN» y «GONZALEZ» son dos líneas del impreso y un solo
 * nombre, y el Excel lo trae junto. Se siguen cogiendo líneas de la misma
 * columna mientras se peguen a la anterior y no sean la etiqueta siguiente.
 */
export function valorLargoDe(lineas: LineaPdf[], codigo: string): string | null {
  const et = etiquetaDe(lineas, codigo);
  if (!et) return null;
  const primera = valorDe(lineas, codigo);
  if (primera == null) return null;

  const columna = lineas
    .filter((l) => l.pagina === et.pagina && Math.abs(l.x - et.x) <= 6 && l.y > et.y)
    .sort((a, b) => a.y - b.y);
  const partes: string[] = [];
  let anterior: LineaPdf | null = null;
  for (const l of columna) {
    if (!esContenido(l) || ES_ETIQUETA.test(l.texto)) {
      if (partes.length > 0) break;
      continue;   // la etiqueta puede ocupar dos líneas
    }
    if (anterior && l.y - anterior.y > 14) break;
    partes.push(l.texto.trim());
    anterior = l;
  }
  const junto = partes.join(" ").replace(/\s+/g, " ").trim();
  return junto === "" ? null : junto;
}

/**
 * El titular del vehículo (E26), que son tres líneas y solo dos interesan.
 *
 * El impreso pone el código de cliente, el nombre en dos líneas y debajo la
 * dirección:
 *
 *     E26. Titular:   (B43009091) TERESA Y JOSE PLANA EMPRESA
 *                                                   PLANA S.L.
 *                     LES CREUS, 29. 43120 CONSTANTI - Tarragona
 *
 * El Excel guarda «TERESA Y JOSE PLANA EMPRESA PLANA S.L.»: sin el código y
 * sin la dirección. La dirección se reconoce por su código postal, que es lo
 * único que tienen todas y no tiene ninguna razón social.
 *
 * Y el valor empieza CINCO PUNTOS POR ENCIMA de su etiqueta, porque el
 * recuadro va centrado: de ahí que la ventana de arriba sea más ancha que los
 * tres puntos que valen para los demás campos.
 */
export function titularDe(lineas: LineaPdf[]): string | null {
  const et = etiquetaDe(lineas, "E26");
  if (!et) return null;
  const partes: string[] = [];
  for (const l of lineas
    .filter((l) => l.pagina === et.pagina
      && l.y > et.y - 8 && l.y < et.y + 30
      && l.x > et.x + et.w - 2
      && esContenido(l)
      && !ES_ETIQUETA.test(l.texto))
    .sort((a, b) => a.y - b.y)) {
    if (/\b\d{5}\b/.test(l.texto)) break;   // la dirección
    partes.push(l.texto.trim());
  }
  const junto = partes.join(" ").replace(/^\([^)]*\)\s*/, "").replace(/\s+/g, " ").trim();
  return junto === "" ? null : junto;
}

/**
 * El campo I46, que son DOS versiones separadas por una barra.
 *
 * El impreso lo rotula «Versión de mapa y software» y lo rellena como
 * `<mapa> / <software>`, cada trozo en su propio objeto de texto y la barra
 * en otro. El Excel los guarda en dos columnas, y se puede afirmar cuál es
 * cuál porque los valores de la base lo dicen: `version` lleva 24 filas con
 * `PABF.S0L` y `version_mapa` lleva fechas como `20220901`.
 *
 * Aquí no vale `valorDe()`, que coge el valor más a la izquierda: en el
 * informe del tacógrafo inteligente lo más a la izquierda es la barra, y el
 * campo saldría vacío.
 *
 * Ojo: en los informes de las unidades VDO este campo viene vacío y el Excel
 * trae una versión de software igualmente (`30041`, `21010`). Sale de la
 * impresión de datos técnicos del aparato, que no está en este impreso, así
 * que una fila creada desde el PDF de una VDO se queda sin ella.
 */
export function versionesDe(lineas: LineaPdf[]): { mapa: string | null; software: string | null } {
  const et = etiquetaDe(lineas, "I46");
  if (!et) return { mapa: null, software: null };
  const junto = lineas
    .filter((l) => l.pagina === et.pagina
      && Math.abs(l.y - et.y) <= 3
      && l.x > et.x + et.w - 2
      && l.x < et.x + ANCHO_COLUMNA
      && esContenido(l)
      && !ES_ETIQUETA.test(l.texto))
    .sort((a, b) => a.x - b.x)
    .map((l) => l.texto.trim())
    .join(" ");
  const [mapa, software] = junto.split("/");
  return { mapa: limpio(mapa ?? null), software: limpio(software ?? null) };
}

/**
 * ¿Está marcada la casilla de este código?
 *
 * La casilla es el `( )` más cercano a la derecha de la etiqueta, y está
 * marcada si hay una `x` suelta dentro de su caja. Es la trampa 1: no se
 * puede resolver leyendo texto.
 */
export function marcada(lineas: LineaPdf[], codigo: string): boolean {
  const et = etiquetaDe(lineas, codigo);
  if (!et) return false;

  const casilla = lineas
    .filter((l) => l.pagina === et.pagina
      && Math.abs(l.y - et.y) <= 3
      && l.x >= et.x
      && /^\(\s*\)$/.test(l.texto.trim()))
    .sort((a, b) => a.x - b.x)[0];
  if (!casilla) return false;

  return lineas.some((l) => l.pagina === casilla.pagina
    && /^[xX]$/.test(l.texto)
    && Math.abs(l.y - casilla.y) <= 3
    && l.x + l.w / 2 >= casilla.x - 1
    && l.x + l.w / 2 <= casilla.x + casilla.w + 1);
}

/**
 * Un sí/no de tres estados.
 *
 * Ninguna de las dos marcada NO es «no»: es que no se comprobó, y el Excel lo
 * distingue («No comprobado» en 1.403 de las 1.744 filas). Las dos marcadas
 * es un impreso mal rellenado, y se dice.
 */
function siNo(lineas: LineaPdf[], codSi: string, codNo: string): string | null {
  const si = marcada(lineas, codSi);
  const no = marcada(lineas, codNo);
  if (si && no) return "Ambas";
  if (si) return "Sí";
  if (no) return "No";
  return null;
}

/** Solo los dígitos, que es lo que guarda el Excel. Ver trampa 4. */
export function soloDigitos(v: string | null): string | null {
  if (v == null) return null;
  const d = v.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return d === "" ? null : d;
}

/**
 * Un código numérico como lo guarda el Excel, y solo si es numérico.
 *
 * El impreso puntúa los códigos largos y el Excel los guarda pelados:
 *
 *     I42 nº de pieza VU         1381.7550303007  →  13817550303007
 *     I46 versión de software    021.010          →  21010
 *
 * Pero `012.00E` y `PABF.S0L` —que también viven en la columna `version` de
 * producción, 22 y 24 filas— se quedan como están: llevan letras, no son un
 * número con puntos de adorno. De ahí la condición en vez de un
 * `soloDigitos()` a todo.
 */
export function comoElExcel(v: string | null): string | null {
  if (v == null) return null;
  return /^[\d.]+$/.test(v) ? soloDigitos(v) : v;
}

/**
 * Un número de aparato sin los ceros de delante.
 *
 * El Excel guarda el equipo de calibrado como `499` donde el impreso pone
 * `00499`. Es la trampa 4 otra vez, y se aplica SOLO cuando el valor es todo
 * dígitos: el banco de rodillos es `voiliv006860217` y ahí los ceros van
 * dentro de un código, no delante de un número.
 */
export function sinCerosDelante(v: string | null): string | null {
  if (v == null) return null;
  return /^\d+$/.test(v) ? String(v).replace(/^0+(?=\d)/, "") : v;
}

/** Un decimal del impreso («-0,2 s / 24 h», «0,3») como lo escribe el Excel. */
export function decimalDe(v: string | null): string | null {
  if (v == null) return null;
  const m = v.replace(/,/g, ".").match(/-?\d+(?:\.\d+)?/);
  // `String(Number())` y no el texto tal cual: el impreso escribe «0,0» donde
  // el Excel guarda «0», y dos formas del mismo cero en el mismo jsonb son
  // dos formas que alguien tendrá que comparar algún día.
  return m ? String(Number(m[0])) : null;
}

/** Un texto del impreso, con los «vacíos» del formulario tratados como vacío. */
function limpio(v: string | null): string | null {
  if (v == null) return null;
  const t = v.replace(/\s+/g, " ").trim();
  if (t === "" || /^[-/\s]+$/.test(t)) return null;
  return t;
}

/** Las líneas de un bloque: su columna, debajo de la cabecera y hasta la siguiente. */
function bloqueDe(lineas: LineaPdf[], cabecera: RegExp): LineaPdf[] {
  const cab = lineas.find((l) => cabecera.test(l.texto) && l.tamano >= 9);
  if (!cab) return [];
  const columna = lineas
    .filter((l) => l.pagina === cab.pagina && Math.abs(l.x - cab.x) <= 6 && l.y > cab.y)
    .sort((a, b) => a.y - b.y);
  const dentro: LineaPdf[] = [];
  for (const l of columna) {
    // Una cabecera de bloque es tamaño 10; su continuación, también.
    if (l.tamano >= 9) {
      if (dentro.length > 0) break;
      continue;   // «REALIZADA», la segunda línea del título
    }
    dentro.push(l);
  }
  return dentro;
}

/** El texto del bloque de observaciones (W), de corrido. */
function observacionesDe(lineas: LineaPdf[]): string | null {
  const cab = lineas.find((l) => /^W\.\s*OBSERVACIONES/i.test(l.texto));
  if (!cab) return null;
  const fin = lineas
    .filter((l) => l.pagina === cab.pagina && l.y > cab.y && /^[XY]\.\s*FIRMA/i.test(l.texto))
    .sort((a, b) => a.y - b.y)[0];
  const hasta = fin ? fin.y : cab.y + 200;
  // Alineadas con la cabecera: a esa misma altura, pero a la derecha, el
  // impreso lleva el sello de la foto del vehículo («8235JDF - 04/11/2026
  // 10:19 (UTC)» y el nombre del .JPG), que no es una observación y que el
  // Excel no trae.
  const texto = lineas
    .filter((l) => l.pagina === cab.pagina && l.y > cab.y && l.y < hasta
      && Math.abs(l.x - cab.x) <= 6)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((l) => l.texto.trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return texto === "" ? null : texto;
}

/**
 * La fila «DIST. RECORRIDA» del bloque Q: tacógrafo, banco y error.
 *
 * Son tres números en la misma línea del impreso, bajo las cabeceras Q68, Q69
 * y Q70, y se distinguen por su x. No tienen código propio, así que se cogen
 * de la fila que pone «RECORRIDA».
 */
function distanciasDe(lineas: LineaPdf[]): { tacografo: string | null; banco: string | null; error: string | null } {
  const et = lineas.find((l) => /^RECORRIDA/i.test(l.texto));
  if (!et) return { tacografo: null, banco: null, error: null };
  const nums = lineas
    .filter((l) => l.pagina === et.pagina
      && Math.abs(l.y - et.y) <= 4
      && l.x > et.x + et.w - 2
      && /^-?[\d.,]+$/.test(l.texto.trim()))
    .sort((a, b) => a.x - b.x)
    .map((l) => decimalDe(l.texto));
  return { tacografo: nums[0] ?? null, banco: nums[1] ?? null, error: nums[2] ?? null };
}

/** Una copia del impreso, leída. */
function leerCopia(lineas: LineaPdf[], pagina: number): { fila: FilaTacografo | null; problemas: Problema[] } {
  const problemas: Problema[] = [];
  const pega = (motivo: string, valor?: string) => problemas.push({ fila: pagina, motivo, valor });

  if (!lineas.some((l) => CABECERA.test(l.texto))) {
    pega("El PDF no parece un informe técnico de tacógrafo digital.");
    return { fila: null, problemas };
  }

  const idOrigen = limpio(valorDe(lineas, "A1"));
  if (!idOrigen) {
    pega("No se encuentra el «A1. Nº de orden de la intervención», que es lo que "
      + "identifica la intervención.");
    return { fila: null, problemas };
  }

  const fecha = fechaDe(limpio(valorDe(lineas, "A3")));
  if (!fecha) {
    pega("No se encuentra la fecha (A3), y sin fecha la intervención no se puede "
      + "situar en el histórico ni cuenta para el vencimiento.", idOrigen);
    return { fila: null, problemas };
  }

  const matriculaOrigen = limpio(valorDe(lineas, "E22"));
  if (!matriculaOrigen) {
    pega("No se encuentra la matrícula (E22).", idOrigen);
    return { fila: null, problemas };
  }

  // El tipo de intervención, traducido al vocabulario del Excel.
  const dichoD = bloqueDe(lineas, /^D\.\s*TIPO\s+DE\s+INTERVENCI/i)
    .map((l) => l.texto.trim()).join(" ").replace(/\s+/g, " ").trim();
  const encajan = FAMILIAS.filter((f) => f.pistas.some((p) => p.test(dichoD)));
  let tipoOperacion: string | null = null;
  if (dichoD === "") {
    pega("El informe no dice qué tipo de intervención es (bloque D).", idOrigen);
  } else if (encajan.length === 0) {
    pega(`El tipo de intervención del informe no se reconoce: «${dichoD}». No se `
      + "asigna ninguna categoría, porque un tipo mal puesto mueve el vencimiento "
      + "del vehículo.", idOrigen);
  } else if (encajan.length > 1) {
    pega(`El tipo de intervención «${dichoD}» encaja en más de una categoría `
      + `(${encajan.map((f) => f.familia).join("; ")}).`, idOrigen);
  } else {
    tipoOperacion = encajan[0].familia;
  }

  // El resultado: V85 FAVORABLE / V86 DESFAVORABLE. Ninguna marcada es
  // «-----», que es lo que lleva el Excel en las 449 filas sin resultado.
  const v = siNo(lineas, "V85", "V86");
  let resultado: string | null;
  if (v === "Ambas") {
    resultado = null;
    pega("El informe trae marcadas a la vez FAVORABLE y DESFAVORABLE (V85/V86).", idOrigen);
  } else if (v === "Sí") {
    resultado = "Favorable";
  } else if (v === "No") {
    resultado = "Desfavorable";
  } else {
    resultado = "-----";
  }

  const medidaOrigen = limpio(valorDe(lineas, "E28")) ?? limpio(valorDe(lineas, "S76"));
  const medidaNorm = medidaOrigen ? normalizarMedida(medidaOrigen) : null;

  const razonSocial = limpio(valorDe(lineas, "I41"));
  const marca = MARCAS.find((m) => razonSocial != null && m.pista.test(razonSocial));
  const fabricante = marca ? marca.marca : razonSocial;
  if (razonSocial != null && !marca) {
    pega(`El fabricante del tacógrafo, «${razonSocial}», no es ninguna de las marcas `
      + "conocidas (VDO, STONERIDGE, ASELSAN). Se guarda tal cual.", idOrigen);
  }

  const versiones = versionesDe(lineas);
  const observaciones = observacionesDe(lineas);
  const dist = distanciasDe(lineas);

  // Solo las comprobaciones que este impreso trae de verdad. Las otras
  // (bluetooth, giroscopio, tests GNSS y DSRC) son de los tacógrafos
  // inteligentes y no están en este formulario: inventarles una clave vacía
  // sería ensuciar el jsonb.
  const comprobaciones: Record<string, string> = {};
  const reloj = decimalDe(limpio(valorDe(lineas, "Test de reloj")));
  if (reloj != null) comprobaciones.reloj = reloj;
  // L54/L55 es de dos estados en el Excel: «Sí» si está marcado el sí, y «No»
  // en cualquier otro caso. Comprobado con las 201 transferencias, que traen
  // las dos casillas vacías y «No» en la base.
  comprobaciones.velocidad = marcada(lineas, "L54") ? "Sí" : "No";
  const lim = siNo(lineas, "Z87", "Z88");
  comprobaciones.limitador = lim === "Sí" ? "Sí" : lim === "No" ? "No" : "No comprobado";
  if (lim === "Ambas") {
    comprobaciones.limitador = "No comprobado";
    pega("El informe trae marcadas a la vez las dos casillas del limitador (Z87/Z88).", idOrigen);
  }
  if (dist.tacografo != null) comprobaciones.distanciaTacografo = dist.tacografo;
  if (dist.banco != null) comprobaciones.distanciaBanco = dist.banco;
  if (dist.error != null) comprobaciones.distanciaError = dist.error;

  const fila: FilaTacografo = {
    fila: pagina,
    idOrigen,
    fecha,
    tipoOperacion,
    resultado,
    ordenTrabajo: limpio(valorDe(lineas, "A2")),

    matriculaOrigen,
    matriculaNorm: normalizarMatricula(matriculaOrigen),
    bastidor: limpio(valorDe(lineas, "E23")),
    marca: limpio(valorDe(lineas, "E25")),
    modelo: limpio(valorDe(lineas, "Modelo")),
    categoria: limpio(valorDe(lineas, "Categoría")),
    clienteNombre: limpio(titularDe(lineas)),

    medidaOrigen,
    medidaNorm,
    // El impreso trae la medida en texto libre; si el normalizador no la sabe
    // leer, se guarda igual y se marca para preguntar, como con el Excel.
    medidaSospechosa: medidaOrigen != null && medidaNorm == null,
    medidaAnteriorOrigen: null,
    medidaAnteriorNorm: null,

    // Trampa 3: el nombre de las columnas está al revés de lo que guardan, y
    // así están las 1.744 filas que ya existen.
    kmAnterior: numeroDe(limpio(valorDe(lineas, "S78"))),
    kmNuevo: numeroDe(limpio(valorDe(lineas, "E27"))),

    paramL: soloDigitos(limpio(valorDe(lineas, "S75"))),
    paramW: soloDigitos(limpio(valorDe(lineas, "S73"))),
    paramK: soloDigitos(limpio(valorDe(lineas, "S74"))),
    paramLAnterior: null,
    paramWAnterior: null,

    // El impreso es el del tacógrafo digital —se titula así— y no hay otro.
    tipoTacografo: "Digital",
    fabricante,
    referencia: comoElExcel(limpio(valorDe(lineas, "I42"))),
    version: comoElExcel(versiones.software),
    versionMapa: comoElExcel(versiones.mapa),
    numSerie: soloDigitos(limpio(valorDe(lineas, "I44"))),
    numSensor: soloDigitos(limpio(valorDe(lineas, "M56"))),
    gnss: null,
    dsrc: null,
    // «PR04265152 / 43009 / PR03238952» → «PR04265152/43009/PR03238952»,
    // que es como lo junta el Excel. Trampa 4.
    precintos: limpio(valorDe(lineas, "U84"))?.replace(/\s*\/\s*/g, "/") ?? null,

    bRodillos: sinCerosDelante(limpio(valorDe(lineas, "T79"))),
    eqCalibrado: sinCerosDelante(limpio(valorDe(lineas, "T80"))),
    manometro: sinCerosDelante(limpio(valorDe(lineas, "T81"))),
    cronometro: sinCerosDelante(limpio(valorDe(lineas, "T82"))),

    tecnico: limpio(valorLargoDe(lineas, "C11")),
    tecnicoTarjeta: limpio(valorDe(lineas, "C12")),
    tecnicoTarjetaCad: fechaDe(limpio(valorDe(lineas, "C13"))),
    tecnicoTarjetaVer: null,

    observaciones,
    tgdFichero: tgdDe(observaciones),
    comprobaciones: Object.keys(comprobaciones).length > 0 ? comprobaciones : null,
  };

  // La tarjeta del técnico viene como «EA43044379001209 (G2)»: el Excel
  // guarda el número en un campo y la versión en otro.
  if (fila.tecnicoTarjeta) {
    const m = fila.tecnicoTarjeta.match(/^(\S+)\s*\(([^)]+)\)\s*$/);
    if (m) { fila.tecnicoTarjeta = m[1]; fila.tecnicoTarjetaVer = m[2]; }
  }

  return { fila, problemas };
}

/** Los campos que se comparan entre las dos copias del impreso. */
const COMPARABLES = ["idOrigen", "fecha", "tipoOperacion", "resultado", "matriculaNorm",
  "bastidor", "medidaNorm", "kmAnterior", "kmNuevo", "paramL", "paramW", "paramK",
  "numSerie", "numSensor", "referencia", "precintos"] as const;

/**
 * El informe, leído.
 *
 * Lee las dos copias y exige que coincidan en lo que identifica y mide la
 * intervención. Si discrepan devuelve `null` y dice en qué: es la trampa 2, y
 * un impreso con dos valores distintos del mismo campo no se resuelve
 * eligiendo uno.
 */
export function leerInformePdf(lineas: LineaPdf[]): LecturaInforme {
  const copias = copiasDelInforme(lineas);
  if (copias.length === 0) {
    return {
      fila: null,
      copias: 0,
      problemas: [{ fila: 1, motivo: "El PDF no tiene texto: no se puede leer." }],
    };
  }

  const leidas = copias.map((c) => leerCopia(c, c[0]?.pagina ?? 1));
  const problemas = leidas.flatMap((l) => l.problemas);
  const buenas = leidas.filter((l) => l.fila != null).map((l) => l.fila!);
  if (buenas.length === 0) return { fila: null, copias: copias.length, problemas };

  const primera = buenas[0];
  for (const otra of buenas.slice(1)) {
    for (const campo of COMPARABLES) {
      if (primera[campo] !== otra[campo]) {
        problemas.push({
          fila: otra.fila,
          motivo: `Las dos copias del impreso no dicen lo mismo en «${campo}»: `
            + `«${primera[campo] ?? "—"}» y «${otra[campo] ?? "—"}». No se elige ninguna.`,
          valor: primera.idOrigen,
        });
        return { fila: null, copias: copias.length, problemas };
      }
    }
  }

  // La primera copia es la que se queda, y su `fila` es la página en la que
  // empieza: en los problemas sirve para señalar dónde mirar.
  return { fila: primera, copias: copias.length, problemas };
}
