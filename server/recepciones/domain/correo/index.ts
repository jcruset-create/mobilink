/**
 * De un correo de Soledad a los campos con los que trabaja el módulo.
 *
 * Código PURO: ni base de datos, ni red. Se prueba con un asunto y un texto,
 * que es como se puede probar de verdad un parser.
 *
 * ── El correo de verdad ─────────────────────────────────────────────────────
 *
 * Soledad NO escribe etiquetas. Lo cuenta en prosa y pone el contenido en una
 * tabla. Un albarán real, entero:
 *
 *     Asunto: Emisión de Albarán B /2028450459 con fecha 15/09/2026.
 *
 *     Estimado COMERCIAL SEA, S.A.,
 *     tu pedido 5687439 ha sido emitido por nuestro centro logístico y la
 *     entrega se realizará a través de TRANSAHER.
 *     ...
 *     El pedido será entregado a:
 *     COMERCIAL SEA, S.A.
 *     PI RIU CLAR C/COURE 27,
 *     43006 TARRAGONA
 *     TARRAGONA ESPAÑA
 *
 *     El contenido del pedido es:
 *
 *     Cantidad
 *     Descripción
 *     Importe
 *     2.00 245/70X17.5 HANKOOK AH35 136M 248.45
 *     -2.00 10 EUR DTO UD HANKOOK 10.00
 *     2.00 S.I.Gestión de NFU Cat.D1T 6.05
 *     Pulsar enlace para ver albarán adjunto.
 *     <https://ws.gruposoledad.com/b2b?serviceName=descargarAlbaran&...>
 *
 * De ahí salen: el albarán «B/2028450459» y su fecha, del ASUNTO; el pedido
 * «5687439», de la FRASE; el transportista, de «a través de TRANSAHER»; y una
 * línea de mercancía, de la TABLA.
 *
 * ── Qué es mercancía y qué no ───────────────────────────────────────────────
 *
 * La tabla mezcla lo que se recibe en el muelle con lo que sólo se cobra: el
 * descuento (cantidad negativa) y la gestión de neumáticos fuera de uso. Esas
 * filas se leen y se guardan en `conceptos`, pero NO son líneas: si entraran,
 * cada recepción pediría al almacén contar un descuento.
 *
 * ── Y las etiquetas, por si acaso ───────────────────────────────────────────
 *
 * Se siguen reconociendo «Pedido: 5688837», «Albarán:», «Cantidad:», etc., con
 * el valor en la misma línea o en la siguiente: el proveedor cambia sus
 * plantillas sin avisar y un `.eml` viejo tiene que poder reprocesarse. Cuando
 * hay tabla, la tabla manda.
 *
 * El parser NO se inventa nada: lo que no reconoce va a `avisos`, y la ingesta
 * decide si con eso se puede crear algo o hay que dejarlo para una persona.
 *
 * Importes y fechas se leen con las mismas funciones que Therefore
 * (`leerImporte`, `leerFecha`): son puras, están probadas y resuelven ya el
 * problema del separador decimal.
 */

import { leerFecha, leerImporte } from "../../../therefore/domain/correo/importes.ts";

export type TipoCorreo = "PEDIDO" | "ALBARAN" | "DESCONOCIDO";

export type LineaLeida = {
  cantidad: number | null;
  descripcion: string | null;
  precioCentimos: number | null;
  referencia: string | null;
};

export type PedidoLeido = {
  numeroPedido: string | null;
  fecha: string | null;
  cliente: string | null;
  usuario: string | null;
  /** El bloque «Destino» tal cual, con sus saltos de línea. */
  destino: string | null;
  /** La localidad del destino: la última línea sin el código postal. */
  destinoLocalidad: string | null;
  almacenOrigen: string | null;
  transportista: string | null;
  lineas: LineaLeida[];
  /** Filas de la tabla que no son mercancía: descuentos, gestión de NFU… */
  conceptos: LineaLeida[];
};

