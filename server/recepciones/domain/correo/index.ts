/**
 * De un correo de Soledad a los campos con los que trabaja el módulo.
 *
 * Código PURO: ni base de datos, ni red. Se prueba con un asunto y un texto,
 * que es como se puede probar de verdad un parser.
 *
 * ── Los dos correos ─────────────────────────────────────────────────────────
 *
 * TIPO 1 · «Aviso de nuevo Pedido número B-2026-5688837»
 *
 *     Pedido:                          Contenido:
 *     B-2026-5688837                   Cantidad:
 *     Fecha:                           2
 *     15/09/2026                       Producto:
 *     Cliente:                         245/70X17.5 HANKOOK AH35 136M
 *     COMERCIAL SEA, S.A.              Precio unitario:
 *     Usuario que realiza el pedido:   248,45 €
 *     comercialseatarragona            Centro logístico:
 *     Destino:                         227 - ALMACEN MANRESA (CATALUÑA)
 *     COMERCIAL SEA, S.A.              Transportista:
 *     PIRIU CLAR C/COURE 27            TRANSAHER
 *     43006 TARRAGONA
 *
 * TIPO 2 · «Emisión de Albarán»
 *
 *     Pedido: 5688837
 *     Albarán: 2028450461
 *     Transportista: TRANSAHER
 *     (enlace al PDF del albarán)
 *
 * Las etiquetas pueden llevar el valor en la misma línea («Pedido: 5688837»)
 * o en la siguiente; el parser admite las dos formas, ignora acentos y
 * mayúsculas en las etiquetas, y NO se inventa nada: lo que no reconoce va a
 * `avisos`, y la ingesta decide si con eso se puede crear algo o hay que
 * dejarlo para que lo mire una persona.
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
};

export type AlbaranLeido = {
  numeroPedido: string | null;
  numeroAlbaran: string | null;
  transportista: string | null;
  fecha: string | null;
  /** Total expedido si el correo lo dice y no detalla líneas. */
  cantidadExpedida: number | null;
  lineas: LineaLeida[];
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
  ["CENTRO LOGISTICO", "CENTRO_LOGISTICO"],
  ["ALMACEN DE ORIGEN", "CENTRO_LOGISTICO"],
  ["ALMACEN", "CENTRO_LOGISTICO"],
  ["TRANSPORTISTA", "TRANSPORTISTA"],
  ["AGENCIA", "TRANSPORTISTA"],
];

type Token = { campo: Campo; valor: string } | { texto: string };

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
    const e = etiquetaDe(l);
    if (e) {
      cerrar();
      actual = { campo: e.campo, valores: e.resto ? [e.resto] : [] };
      continue;
    }
    if (!l) {
      // Una línea en blanco cierra el valor salvo en los bloques multilínea.
      if (actual && actual.campo !== "DESTINO") cerrar();
      continue;
    }
    if (actual) actual.valores.push(l);
    else tokens.push({ texto: l });
  }
  cerrar();
  return tokens;
}

/* ── Clasificación ───────────────────────────────────────────────────────── */

export function detectarTipo(asunto: string, texto: string): TipoCorreo {
  const a = normalizar(asunto);
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
    if (sinCp && !/\d{3,}/.test(sinCp)) return sinCp.replace(/\s*\(.*\)$/, "").trim();
  }
  return null;
}

/** Las líneas de producto: cada «Cantidad» abre una, y lo demás se le pega. */
function leerLineas(tokens: Token[]): LineaLeida[] {
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

export function parsearPedido(texto: string): { pedido: PedidoLeido; avisos: string[] } {
  const tokens = tokenizar(texto);
  const avisos: string[] = [];
  const destino = valorDe(tokens, "DESTINO");
  const pedido: PedidoLeido = {
    numeroPedido: primeraLinea(valorDe(tokens, "PEDIDO") ?? "") || null,
    fecha: leerFecha(primeraLinea(valorDe(tokens, "FECHA") ?? "")),
    cliente: primeraLinea(valorDe(tokens, "CLIENTE") ?? "") || null,
    usuario: primeraLinea(valorDe(tokens, "USUARIO") ?? "") || null,
    destino,
    destinoLocalidad: localidadDe(destino),
    almacenOrigen: primeraLinea(valorDe(tokens, "CENTRO_LOGISTICO") ?? "") || null,
    transportista: primeraLinea(valorDe(tokens, "TRANSPORTISTA") ?? "") || null,
    lineas: leerLineas(tokens),
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
  let numeroAlbaran = primeraLinea(valorDe(tokens, "ALBARAN") ?? "") || null;
  if (!numeroAlbaran) {
    // «Emisión de Albarán 2028450461» en el asunto.
    const m = normalizar(asunto).match(/ALBARAN\s*(?:N[ºO]?\.?)?\s*([A-Z0-9-]*\d{4,}[A-Z0-9-]*)/);
    if (m) numeroAlbaran = m[1];
  }
  const lineasLeidas = leerLineas(tokens);
  const albaran: AlbaranLeido = {
    numeroPedido: primeraLinea(valorDe(tokens, "PEDIDO") ?? "") || null,
    numeroAlbaran,
    transportista: primeraLinea(valorDe(tokens, "TRANSPORTISTA") ?? "") || null,
    fecha: leerFecha(primeraLinea(valorDe(tokens, "FECHA") ?? "")),
    cantidadExpedida: numero(valorDe(tokens, "CANTIDAD_EXPEDIDA")),
    lineas: lineasLeidas,
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
    const r = parsearPedido(texto);
    return { tipo, pedido: r.pedido, albaran: null, avisos: r.avisos };
  }
  if (tipo === "ALBARAN") {
    const r = parsearAlbaran(asunto, texto);
    return { tipo, pedido: null, albaran: r.albaran, avisos: r.avisos };
  }
  return { tipo, pedido: null, albaran: null, avisos: ["No se reconoce el tipo de correo por el asunto ni por el cuerpo."] };
}
