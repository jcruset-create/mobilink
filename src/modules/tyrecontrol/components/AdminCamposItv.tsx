import { useEffect, useMemo, useState } from "react";
import { listarCamposItv, actualizarCampoItv, crearCampoItv, campoItvEnUso, type CampoItv } from "../services/data";
import type { TipoDatoItv } from "../services/itvValores";
import { Modal, inputCls } from "./ui";

const TIPOS: TipoDatoItv[] = ["text", "integer", "decimal", "date", "boolean", "json", "text_array", "decimal_array"];

const CATEGORIAS = [
  "documento", "identificacion", "titular", "masas", "dimensiones",
  "homologacion", "ejes", "remolque", "motor", "plazas", "emisiones",
];

const VACIO: Omit<CampoItv, "id"> = {
  codigo: "", clave: "", descripcion: "", categoria: "identificacion",
  orden_seccion: 0, orden: 0, tipo_dato: "text", unidad: null,
  es_multiple: false, ayuda: null, activo: true,
};

/** Mantenimiento de la tabla maestra de códigos de ficha técnica ITV. */
export default function AdminCamposItv({ puedeEditar }: { puedeEditar: boolean }) {
  const [campos, setCampos] = useState<CampoItv[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [edicion, setEdicion] = useState<null | (Partial<CampoItv> & { esNuevo?: boolean })>(null);
  const [enUso, setEnUso] = useState<number | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    setCargando(true); setError("");
    try { setCampos(await listarCamposItv(false)); }
    catch (e: any) { setError(e?.message ?? "No se pudo cargar el catálogo"); }
    finally { setCargando(false); }
  }
  useEffect(() => { if (abierto && campos.length === 0) void cargar(); /* eslint-disable-next-line */ }, [abierto]);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return campos;
    return campos.filter((c) =>
      (c.codigo ?? "").toLowerCase().includes(q) ||
      c.descripcion.toLowerCase().includes(q) ||
      c.clave.toLowerCase().includes(q));
  }, [campos, busqueda]);

  async function abrirEdicion(c: CampoItv) {
    setEdicion({ ...c });
    setEnUso(null);
    try { setEnUso(await campoItvEnUso(c.id)); } catch { setEnUso(null); }
  }

  async function guardar() {
    if (!edicion) return;
    if (!edicion.descripcion?.trim()) { setError("La descripción es obligatoria"); return; }
    setGuardando(true); setError("");
    try {
      if (edicion.esNuevo) {
        if (!edicion.clave?.trim()) { setError("La clave es obligatoria"); setGuardando(false); return; }
        await crearCampoItv({ ...VACIO, ...edicion, clave: edicion.clave.trim() } as Omit<CampoItv, "id">);
      } else {
        await actualizarCampoItv(edicion.id!, edicion);
      }
      setEdicion(null);
      await cargar();
    } catch (e: any) { setError(e?.message ?? "No se pudo guardar"); }
    finally { setGuardando(false); }
  }

  return (
    <div className="rounded-lg bg-slate-800 p-3">
      <button onClick={() => setAbierto(!abierto)} className="flex w-full items-center gap-2 text-left">
        <span className="text-[11px] text-slate-400">{abierto ? "▾" : "▸"}</span>
        <span className="flex-1 text-[11px] font-bold uppercase text-slate-400">Campos de ficha técnica ITV</span>
        <span className="text-[11px] text-slate-500">{campos.length || ""}</span>
      </button>

      {abierto && (
        <div className="mt-3">
          <div className="mb-2 text-[11px] text-slate-500">
            Todos los códigos que puede traer una ficha técnica. Aquí están siempre, aunque ningún vehículo
            tenga dato para ellos: en la ficha del vehículo solo se ven los que sí lo tienen.
          </div>

          <div className="mb-2 flex flex-wrap items-center gap-2">
            <input className={`${inputCls} max-w-xs text-[12px]`} placeholder="Buscar por código o descripción…"
              value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
            {puedeEditar && (
              <button onClick={() => { setEdicion({ ...VACIO, esNuevo: true }); setEnUso(0); }}
                className="rounded-lg bg-sky-600 px-3 py-1.5 text-[12px] font-bold text-white">+ Nuevo código</button>
            )}
            <span className="text-[11px] text-slate-500">{filtrados.length} de {campos.length}</span>
          </div>

          {error && <div className="mb-2 text-[12px] text-rose-300">{error}</div>}

          {cargando ? (
            <div className="text-[12px] text-slate-500">Cargando catálogo…</div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-slate-800 text-left text-slate-400">
                  <tr>
                    <th className="py-1">Código</th><th className="py-1">Descripción</th>
                    <th className="py-1">Bloque</th><th className="py-1">Tipo</th>
                    <th className="py-1">Unidad</th><th className="py-1">Orden</th>
                    <th className="py-1">Estado</th>{puedeEditar && <th className="py-1" />}
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((c) => (
                    <tr key={c.id} className={`border-t border-slate-700/60 ${c.activo ? "" : "opacity-50"}`}>
                      <td className="py-1 pr-2 font-mono font-bold text-sky-300">{c.codigo ?? "—"}</td>
                      <td className="py-1 pr-2 text-slate-200">
                        {c.descripcion}
                        {c.es_multiple && <span className="ml-1 rounded bg-slate-700 px-1 text-[10px] text-slate-300">múltiple</span>}
                      </td>
                      <td className="py-1 pr-2 text-slate-400">{c.categoria ?? "—"}</td>
                      <td className="py-1 pr-2 text-slate-500">{c.tipo_dato}</td>
                      <td className="py-1 pr-2 text-slate-500">{c.unidad ?? "—"}</td>
                      <td className="py-1 pr-2 text-slate-500">{c.orden_seccion}.{c.orden}</td>
                      <td className="py-1 pr-2">
                        {c.activo ? <span className="text-emerald-300">Activo</span> : <span className="text-slate-500">Inactivo</span>}
                      </td>
                      {puedeEditar && (
                        <td className="py-1 text-right">
                          <button onClick={() => void abrirEdicion(c)} className="text-sky-300 hover:underline">Editar</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {edicion && (
        <Modal title={edicion.esNuevo ? "Nuevo código de ficha técnica" : `Editar ${edicion.codigo ?? ""}`}
          onClose={() => setEdicion(null)}
          footer={<>
            <button onClick={() => setEdicion(null)} className="rounded border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
            <button onClick={() => void guardar()} disabled={guardando}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              {guardando ? "Guardando…" : "Guardar"}
            </button>
          </>}>
          <div className="grid gap-2">
            {enUso != null && enUso > 0 && (
              <div className="rounded bg-amber-900/30 p-2 text-[11px] text-amber-200">
                Este código lo usan {enUso} vehículo(s). No se puede eliminar; si ya no sirve, desactívalo:
                deja de verse y de extraerse, pero los datos existentes se conservan.
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] text-slate-400">Código
                <input className={inputCls} value={edicion.codigo ?? ""}
                  onChange={(e) => setEdicion({ ...edicion, codigo: e.target.value })} />
              </label>
              <label className="text-[11px] text-slate-400">Clave interna
                <input className={inputCls} value={edicion.clave ?? ""} disabled={!edicion.esNuevo}
                  onChange={(e) => setEdicion({ ...edicion, clave: e.target.value })} />
              </label>
            </div>
            <label className="text-[11px] text-slate-400">Descripción
              <input className={inputCls} value={edicion.descripcion ?? ""}
                onChange={(e) => setEdicion({ ...edicion, descripcion: e.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] text-slate-400">Bloque
                <select className={inputCls} value={edicion.categoria ?? ""}
                  onChange={(e) => setEdicion({ ...edicion, categoria: e.target.value })}>
                  {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="text-[11px] text-slate-400">Tipo de dato
                <select className={inputCls} value={edicion.tipo_dato ?? "text"}
                  onChange={(e) => setEdicion({ ...edicion, tipo_dato: e.target.value as TipoDatoItv })}>
                  {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className="text-[11px] text-slate-400">Unidad
                <input className={inputCls} value={edicion.unidad ?? ""}
                  onChange={(e) => setEdicion({ ...edicion, unidad: e.target.value || null })} />
              </label>
              <label className="text-[11px] text-slate-400">Orden (bloque . campo)
                <div className="flex gap-1">
                  <input type="number" className={inputCls} value={edicion.orden_seccion ?? 0}
                    onChange={(e) => setEdicion({ ...edicion, orden_seccion: Number(e.target.value) })} />
                  <input type="number" className={inputCls} value={edicion.orden ?? 0}
                    onChange={(e) => setEdicion({ ...edicion, orden: Number(e.target.value) })} />
                </div>
              </label>
            </div>
            <label className="text-[11px] text-slate-400">Ayuda interna
              <input className={inputCls} value={edicion.ayuda ?? ""}
                onChange={(e) => setEdicion({ ...edicion, ayuda: e.target.value || null })} />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input type="checkbox" checked={!!edicion.es_multiple}
                onChange={(e) => setEdicion({ ...edicion, es_multiple: e.target.checked })} />
              Campo múltiple (varios valores, p. ej. masas por eje)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input type="checkbox" checked={edicion.activo !== false}
                onChange={(e) => setEdicion({ ...edicion, activo: e.target.checked })} />
              Activo (si se desmarca deja de extraerse y de mostrarse)
            </label>
          </div>
        </Modal>
      )}
    </div>
  );
}
