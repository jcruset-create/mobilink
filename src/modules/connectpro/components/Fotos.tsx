/**
 * Connect Pro — galería de fotos de una ficha (taller o furgoneta).
 *
 * Se comparte porque la necesidad es la misma en los dos sitios: ver de un
 * vistazo lo que hay, añadir una foto y quitar la que ya no vale. Lo único
 * que cambia es de dónde cuelgan y si llevan categoría.
 *
 * Las fotos se muestran a tamaño pequeño y se abren en pestaña aparte al
 * pulsarlas: la del acceso a un taller hay que poder mirarla de cerca, y
 * meterla grande en la ficha dejaría la pantalla inservible.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { boFetch, boSubir } from "../services/api";
import { Card, Button } from "./ui";
import { fmtDateTime } from "../types";

export type Foto = {
  id: number; url: string; category?: string; fileName: string | null;
  caption: string | null; uploadedBy: string | null; createdAtMs: number;
};

export default function Fotos({ endpoint, borrarBase, canEdit, categorias, titulo, ayuda }: {
  /** De dónde leer y dónde subir: "/workshops/3/photos". */
  endpoint: string;
  /** Ruta de borrado, sin el id: "/workshops/photos". */
  borrarBase: string;
  canEdit: boolean;
  /** Categorías con su etiqueta, si esta ficha las usa. */
  categorias?: [string, string][];
  titulo: string;
  ayuda?: string;
}) {
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [categoria, setCategoria] = useState(categorias?.[0]?.[0] ?? "otros");
  const input = useRef<HTMLInputElement>(null);

  const cargar = useCallback(() => {
    boFetch<{ data: Foto[] }>(endpoint).then((r) => setFotos(r.data)).catch((e) => setError(e.message));
  }, [endpoint]);
  useEffect(cargar, [cargar]);

  const subir = async (files: FileList | null) => {
    if (!files?.length) return;
    setSubiendo(true); setError(null);
    try {
      for (const file of Array.from(files)) {
        await boSubir(endpoint, file, categorias ? { category: categoria } : undefined);
      }
      cargar();
    } catch (e: any) { setError(e.message); } finally {
      setSubiendo(false);
      if (input.current) input.current.value = "";
    }
  };

  const borrar = async (id: number) => {
    setError(null);
    try { await boFetch(`${borrarBase}/${id}`, { method: "DELETE" }); cargar(); }
    catch (e: any) { setError(e.message); }
  };

  const grupos: [string, Foto[]][] = categorias
    ? categorias.map(([code, label]) => [label, fotos.filter((f) => f.category === code)])
    : [["", fotos]];

  return (
    <Card className="p-4">
      <h3 className="mb-1 text-sm font-semibold text-cyan-300">{titulo}</h3>
      {ayuda && <p className="mb-3 text-[12px] text-slate-500">{ayuda}</p>}
      {error && <p className="mb-2 text-[12px] text-red-300">{error}</p>}

      {fotos.length === 0 && <p className="mb-3 text-[13px] text-slate-500">Todavía no hay fotos.</p>}

      {grupos.map(([label, lista]) => (
        lista.length === 0 ? null : (
          <div key={label} className="mb-3">
            {label && <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">{label}</div>}
            <div className="flex flex-wrap gap-2">
              {lista.map((f) => (
                <div key={f.id} className="relative">
                  <a href={f.url} target="_blank" rel="noreferrer" title={
                    [f.caption, f.uploadedBy, fmtDateTime(f.createdAtMs)].filter(Boolean).join(" · ")
                  }>
                    <img src={f.url} alt={f.caption ?? f.fileName ?? "foto"}
                         className="h-28 w-40 rounded-lg border border-slate-700 object-cover hover:border-cyan-500" />
                  </a>
                  {canEdit && (
                    <button
                      onClick={() => borrar(f.id)}
                      title="Quitar esta foto"
                      className="absolute -right-1 -top-1 rounded-full border border-slate-600 bg-slate-900 px-1.5 text-[11px] text-red-400 hover:bg-slate-800"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      ))}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          {categorias && (
            <select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-[13px] text-slate-100"
            >
              {categorias.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
          )}
          <label className="cursor-pointer rounded-lg border border-slate-600 px-3 py-2 text-[13px] text-slate-300 hover:bg-slate-700">
            {subiendo ? "Subiendo…" : "Añadir fotos"}
            <input ref={input} type="file" accept="image/*" multiple className="hidden"
                   disabled={subiendo} onChange={(e) => subir(e.target.files)} />
          </label>
          {fotos.length > 0 && (
            <Button variant="ghost" onClick={cargar}>Actualizar</Button>
          )}
        </div>
      )}
    </Card>
  );
}