export type AlbaranLeido = {
  numeroPedido: string | null;
  /**
   * Todos los pedidos que nombra el correo, sin repetir. Casi siempre uno,
   * pero Soledad agrupa: «tus pedidos (5690526,5690526,…) han sido emitidos».
   * Si salen varios DISTINTOS, el albarán viene de más de un pedido y eso no
   * lo decide el parser.
   */
  numerosPedido: string[];
  numeroAlbaran: string | null;
  transportista: string | null;
  fecha: string | null;
  /**
   * El albarán de Soledad trae también a dónde va y a nombre de quién. No hace
   * falta para el albarán, pero sí para DEDUCIR el pedido cuando su correo no
   * ha llegado: de aquí sale el centro.
   */
  destino: string | null;
  destinoLocalidad: string | null;
  cliente: string | null;
  /** Total expedido si el correo lo dice y no detalla líneas. */
  cantidadExpedida: number | null;
  lineas: LineaLeida[];
  /** Filas de la tabla que no son mercancía: descuentos, gestión de NFU… */
  conceptos: LineaLeida[];
  /** Enlaces al PDF, el más probable primero. */
  enlacesPdf: string[];
};

export type CorreoParseado = {
  tipo: TipoCorreo;
  pedido: PedidoLeido | null;
  albaran: AlbaranLeido | null;
  avisos: string[];
};

/* ── Texto ───────────────────────────────────────────────────────────────── */

