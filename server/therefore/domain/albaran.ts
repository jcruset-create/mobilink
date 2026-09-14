/**
 * Números de albarán: normalizarlos y decidir si dos son el mismo.
 *
 * Código PURO. Es la pieza de la que depende que no se mezclen dos albaranes
 * parecidos, así que se escribe aquí, con pruebas, y no repartida por consultas
 * SQL y comparaciones de cadenas.
 *
 * ── El problema ─────────────────────────────────────────────────────────────
 *
 * La incidencia de Therefore cita el albarán como lo escribe quien la manda:
 *
 *     0806295
 *
 * y el documento del proveedor lo imprime como le conviene:
 *
 *     ENT-100126-0806295
 *
 * Son el mismo. Pero éstos NO lo son:
 *
 *     0806295        0806296
 *
 * De modo que hace falta una comparación que aguante prefijos, guiones, ceros
 * a la izquierda e identificadores compuestos, y que a la vez **no** dé por
 * bueno un número parecido. Una comparación laxa que confunda dos albaranes
 * mete las líneas de un proveedor en la factura de otro, y eso se descubre
 * semanas después en contabilidad.
 *
 * ── La decisión ─────────────────────────────────────────────────────────────
 *
 * Se compara por **tiradas de dígitos**, no por la cadena entera:
 *
 *     "ENT-100126-0806295"  →  tiradas 100126 y 0806295  →  núcleo 806295
 *     "0806295"             →  tiradas 0806295           →  núcleo 806295
 *
 * El **núcleo** es la última tirada de al menos tres dígitos, sin ceros a la
 * izquierda. Es lo que se guarda en `albaran_normalizado` y lo que cruza el
 * correo con el documento y con otras notificaciones.
 *
 * Las tiradas de menos de tres dígitos se descartan, y eso resuelve solo un
 * caso que si no habría que tratar aparte: `0806295/2` tiene núcleo 806295,
 * porque el `2` no es un número de albarán, es un sufijo de línea.
 */

export type AlbaranNormalizado = {
  /** Tal y como venía, sin tocar. Se conserva para poder enseñarlo. */
  raw: string;
  /** Sólo letras y dígitos, en mayúsculas: `ENT1001260806295`. */
  completo: string;
  /** Las tiradas de ≥ 3 dígitos, sin ceros a la izquierda, en orden. */
  numeros: string[];
  /** La última tirada: la que identifica el albarán. */
  nucleo: string;
};

/** Mínimo de dígitos para que una tirada cuente como número de documento. */
const MIN_DIGITOS = 3;

function sinCerosIzquierda(n: string): string {
  const s = n.replace(/^0+/, "");
  // "000" es un número, aunque sea el cero: no se devuelve la cadena vacía.
  return s === "" ? "0" : s;
}

/**
 * Descompone un número de albarán. `null` si no hay ninguna tirada de dígitos
 * utilizable: «ALBARÁN» o «S/N» no son números de albarán, y tratarlos como si
 * lo fueran los haría coincidir entre sí.
 */
export function normalizarAlbaran(raw: unknown): AlbaranNormalizado | null {
  if (typeof raw !== "string") return null;
  const limpio = raw.trim();
  if (!limpio) return null;

  const tiradas: string[] = limpio.match(/\d+/g) ?? [];
  const numeros = tiradas.filter((n) => n.length >= MIN_DIGITOS).map(sinCerosIzquierda);
  if (numeros.length === 0) return null;

  return {
    raw: limpio,
    completo: limpio.toUpperCase().replace(/[^A-Z0-9]/g, ""),
    numeros,
    nucleo: numeros[numeros.length - 1],
  };
}

/**
 * La clave con la que se cruza un albarán en la base de datos.
 *
 * Es el núcleo, y va en `thf_actuaciones.albaran_normalizado`. Ahí lo usa el
 * índice único que impide que una reclamación duplique una actuación que ya
 * existía, y la búsqueda de expedientes candidatos al deduplicar.
 */
export function claveAlbaran(raw: unknown): string | null {
  return normalizarAlbaran(raw)?.nucleo ?? null;
}

export type ResultadoMatch = "MATCH" | "UNCERTAIN" | "NO_MATCH";

export type UmbralesAlbaran = {
  /** A partir de aquí se da por el mismo albarán. */
  match: number;
  /** Entre este y el anterior: lo mira una persona. */
  incierto: number;
};

export const UMBRALES_ALBARAN_POR_DEFECTO: UmbralesAlbaran = {
  match: 0.9,
  incierto: 0.6,
};

export type ComparacionAlbaran = {
  resultado: ResultadoMatch;
  /** 0 a 1. Se guarda junto al albarán analizado. */
  confianza: number;
  /** Una frase para la pantalla de validaciones. */
  motivo: string;
  /**
   * El número del documento se parece al pedido pero no es el mismo.
   *
   * Se marca aparte del NO_MATCH normal porque es la señal de que hay que
   * mirarlo: un `0806296` cuando se pidió `0806295` casi nunca es casualidad,
   * es un dígito mal tecleado en un sitio o en el otro. Que salga NO_MATCH es
   * lo correcto —no se cogen sus líneas—, pero merece decirse.
   */
  parecido: boolean;
};

