import { useState } from "react";
import type { OpcionSelector } from "../catalogo/usos";

/**
 * Un desplegable con un botón para añadir lo que falta.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 *
 * El alta de una referencia de catálogo se hacía con seis casillas de texto
 * libre, y el catálogo lo enseña: «Continental», «continental» y «CONTINENTAL»
 * acabaron siendo tres marcas, y el tipo de uso llegó a tener cuarenta
 * variantes para decir cinco cosas. Un desplegable lo corta de raíz, pero uno
 * sin salida sería peor: el técnico que tiene delante una goma que no está en
 * la lista no puede quedarse parado.
 *
 * De ahí este componente: se elige de la lista, y si no está, se crea con un
 * botón y queda elegida. Lo usan los cinco campos del alta —marca, modelo,
 * medida, índices y velocidad— porque los cinco tienen exactamente el mismo
 * problema y la misma salida.
 */
export type { OpcionSelector } from "../catalogo/usos";

export function SelectorConAlta({
  label, opciones, valor, onChange, onCrear, placeholder, deshabilitado, ayuda,
}: {
  label: string;
  opciones: OpcionSelector[];
  valor: string;
  onChange: (v: string) => void;
  /** Crea el valor nuevo y devuelve el que hay que dejar seleccionado. */
  onCrear?: (nombre: string) => Promise<string>;
  placeholder?: string;
  deshabilitado?: boolean;
  ayuda?: string;
}) {
  const [creando, setCreando] = useState(false);
  const [nombre, setNombre] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function crear() {
    if (!nombre.trim() || !onCrear) return;
    setGuardando(true); setError("");
    try {
      onChange(await onCrear(nombre));
      setCreando(false); setNombre("");
    } catch (e: any) {
      setError(e?.message || "No se ha podido crear");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">{label}</span>

      {creando ? (
        <div className="flex gap-1">
          <input
            autoFocus
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); void crear(); }
              if (e.key === "Escape") { setCreando(false); setError(""); }
            }}
            placeholder={placeholder}
            className="w-full rounded-lg border border-emerald-600 bg-slate-900 px-2 py-2 text-sm text-slate-100 outline-none"
          />
          <button
            type="button"
            onClick={() => void crear()}
            disabled={guardando || !nombre.trim()}
            className="shrink-0 rounded-lg bg-emerald-600 px-2 py-2 text-xs font-bold text-white disabled:opacity-40"
          >
            {guardando ? "…" : "✓"}
          </button>
          <button
            type="button"
            onClick={() => { setCreando(false); setError(""); }}
            className="shrink-0 rounded-lg border border-slate-600 px-2 py-2 text-xs text-slate-300"
          >
            ✕
          </button>
        </div>
      ) : (
        <div className="flex gap-1">
          <select
            value={valor}
            disabled={deshabilitado}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-lg border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50"
          >
            <option value="">{deshabilitado ? "—" : "Elige…"}</option>
            {opciones.map((o) => (
              <option key={o.valor} value={o.valor}>{o.etiqueta}</option>
            ))}
          </select>
          {onCrear && (
            <button
              type="button"
              title={`Añadir ${label.toLowerCase()}`}
              onClick={() => setCreando(true)}
              disabled={deshabilitado}
              className="shrink-0 rounded-lg border border-emerald-600 px-2 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-600/10 disabled:opacity-40"
            >
              ＋
            </button>
          )}
        </div>
      )}

      {error && <span className="mt-1 block text-[11px] text-rose-300">{error}</span>}
      {!error && ayuda && <span className="mt-1 block text-[11px] text-slate-500">{ayuda}</span>}
    </label>
  );
}

export default SelectorConAlta;