/** Sin acentos y en mayúsculas: para comparar, nunca para guardar. */
export function normalizar(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function lineas(texto: string): string[] {
  return texto
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .split("\n")
    .map((l) => l.trim());
}

/* ── Etiquetas ───────────────────────────────────────────────────────────── */

type Campo =
  | "PEDIDO"
  | "ALBARAN"
  | "FECHA"
  | "CLIENTE"
  | "USUARIO"
  | "DESTINO"
  | "CONTENIDO"
  | "CANTIDAD"
  | "CANTIDAD_EXPEDIDA"
  | "PRODUCTO"
  | "REFERENCIA"
  | "PRECIO"
  | "CENTRO_LOGISTICO"
  | "TRANSPORTISTA";

/**
 * Las etiquetas que se reconocen, ya normalizadas. El orden importa: las más
 * largas van antes para que «CANTIDAD EXPEDIDA» no se lea como «CANTIDAD».
 */
const ETIQUETAS: [string, Campo][] = [
  ["USUARIO QUE REALIZA EL PEDIDO", "USUARIO"],
  // Las frases con las que Soledad abre un bloque, que son etiquetas sin serlo.
  ["EL PEDIDO SERA ENTREGADO A", "DESTINO"],
  ["EL CONTENIDO DEL PEDIDO ES", "CONTENIDO"],
  ["EL CONTENIDO DEL PEDIDO", "CONTENIDO"],
  ["USUARIO", "USUARIO"],
  ["NUMERO DE PEDIDO", "PEDIDO"],
  ["N PEDIDO", "PEDIDO"],
  ["PEDIDO", "PEDIDO"],
  ["NUMERO DE ALBARAN", "ALBARAN"],
  ["N ALBARAN", "ALBARAN"],
  ["ALBARAN", "ALBARAN"],
  ["FECHA DE EXPEDICION", "FECHA"],
  ["FECHA EXPEDICION", "FECHA"],
  ["FECHA", "FECHA"],
  ["CLIENTE", "CLIENTE"],
  ["DESTINO", "DESTINO"],
  ["DIRECCION DE ENTREGA", "DESTINO"],
  ["CONTENIDO", "CONTENIDO"],
  ["CANTIDAD EXPEDIDA", "CANTIDAD_EXPEDIDA"],
  ["UNIDADES EXPEDIDAS", "CANTIDAD_EXPEDIDA"],
  ["CANTIDAD", "CANTIDAD"],
  ["UNIDADES", "CANTIDAD"],
  ["PRODUCTO", "PRODUCTO"],
  ["ARTICULO", "PRODUCTO"],
  ["DESCRIPCION", "PRODUCTO"],
  ["REFERENCIA", "REFERENCIA"],
  ["PRECIO UNITARIO", "PRECIO"],
  ["PRECIO", "PRECIO"],
  ["IMPORTE", "PRECIO"],
  ["CENTRO LOGISTICO", "CENTRO_LOGISTICO"],
  ["ALMACEN DE ORIGEN", "CENTRO_LOGISTICO"],
  ["ALMACEN", "CENTRO_LOGISTICO"],
  ["TRANSPORTISTA", "TRANSPORTISTA"],
  ["AGENCIA", "TRANSPORTISTA"],
];

type Token = { campo: Campo; valor: string } | { fila: LineaLeida } | { texto: string };

/* ── La tabla de contenido ───────────────────────────────────────────────── */

/**
 * Una fila entera en una línea: cantidad, descripción e importe.
 *
 *     2.00 245/70X17.5 HANKOOK AH35 136M 248.45
 *     -2.00 10 EUR DTO UD HANKOOK 10.00
 *
 * La forma es estrecha a propósito —empieza por un número y acaba por un
 * importe con dos decimales— para que no se trague prosa: «43006 TARRAGONA»
 * no es una fila, y «911 910 910.» tampoco.
 *
 * El importe es el precio UNITARIO, aunque la cabecera diga «Importe»: en el
 * correo de arriba hay 2 unidades y pone 248.45, que es lo que vale una.
 */
const FILA = /^(-?\d+(?:[.,]\d+)?)\s+(\S.*?)\s+(-?\d{1,3}(?:[.,]\d{3})*[.,]\d{2})\s*(?:€|EUR)?\.?$/;

export function filaDeTabla(linea: string): LineaLeida | null {
  const m = linea.trim().match(FILA);
  if (!m) return null;
  const cantidad = Number(m[1].replace(",", "."));
  const descripcion = m[2].trim();
  if (!Number.isFinite(cantidad) || descripcion.length < 3) return null;
  return { cantidad, descripcion, precioCentimos: leerImporte(m[3]).centimos, referencia: null };
}

/**
 * Lo que la tabla cobra pero no llega al muelle: el descuento por unidad y la
 * gestión de neumáticos fuera de uso. Se leen y se guardan aparte para que se
 * vean, pero no se convierten en líneas a contar.
 *
 * La lista es corta y explícita a propósito: ante la duda, una fila es
 * mercancía. Colar un concepto de más se ve en pantalla; perder una línea de
 * neumáticos, no.
 */
const CONCEPTOS = [/\bDTO\b/, /\bDESCUENTOS?\b/, /\bNFU\b/, /\bECOTASA\b/, /GESTION DE RESIDUOS/, /\bPORTES?\b/, /\bTRANSPORTE\b/];

export function esConcepto(linea: Pick<LineaLeida, "cantidad" | "descripcion">): boolean {
  if (linea.cantidad !== null && linea.cantidad < 0) return true; // un descuento
  if (!linea.descripcion) return false;
  const d = normalizar(linea.descripcion);
  return CONCEPTOS.some((r) => r.test(d));
}

/**
 * Reconoce una etiqueta al principio de la línea: «Pedido:», «Pedido: 5688837»,
 * «Nº Albarán 2028450461». Devuelve el campo y lo que quede tras la etiqueta.
 */
function etiquetaDe(linea: string): { campo: Campo; resto: string } | null {
  const n = normalizar(linea).replace(/^N[ºO°]?\.?\s+/, "N ");
  for (const [etiqueta, campo] of ETIQUETAS) {
    if (n === etiqueta || n.startsWith(`${etiqueta}:`) || n.startsWith(`${etiqueta} :`)) {
      const idx = linea.indexOf(":");
      const resto = idx >= 0 ? linea.slice(idx + 1).trim() : "";
      return { campo, resto };
    }
  }
  return null;
}

/** Convierte el texto en una secuencia de campos con su valor (una o varias líneas). */
function tokenizar(texto: string): Token[] {
  const tokens: Token[] = [];
  let actual: { campo: Campo; valores: string[] } | null = null;
  const cerrar = () => {
    if (actual) tokens.push({ campo: actual.campo, valor: actual.valores.join("\n").trim() });
    actual = null;
  };
  for (const l of lineas(texto)) {
    const fila = filaDeTabla(l);
    if (fila) {
      cerrar();
      tokens.push({ fila });
      continue;
    }
    const e = etiquetaDe(l);
    if (e) {
      cerrar();
      actual = { campo: e.campo, valores: e.resto ? [e.resto] : [] };
      continue;
    }
    if (!l) {
      // Una línea en blanco cierra el valor, pero no lo que aún no ha
      // empezado: «Destino:», una línea vacía y debajo la dirección.
      if (actual && actual.valores.length > 0) cerrar();
      continue;
    }
    if (actual) actual.valores.push(l);
    else tokens.push({ texto: l });
  }
  cerrar();
  return tokens;
}

/* ── Reenvíos ────────────────────────────────────────────────────────────── */

/** «Fwd:», «RV:», «Re:»… delante del asunto de verdad, y a veces varias veces. */
export function asuntoLimpio(asunto: string): string {
  let a = asunto;
  for (let i = 0; i < 5; i += 1) {
    const sig = a.replace(/^\s*(?:fwd?|rv|re|tr)\s*(?:\[\d+\])?\s*:\s*/i, "");
    if (sig === a) break;
    a = sig;
  }
  return a.trim();
}

/**
 * El remitente ORIGINAL de un correo reenviado: la línea «From:» que mete el
 * cliente de correo al reenviar.
 *
 * Sirve SÓLO para saber de qué proveedor es el correo. Quién puede meter
 * correo en el módulo lo sigue decidiendo el remitente de verdad del sobre,
 * que esto no toca: el cuerpo lo escribe cualquiera.
 */
export function remitenteReenviado(texto: string): string | null {
  const m = texto.match(/^[>\s]*(?:From|De|Remitente)\s*:.*?([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/im);
  return m ? m[1].toLowerCase() : null;
}

/* ── Prosa ───────────────────────────────────────────────────────────────── */

/** Un número de documento: «B /2028450459», «B-2026-5688837», «5687439». */
const NUMERO_DOC = "((?:[A-Z]{1,3}\\s*[-/]?\\s*)?\\d{4,}(?:[-/]\\d{2,})*)";

/**
 * Soledad separa la serie del número: «B -2026-5693921», «B /2028450459».
 * Se pega antes de buscar para que el número sea UNA palabra y no dos.
 */
function pegarSerie(texto: string): string {
  return texto.replace(/\b([A-Z])\s+([-/])\s*(\d)/g, "$1$2$3");
}

/**
 * Palabras de relleno entre «pedido» y su número: «pedido ES B-2026-…»,
 * «Pedido NÚMERO: B -2026-…». La lista es corta a propósito: cualquier otra
 * cosa corta la búsqueda, que es lo que evita tragarse el número de
 * seguimiento de «escribe el número de pedido ENTERO T0100007879100».
 */
const RELLENO = new Set(["ES", "NUMERO", "NUM", "N", "NO", "DE", "DEL", "EL", "LA", "TU", "SU"]);

function busca(texto: string, patron: string): string | null {
  const m = texto.match(new RegExp(patron, "i"));
  return m ? m[1].replace(/\s+/g, "") : null;
}

/**
 * Los pedidos que nombra la frase, en orden y sin repetir:
 *
 *     tu pedido 5687439 ha sido emitido…            → ["5687439"]
 *     tus pedidos (5690526,5690526,5690526) han…    → ["5690526"]
 *
 * Se recorren TODAS las apariciones de «pedido» porque hay varias que no
 * llevan número («Información Entrega de Pedido», «Escribe el número de
 * pedido entero T0100007879100»): vale la primera que dé números, y la lista
 * se corta en la primera palabra que ya no lo es.
 */
export function pedidosEnProsa(texto: string): string[] {
  const doc = new RegExp(`^${NUMERO_DOC}$`, "i");
  // Sólo espacios, nunca saltos de línea: si no, un «…Entrega de Pedido» al
  // final de una línea se tragaría la siguiente y con ella el número de verdad.
  for (const m of pegarSerie(texto).matchAll(/\bpedidos?\b[ \t]*[:(]?[ \t]*([^)\n]*)/gi)) {
    const numeros: string[] = [];
    for (const trozo of (m[1] ?? "").split(/[,;\s]+/)) {
      const t = trozo.replace(/[.:,]+$/, "").trim();
      if (!t) continue;
      // El relleno se salta; lo demás corta.
      if (numeros.length === 0 && RELLENO.has(normalizar(t).replace(/[ºo°.]/g, ""))) continue;
      if (!doc.test(t)) break;
      if (!numeros.includes(t)) numeros.push(t);
    }
    if (numeros.length > 0) return numeros;
  }
  return [];
}

/** «Realizado por comercialseatarragona». */
export function usuarioEnProsa(texto: string): string | null {
  const m = texto.match(/^\s*realizado por\s+(.+?)\s*$/im);
  const v = m ? m[1].trim() : "";
  return v && v.length <= 80 ? v : null;
}

/**
 * «…expedida por nuestro centro logísitico  54 - GETAFE». Sí, con la errata
 * que trae el correo del proveedor: se admiten las dos formas.
 */
export function almacenEnProsa(texto: string): string | null {
  // En la MISMA línea, y se recorren todas: el mismo correo dice después
  // «emitida por nuestro centro logístico, recibirás otro correo», y eso no es
  // un almacén. Un valor que empieza por coma o punto es esa frase, no un dato.
  for (const m of texto.matchAll(/centro[ \t]+log[ií]s[ií]?tico[ \t]*:?[ \t]*([^\n]*)/gi)) {
    const v = (m[1] ?? "").trim().replace(/[.,]+$/, "");
    if (!v || /^[,.;:]/.test(v) || v.length > 80) continue;
    return v;
  }
  return null;
}

/** «Emisión de Albarán B /2028450459 con fecha…», en el asunto o en el cuerpo. */
export function albaranEnProsa(texto: string): string | null {
  return busca(pegarSerie(texto), `\\balbar[aá]n(?:es)?\\s*:?\\s*(?:n[ºo°]?\\.?\\s*)?${NUMERO_DOC}`);
}

/** «…con fecha 15/09/2026.» */
export function fechaEnProsa(texto: string): string | null {
  const m = texto.match(/\bcon fecha\s+(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i);
  return m ? leerFecha(m[1]) : null;
}

/** «Estimado COMERCIAL SEA, S.A.,» — a nombre de quién va la mercancía. */
export function clienteEnProsa(texto: string): string | null {
  const m = texto.match(/^\s*estimad[oa]s?\s+(.+?)\s*[,:]\s*$/im);
  const v = m ? m[1].trim() : "";
  return v && v.length <= 120 && !/^(cliente|se[nñ]or)/i.test(v) ? v : null;
}

/** «…la entrega se realizará a través de TRANSAHER.» */
export function transportistaEnProsa(texto: string): string | null {
  const m = texto.match(/\ba trav[eé]s de\s+([^.,\n]+)/i);
  const v = m ? m[1].trim() : "";
  return v && v.length <= 60 ? v : null;
}

/* ── Clasificación ───────────────────────────────────────────────────────── */

export function detectarTipo(asunto: string, texto: string): TipoCorreo {
  const a = normalizar(asuntoLimpio(asunto));
  if (/AVISO DE NUEVO PEDIDO|NUEVO PEDIDO/.test(a)) return "PEDIDO";
  if (/EMISION DE ALBARAN|ALBARAN/.test(a)) return "ALBARAN";
  const t = normalizar(texto);
  if (/\bALBARAN\b/.test(t) && /\bPEDIDO\b/.test(t)) return "ALBARAN";
  if (/\bPEDIDO\b/.test(t) && /\b(PRODUCTO|CANTIDAD|ARTICULO)\b/.test(t)) return "PEDIDO";
  return "DESCONOCIDO";
}

/* ── Lectura ─────────────────────────────────────────────────────────────── */

function primeraLinea(v: string): string {
  return v.split("\n")[0]?.trim() ?? "";
}

function numero(v: string | null): number | null {
  if (!v) return null;
  const m = primeraLinea(v).replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** «43006 TARRAGONA» → «TARRAGONA»; «TARRAGONA» → «TARRAGONA». */
export function localidadDe(destino: string | null): string | null {
  if (!destino) return null;
  const ls = destino.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = ls.length - 1; i >= 0; i -= 1) {
    const sinCp = ls[i].replace(/^\d{4,5}\s*[-,]?\s*/, "").trim();
    // «TARRAGONA ESPAÑA» es la localidad y el país en la misma línea.
    const sinPais = sinCp.replace(/[,\s]+(ESPA[NÑ]A|SPAIN|PORTUGAL|FRANCIA|FRANCE)\.?$/i, "").trim();
    if (sinPais && !/\d{3,}/.test(sinPais)) return sinPais.replace(/\s*\(.*\)$/, "").replace(/[,.]$/, "").trim();
  }
  return null;
}

/**
 * Las líneas de producto. Si el correo trae tabla, son sus filas y punto: las
 * etiquetas sueltas que quedan alrededor («Cantidad», «Descripción», «Importe»
 * de cabecera) son el encabezado de esa misma tabla, no una línea.
 * Si no hay tabla, se arma a la antigua: cada «Cantidad» abre una línea.
 */
function leerLineas(tokens: Token[]): LineaLeida[] {
  const filas = tokens.filter((t): t is { fila: LineaLeida } => "fila" in t).map((t) => t.fila);
  if (filas.length > 0) return filas;

  const salida: LineaLeida[] = [];
  let actual: LineaLeida | null = null;
  const nueva = (): LineaLeida => {
    actual = { cantidad: null, descripcion: null, precioCentimos: null, referencia: null };
    salida.push(actual);
    return actual;
  };
  for (const t of tokens) {
    if (!("campo" in t)) continue;
    switch (t.campo) {
      case "CANTIDAD":
        if (!actual || actual.cantidad !== null) nueva();
        actual!.cantidad = numero(t.valor);
        break;
      case "PRODUCTO":
        if (!actual || actual.descripcion !== null) nueva();
        actual!.descripcion = primeraLinea(t.valor) || null;
        break;
      case "REFERENCIA":
        if (!actual) nueva();
        actual!.referencia = primeraLinea(t.valor) || null;
        break;
      case "PRECIO": {
        if (!actual) nueva();
        const imp = leerImporte(primeraLinea(t.valor));
        actual!.precioCentimos = imp.centimos;
        break;
      }
      default:
        break;
    }
  }
  return salida.filter((l) => l.cantidad !== null || l.descripcion !== null);
}

function valorDe(tokens: Token[], campo: Campo): string | null {
  const t = tokens.find((x): x is { campo: Campo; valor: string } => "campo" in x && x.campo === campo);
  return t && t.valor ? t.valor : null;
}

const ENLACE = /https?:\/\/[^\s<>"')\]]+/gi;

function enlacesDe(texto: string): string[] {
  const todos = Array.from(new Set(texto.match(ENLACE) ?? [])).map((u) => u.replace(/[.,;:]+$/, ""));
  // Los que huelen a albarán o a PDF, primero; una portada («https://x/») al final.
  const puntua = (u: string) => {
    let p = 0;
    if (/\.pdf(\?|$)/i.test(u)) p += 3;
    if (/albaran|delivery|doc|descarga|download|pdf/i.test(u)) p += 1;
    if (/^https?:\/\/[^/]+\/?$/i.test(u)) p -= 2;
    return p;
  };
  return todos.sort((a, b) => puntua(b) - puntua(a));
}

export function parsearPedido(texto: string, asunto = ""): { pedido: PedidoLeido; avisos: string[] } {
  const tokens = tokenizar(texto);
  const avisos: string[] = [];
  const destino = valorDe(tokens, "DESTINO");
  const leidas = leerLineas(tokens);
  const pedido: PedidoLeido = {
    // Primero la etiqueta, si la hay; si no, la frase; y por último el asunto.
    numeroPedido: primeraLinea(valorDe(tokens, "PEDIDO") ?? "") || pedidosEnProsa(texto)[0] || pedidosEnProsa(asunto)[0] || null,
    fecha: leerFecha(primeraLinea(valorDe(tokens, "FECHA") ?? "")) ?? fechaEnProsa(asunto) ?? fechaEnProsa(texto),
    cliente: primeraLinea(valorDe(tokens, "CLIENTE") ?? "") || clienteEnProsa(texto),
    usuario: primeraLinea(valorDe(tokens, "USUARIO") ?? "") || usuarioEnProsa(texto),
    destino,
    destinoLocalidad: localidadDe(destino),
    // La prosa primero: la etiqueta suelta «ALMACEN» casa con cualquier línea
    // que sólo diga eso y se traga la siguiente.
    almacenOrigen: almacenEnProsa(texto) || primeraLinea(valorDe(tokens, "CENTRO_LOGISTICO") ?? "") || null,
    transportista: primeraLinea(valorDe(tokens, "TRANSPORTISTA") ?? "") || transportistaEnProsa(texto),
    lineas: leidas.filter((l) => !esConcepto(l)),
    conceptos: leidas.filter((l) => esConcepto(l)),
  };
  if (!pedido.numeroPedido) avisos.push("No se ha encontrado el número de pedido.");
  if (pedido.lineas.length === 0) avisos.push("No se ha encontrado ninguna línea de producto.");
  for (const [i, l] of pedido.lineas.entries()) {
    if (l.cantidad === null || l.cantidad <= 0) avisos.push(`La línea ${i + 1} no tiene cantidad.`);
    if (!l.descripcion) avisos.push(`La línea ${i + 1} no tiene producto.`);
  }
  if (!pedido.destinoLocalidad) avisos.push("No se ha podido leer el destino.");
  return { pedido, avisos };
}

export function parsearAlbaran(asunto: string, texto: string): { albaran: AlbaranLeido; avisos: string[] } {
  const tokens = tokenizar(texto);
  const avisos: string[] = [];
  const limpio = asuntoLimpio(asunto);
  const leidas = leerLineas(tokens);
  const destino = valorDe(tokens, "DESTINO");
  const etiquetado = primeraLinea(valorDe(tokens, "PEDIDO") ?? "");
  const numerosPedido = etiquetado ? [etiquetado] : pedidosEnProsa(texto).length > 0 ? pedidosEnProsa(texto) : pedidosEnProsa(limpio);
  const albaran: AlbaranLeido = {
    numeroPedido: numerosPedido[0] ?? null,
    numerosPedido,
    // El número del albarán vive en el asunto («Emisión de Albarán B /2028450459»).
    numeroAlbaran: primeraLinea(valorDe(tokens, "ALBARAN") ?? "") || albaranEnProsa(limpio) || albaranEnProsa(texto),
    transportista: primeraLinea(valorDe(tokens, "TRANSPORTISTA") ?? "") || transportistaEnProsa(texto),
    fecha: leerFecha(primeraLinea(valorDe(tokens, "FECHA") ?? "")) ?? fechaEnProsa(limpio) ?? fechaEnProsa(texto),
    cantidadExpedida: numero(valorDe(tokens, "CANTIDAD_EXPEDIDA")),
    destino,
    destinoLocalidad: localidadDe(destino),
    cliente: primeraLinea(valorDe(tokens, "CLIENTE") ?? "") || clienteEnProsa(texto),
    lineas: leidas.filter((l) => !esConcepto(l)),
    conceptos: leidas.filter((l) => esConcepto(l)),
    enlacesPdf: enlacesDe(texto),
  };
  if (!albaran.numeroPedido) avisos.push("No se ha encontrado el número de pedido.");
  if (!albaran.numeroAlbaran) avisos.push("No se ha encontrado el número de albarán.");
  if (albaran.enlacesPdf.length === 0) avisos.push("El correo no trae enlace al PDF del albarán.");
  return { albaran, avisos };
}

export function parsearCorreo(asunto: string, texto: string): CorreoParseado {
  const tipo = detectarTipo(asunto, texto);
  if (tipo === "PEDIDO") {
    const r = parsearPedido(texto, asunto);
    return { tipo, pedido: r.pedido, albaran: null, avisos: r.avisos };
  }
  if (tipo === "ALBARAN") {
    const r = parsearAlbaran(asunto, texto);
    return { tipo, pedido: null, albaran: r.albaran, avisos: r.avisos };
  }
  return { tipo, pedido: null, albaran: null, avisos: ["No se reconoce el tipo de correo por el asunto ni por el cuerpo."] };
}
