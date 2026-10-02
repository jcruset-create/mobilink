/**
 * Plano interactivo (SVG).
 *
 * El SVG llega YA SANEADO del servidor (lista blanca de elementos y atributos).
 * Aun así no se inyecta como HTML: se interpreta con `DOMParser` como
 * `image/svg+xml` —que no ejecuta nada— y se inserta el nodo.
 *
 * El color de cada forma sale del estado REAL del trastero en la base, con el
 * mapa único `COLOR_PLANO`; lo que el SVG traiga pintado se sobreescribe.
 *
 * Es el mismo componente para el panel y para la web pública (fase 4): lo que
 * cambia son los datos que recibe, y eso lo decide la API.
 */

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { COLOR_PLANO, type UnitStatus } from "../types";

export type FormaPlano = { shapeId: string; status: UnitStatus; etiqueta: string };

type Props = {
  svg: string;
  formas: FormaPlano[];
  /** Formas sin trastero: se dibujan con borde discontinuo para poder vincularlas. */
  sinVincular?: string[];
  seleccionada?: string | null;
  onSeleccionar?: (shapeId: string) => void;
};

const SELECTOR_FORMAS = "rect, path, polygon, polyline, circle, ellipse";

function pintar(el: Element, fill: string, stroke: string, ancho: string, discontinuo = false) {
  const destinos = el.tagName.toLowerCase() === "g" ? Array.from(el.querySelectorAll(SELECTOR_FORMAS)) : [el];
  for (const d of destinos) {
    const s = (d as SVGElement).style;
    s.fill = fill;
    s.stroke = stroke;
    s.strokeWidth = ancho;
    s.strokeDasharray = discontinuo ? "4 3" : "";
    s.cursor = "pointer";
  }
}

const buscar = (raiz: Element, id: string) => raiz.querySelector(`[id="${CSS.escape(id)}"]`);

export default function FloorPlan({ svg, formas, sinVincular = [], seleccionada, onSeleccionar }: Props) {
  const contenedor = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const ids = useMemo(() => new Set([...formas.map((f) => f.shapeId), ...sinVincular]), [formas, sinVincular]);

  // Montar el SVG cuando cambia.
  useEffect(() => {
    const div = contenedor.current;
    if (!div) return;
    div.replaceChildren();
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    if (doc.querySelector("parsererror") || doc.documentElement.tagName.toLowerCase() !== "svg") {
      setError("No se ha podido leer el plano.");
      return;
    }
    setError(null);
    const raiz = document.importNode(doc.documentElement, true) as unknown as SVGSVGElement;
    raiz.removeAttribute("width");
    raiz.removeAttribute("height");
    raiz.style.width = "100%";
    raiz.style.height = "auto";
    raiz.style.display = "block";
    // Los rótulos («2-014») suelen ir ENCIMA del box: sin esto, pulsar sobre el
    // número no seleccionaría el trastero, porque el clic se lo queda el texto.
    for (const t of Array.from(raiz.querySelectorAll("text"))) (t as SVGElement).style.pointerEvents = "none";
    div.appendChild(raiz);
  }, [svg]);

  // Colores y selección, cada vez que cambian los estados.
  useEffect(() => {
    const raiz = contenedor.current?.firstElementChild;
    if (!raiz) return;
    for (const f of formas) {
      const el = buscar(raiz, f.shapeId);
      if (!el) continue;
      const c = COLOR_PLANO[f.status];
      pintar(el, c.fill, f.shapeId === seleccionada ? "#ffffff" : c.stroke, f.shapeId === seleccionada ? "3" : "1");
      el.setAttribute("aria-label", f.etiqueta);
      el.setAttribute("role", "button");
    }
    for (const id of sinVincular) {
      const el = buscar(raiz, id);
      if (el) pintar(el, "rgba(148,163,184,0.15)", id === seleccionada ? "#ffffff" : "#94a3b8", id === seleccionada ? "3" : "1", true);
    }
  }, [formas, sinVincular, seleccionada, svg]);

  const alPulsar = (e: MouseEvent) => {
    if (!onSeleccionar) return;
    let el = e.target as Element | null;
    const raiz = contenedor.current;
    while (el && el !== raiz) {
      const id = el.getAttribute("id");
      if (id && ids.has(id)) {
        onSeleccionar(id);
        return;
      }
      el = el.parentElement;
    }
  };

  if (error) return <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>;

  return (
    <div className="relative rounded-xl border border-slate-700 bg-slate-950">
      <div className="absolute right-2 top-2 z-10 flex gap-1">
        <button className="rounded-lg bg-slate-800/90 p-1.5 hover:bg-slate-700" onClick={() => setZoom((z) => Math.min(4, z + 0.5))} aria-label="Acercar">
          <Plus className="h-4 w-4" />
        </button>
        <button className="rounded-lg bg-slate-800/90 p-1.5 hover:bg-slate-700" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} aria-label="Alejar">
          <Minus className="h-4 w-4" />
        </button>
        <button className="rounded-lg bg-slate-800/90 p-1.5 hover:bg-slate-700" onClick={() => setZoom(1)} aria-label="Tamaño original">
          <RotateCcw className="h-4 w-4" />
        </button>
      </div>
      <div className="max-h-[70vh] overflow-auto">
        <div ref={contenedor} onClick={alPulsar} style={{ width: `${zoom * 100}%` }} className="p-2" />
      </div>
    </div>
  );
}
