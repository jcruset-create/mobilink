/**
 * Plano del centro: saneado del SVG y vínculo forma ↔ trastero.
 *
 * El SVG llega de un programa de dibujo (Inkscape, Illustrator, AutoCAD…) y se
 * pinta DENTRO del panel y, en la fase 4, de la web pública. Un SVG puede
 * llevar `<script>`, manejadores `onclick`, `<foreignObject>` con HTML o
 * enlaces `javascript:`; pintarlo tal cual sería dar a quien lo sube la sesión
 * de quien lo mira. Por eso se guarda YA SANEADO, con una lista BLANCA de
 * elementos y atributos: lo que no está en la lista no pasa, aunque sea
 * inofensivo. Es más fácil añadir un elemento que se eche en falta que
 * descubrir uno peligroso que se coló.
 *
 * Cada trastero se vincula a un elemento por su `id` (floor_plan_shape_id).
 */

import { DOMParser, XMLSerializer, type Document, type Element } from "@xmldom/xmldom";
import { ErrorSelfStorage } from "../errors.ts";

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

export const TAMANO_MAXIMO_SVG = 2_000_000;

const ELEMENTOS = new Set([
  "svg", "g", "defs", "symbol", "use", "title", "desc",
  "rect", "path", "polygon", "polyline", "circle", "ellipse", "line",
  "text", "tspan", "textPath",
  "clipPath", "mask", "pattern", "linearGradient", "radialGradient", "stop",
  "image", "style", "marker",
]);

/** Elementos que pueden representar un trastero en el plano. */
const FORMAS = new Set(["rect", "path", "polygon", "polyline", "circle", "ellipse", "g", "use"]);

const ATRIBUTOS = new Set([
  "id", "class", "style", "transform", "viewBox", "preserveAspectRatio", "version",
  "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "width", "height",
  "d", "points", "pathLength",
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap",
  "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "stroke-miterlimit", "opacity",
  "clip-path", "clip-rule", "mask", "visibility", "display", "vector-effect",
  "font-family", "font-size", "font-weight", "font-style", "text-anchor", "dominant-baseline",
  "alignment-baseline", "letter-spacing", "dx", "dy", "rotate", "textLength", "lengthAdjust",
  "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform", "fx", "fy", "spreadMethod",
  "patternUnits", "patternContentUnits", "patternTransform", "clipPathUnits", "maskUnits", "maskContentUnits",
  "markerWidth", "markerHeight", "refX", "refY", "orient", "markerUnits",
  "marker-start", "marker-mid", "marker-end",
  "href", "xlink:href", "xml:space", "xmlns", "xmlns:xlink",
]);

