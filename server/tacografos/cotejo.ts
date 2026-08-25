/**
 * Motor de cotejo de impresos oficiales: localiza etiquetas conocidas en el
 * texto de un documento y recorta el valor que va pegado a cada una.
 *
 * Lo comparten los dos impresos de la extranet de VDO —el anexo II y el
 * informe técnico— y por eso vive aparte: la lista de etiquetas cambia por
 * impreso, la mecánica no.
 *
 * Criterio de diseño: **nunca adivina**. Una etiqueta que no aparece deja su
 * campo vacío y se anota en `avisos`. Y **exige que el valor vaya pegado a su
 * etiqueta** en el texto: por eso el texto de un PDF se extrae por bloques
 * (`textoDePdf`), donde esa adyacencia se cumple, y no con `asText()`, que
 * aplana las dos columnas del impreso y separa etiquetas de valores.
 */

export type Etiqueta = { clave: string; etiqueta: string };

export type Campos = Record<string, string>;

export type Lectura = {
  campos: Campos;
  /** Etiquetas que no se han encontrado en el documento. */
  avisos: string[];
  /** Cuántas de las etiquetas esperadas se han localizado. */
  encontradas: number;
  total: number;
};

/** Quita acentos y colapsa espacios, para que el cotejo no dependa del OCR. */
function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Versión normalizada del texto **con un mapa de vuelta al original**.
 *
 * Hace falta porque el cotejo se hace sin acentos y con los espacios
 * colapsados, pero el valor hay que recortarlo del original —con sus tildes—.
 * La primera versión daba por hecho que normalizar no cambiaba la longitud y
 * recortaba con los índices de la normalizada: falso en cuanto hay un salto de
 * línea doble o una ligadura, y entonces el recorte sale desplazado unos
 * caracteres («o: 8843KWW» en vez de «8843KWW»). Lo cazó la suite completa,
 * donde el texto llegaba con otro espaciado.
 *
 * `mapa[i]` es el índice en el original del carácter normalizado `i`. El
 * último elemento es el centinela: la longitud del original.
 */
function indexar(texto: string): { norm: string; mapa: number[] } {
  let norm = "";
  const mapa: number[] = [];
  let veniaEspacio = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (/\s/.test(c)) {
      // Una tirada de espacios, tabuladores y saltos vale por un espacio.
      if (!veniaEspacio) {
        norm += " ";
        mapa.push(i);
        veniaEspacio = true;
      }
      continue;
    }
    veniaEspacio = false;
    // Un carácter puede normalizarse a cero (una tilde suelta) o a varios: se
    // apuntan todos al mismo sitio del original.
    for (const b of normalizar(c)) {
      norm += b;
      mapa.push(i);
    }
  }
  mapa.push(texto.length);
  return { norm, mapa };
}


/**
 * Localiza cada etiqueta y se queda con lo que hay entre ella y la siguiente.
 *
 * Se busca cada etiqueta por separado, no en orden: el impreso va a dos
 * columnas y ni siquiera el texto por bloques garantiza el orden de lectura,
 * sólo que el valor sigue a su etiqueta allí donde esté.
 */
export function cotejar(texto: string, etiquetas: Etiqueta[]): Lectura {
  const original = texto.replace(/\r/g, "");
  const { norm, mapa } = indexar(original);

  const campos: Campos = {};
  const avisos: string[] = [];
  let encontradas = 0;

  const posiciones = etiquetas.map(({ clave, etiqueta }) => {
    const buscada = normalizar(etiqueta);
    return { clave, etiqueta, i: norm.indexOf(buscada), largo: buscada.length };
  });

  for (const p of posiciones) {
    if (p.i < 0) {
      campos[p.clave] = "";
      avisos.push(p.etiqueta);
      continue;
    }
    encontradas++;
    // La siguiente etiqueta que aparezca después de ésta corta el valor.
    const siguiente = posiciones
      .filter((o) => o.i > p.i)
      .reduce((min, o) => (min < 0 || o.i < min ? o.i : min), -1);

    const desde = mapa[p.i + p.largo] ?? original.length;
    const hasta = siguiente > 0 ? (mapa[siguiente] ?? original.length) : original.length;
    campos[p.clave] = limpiarValor(original.slice(desde, hasta));
  }

  return { campos, avisos, encontradas, total: etiquetas.length };
}

/**
 * Deja el valor en una línea.
 *
 * El recorte arrastra la numeración de la etiqueta siguiente («8843KWW\n2.»),
 * los dos puntos sueltos y los rótulos de sección del impreso; todo eso se
 * quita aquí y no en el cotejo, para que el cotejo siga siendo una búsqueda
 * simple de texto.
 */
function limpiarValor(bruto: string): string {
  return bruto
    .replace(/^[:\s]+/, "")
    .replace(/\n\s*\d{1,2}[.)]?\s*$/, "")
    .replace(/(DATOS DE LA UNIDAD|DATOS DEL CENTRO|DETALLES DE LA TRANSFERENCIA|DECLARACIÓN|DATOS DEL VEHÍCULO)[\s\S]*$/i, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s*\d{1,2}[.)]\s*$/, "")
    .trim();
}

/** `dd-mm-aaaa`, `dd/mm/aaaa` o `aaaa-mm-dd`, con hora opcional, a `aaaa-mm-dd`. */
export function fechaAIso(valor: string): string | null {
  const s = valor.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s);
  if (!m) return null;
  const dos = (n: string) => n.padStart(2, "0");
  return `${m[3]}-${dos(m[2])}-${dos(m[1])}`;
}

/** `SÍ`/`NO` del impreso a booleano. Devuelve null si no dice ninguna de las dos. */
export function siNo(valor: string): boolean | null {
  const v = normalizar(valor);
  if (/^s[ií]?\b/.test(v)) return true;
  if (/^no\b/.test(v)) return false;
  return null;
}