/** ¿Difieren en un solo carácter (sustitución, inserción o borrado)? */
function distanciaUno(a: string, b: string): boolean {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 1) return false;

  if (a.length === b.length) {
    let distintos = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i] && ++distintos > 1) return false;
    }
    return distintos === 1;
  }

  // Longitudes que difieren en uno: el corto tiene que ser el largo sin un carácter.
  const [corto, largo] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let saltos = 0;
  while (i < corto.length && j < largo.length) {
    if (corto[i] === largo[j]) {
      i++;
      j++;
    } else if (++saltos > 1) {
      return false;
    } else {
      j++;
    }
  }
  return true;
}

/** Longitud mínima del núcleo para molestarse en decir «se parece». */
const MIN_PARECIDO = 4;

/**
 * ¿Es el albarán del documento el que pide la incidencia?
 *
 * No devuelve un sí o un no: devuelve **cuánta confianza** hay y por qué, y el
 * resultado sale de comparar esa confianza con los umbrales. Así, subir la
 * exigencia en una instalación concreta es cambiar un número en la
 * configuración, no tocar esta función.
 */
export function compararAlbaranes(
  solicitado: unknown,
  documento: unknown,
  umbrales: UmbralesAlbaran = UMBRALES_ALBARAN_POR_DEFECTO
): ComparacionAlbaran {
  const s = normalizarAlbaran(solicitado);
  const d = normalizarAlbaran(documento);

  if (!s || !d) {
    return {
      resultado: "NO_MATCH",
      confianza: 0,
      motivo: "No hay un número de albarán reconocible en los dos lados.",
      parecido: false,
    };
  }

  const decidir = (confianza: number, motivo: string, parecido = false): ComparacionAlbaran => ({
    resultado:
      confianza >= umbrales.match
        ? "MATCH"
        : confianza >= umbrales.incierto
          ? "UNCERTAIN"
          : "NO_MATCH",
    confianza,
    motivo,
    parecido,
  });

  // 1. Escrito exactamente igual, ignorando guiones y espacios.
  if (s.completo === d.completo) {
    return decidir(1, `El documento lo escribe igual: ${d.raw}.`);
  }

  /*
   * 2. Mismo núcleo.
   *
   * Cubre a la vez los ceros a la izquierda (`0806295` y `806295`) y el
   * identificador compuesto (`0806295` dentro de `ENT-100126-0806295`), porque
   * en los dos casos la última tirada de dígitos es la misma. Por eso no hay
   * una regla aparte para el prefijo: sería la misma comprobación escrita dos
   * veces.
   */
  if (s.nucleo === d.nucleo) {
    return decidir(0.95, `El documento lo identifica como ${d.raw}.`);
  }

  /*
   * 3. El número pedido aparece en el identificador, pero NO es su parte final.
   *
   * Pasa con `100126` dentro de `ENT-100126-0806295`, que suele ser un código
   * de centro o de serie y no el albarán. Se admite como dudoso —el documento
   * lo contiene, al fin y al cabo— y lo mira una persona; darlo por bueno sería
   * coger las líneas de un albarán porque su número de serie coincide.
   */
  if (d.numeros.includes(s.nucleo)) {
    return decidir(
      0.85,
      `El número ${s.nucleo} aparece dentro de ${d.raw}, pero no es la parte que lo identifica.`
    );
  }

  // 4. Se parece: un dígito de diferencia. No vale, pero hay que decirlo.
  if (s.nucleo.length >= MIN_PARECIDO && distanciaUno(s.nucleo, d.nucleo)) {
    return decidir(
      0.4,
      `El documento trae ${d.raw}, que se parece al pedido (${s.raw}) pero no es el mismo.`,
      true
    );
  }

  return decidir(0, `El documento trae ${d.raw}, que no es el albarán pedido (${s.raw}).`);
}

/**
 * Elige, de entre los albaranes de un documento, el que pide la incidencia.
 *
 * Devuelve el mejor y **baja el resultado a dudoso si hay empate**: un mismo
 * albarán que aparece dos veces en la misma factura es justo el caso en el que
 * coger el primero sería una decisión inventada.
 */
export function elegirAlbaran<T>(
  solicitado: unknown,
  candidatos: readonly T[],
  numeroDe: (c: T) => string,
  umbrales: UmbralesAlbaran = UMBRALES_ALBARAN_POR_DEFECTO
): { candidato: T | null; comparacion: ComparacionAlbaran; parecidos: T[] } {
  let mejor: { c: T; cmp: ComparacionAlbaran } | null = null;
  let empates = 0;
  const parecidos: T[] = [];

  for (const c of candidatos) {
    const cmp = compararAlbaranes(solicitado, numeroDe(c), umbrales);
    if (cmp.parecido) parecidos.push(c);
    if (!mejor || cmp.confianza > mejor.cmp.confianza) {
      mejor = { c, cmp };
      empates = 0;
    } else if (mejor && cmp.confianza === mejor.cmp.confianza && cmp.confianza > 0) {
      empates++;
    }
  }

  if (!mejor) {
    return {
      candidato: null,
      comparacion: {
        resultado: "NO_MATCH",
        confianza: 0,
        motivo: "El documento no trae ningún albarán.",
        parecido: false,
      },
      parecidos,
    };
  }

  if (empates > 0 && mejor.cmp.resultado === "MATCH") {
    return {
      candidato: mejor.c,
      comparacion: {
        ...mejor.cmp,
        resultado: "UNCERTAIN",
        motivo: "El albarán pedido aparece más de una vez en el documento.",
      },
      parecidos,
    };
  }

  return {
    candidato: mejor.cmp.resultado === "NO_MATCH" ? null : mejor.c,
    comparacion: mejor.cmp,
    parecidos,
  };
}