/** `url(#algo)` vale; `url(http…)`, `url(data…)` o `@import` no. */
function cssSeguro(css: string): boolean {
  const c = css.toLowerCase();
  if (/@import|expression\s*\(|behavior\s*:|javascript:|-moz-binding/.test(c)) return false;
  const urls = c.match(/url\s*\(([^)]*)\)/g) ?? [];
  return urls.every((u) => /url\s*\(\s*['"]?#/.test(u));
}

function hrefSeguro(elemento: string, valor: string): boolean {
  const v = valor.trim();
  if (v.startsWith("#")) return true;
  // Un plano escaneado de fondo: sólo imagen rasterizada incrustada.
  return elemento === "image" && /^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(v);
}

export type PlanoSaneado = {
  svg: string;
  shapeIds: string[];
  /** Lo que se ha quitado, para enseñarlo a quien sube el plano. */
  eliminados: string[];
  avisos: string[];
};

export function sanearSvg(texto: string): PlanoSaneado {
  if (!texto || !texto.trim()) throw new ErrorSelfStorage("SVG_VACIO", "El fichero del plano está vacío.", 422);
  if (texto.length > TAMANO_MAXIMO_SVG) {
    throw new ErrorSelfStorage("SVG_DEMASIADO_GRANDE", "El plano supera los 2 MB. Simplifícalo o quita la imagen de fondo.", 413);
  }
  // Una DTD puede declarar entidades (billion laughs, XXE). Un plano no la necesita.
  if (/<!DOCTYPE|<!ENTITY/i.test(texto)) {
    throw new ErrorSelfStorage("SVG_NO_VALIDO", "El plano no puede llevar DOCTYPE ni entidades. Expórtalo como «SVG simple».", 422);
  }

  let doc: Document;
  try {
    const errores: string[] = [];
    doc = new DOMParser({
      onError: (nivel, msg) => {
        if (nivel !== "warning") errores.push(msg);
      },
    }).parseFromString(texto, "image/svg+xml");
    if (errores.length) throw new Error(errores[0]);
  } catch (e) {
    throw new ErrorSelfStorage("SVG_NO_VALIDO", "El fichero no es un SVG válido.", 422, { error: e instanceof Error ? e.message : String(e) });
  }

  const raiz = doc.documentElement;
  if (!raiz || raiz.localName !== "svg") {
    throw new ErrorSelfStorage("SVG_NO_VALIDO", "El fichero no es un SVG (la raíz no es <svg>).", 422);
  }

  const eliminados = new Set<string>();
  const avisos: string[] = [];
  const ids: string[] = [];
  const idsVistos = new Set<string>();

  const limpiar = (el: Element) => {
    // Los ids en orden de documento (el padre antes que sus hijos).
    const id = el.getAttribute("id");
    if (id && FORMAS.has(el.localName)) {
      if (idsVistos.has(id)) avisos.push(`El id «${id}» está repetido en el plano: sólo se podrá vincular el primero.`);
      else {
        idsVistos.add(id);
        ids.push(id);
      }
    }

    // Hijos primero: copiamos la lista porque se modifica al quitar.
    for (const hijo of Array.from(el.childNodes)) {
      const tipo = hijo.nodeType;
      if (tipo === 1) {
        const h = hijo as Element;
        const nombre = h.localName;
        const ns = h.namespaceURI;
        if ((ns && ns !== SVG_NS) || !ELEMENTOS.has(nombre)) {
          eliminados.add(`<${h.nodeName}>`);
          el.removeChild(h);
          continue;
        }
        if (nombre === "style" && !cssSeguro(h.textContent ?? "")) {
          eliminados.add("<style> con referencias externas");
          el.removeChild(h);
          continue;
        }
        limpiar(h);
      } else if (tipo === 7 || tipo === 8 || tipo === 4) {
        // instrucciones de proceso, comentarios y CDATA fuera de <style>
        if (!(tipo === 4 && el.localName === "style")) el.removeChild(hijo);
      }
    }

    for (const attr of Array.from(el.attributes)) {
      const nombre = attr.name;
      const valor = attr.value;
      const local = attr.localName ?? nombre;
      let quitar: boolean;
      if (/^on/i.test(local)) quitar = true;
      else if (nombre === "href" || nombre === "xlink:href" || (attr.namespaceURI === XLINK_NS && local === "href")) quitar = !hrefSeguro(el.localName, valor);
      else if (nombre.startsWith("data-")) quitar = /javascript:/i.test(valor);
      else if (!ATRIBUTOS.has(nombre)) quitar = true;
      else if (nombre === "style") quitar = !cssSeguro(valor);
      else quitar = /javascript:|url\s*\(\s*['"]?(?!#)/i.test(valor);
      if (quitar) {
        if (!nombre.includes(":") || nombre.startsWith("xlink")) eliminados.add(`@${nombre}`);
        el.removeAttribute(nombre);
      }
    }

  };

  limpiar(raiz);

  if (!raiz.getAttribute("viewBox")) {
    const w = parseFloat(raiz.getAttribute("width") ?? "");
    const h = parseFloat(raiz.getAttribute("height") ?? "");
    if (w > 0 && h > 0) raiz.setAttribute("viewBox", `0 0 ${w} ${h}`);
    else avisos.push("El plano no tiene viewBox: puede que no escale bien en pantallas pequeñas.");
  }
  if (ids.length === 0) avisos.push("El plano no tiene formas con id: no se podrá vincular ningún trastero.");

  const svg = new XMLSerializer().serializeToString(raiz);
  return { svg, shapeIds: ids, eliminados: [...eliminados], avisos };
}
