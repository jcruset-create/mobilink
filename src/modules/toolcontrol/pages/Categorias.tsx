import { useEffect, useState } from "react";
import ToolControlLayout from "../components/ToolControlLayout";
import { supabase } from "../services/supabase";

type Categoria = { id: string; nombre: string; descripcion: string | null; activa: boolean };

export default function Categorias() {
  const [items, setItems] = useState<Categoria[]>([]);
  const [cargando, setCargando] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ nombre: "", descripcion: "" });
  const [editId, setEditId] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  useEffect(() => { cargar(); }, []);

  async function cargar() {
    setCargando(true);
    const { data } = await supabase.from("tc_categories").select("*").eq("activa", true).order("nombre");
    setItems(data ?? []);
    setCargando(false);
  }

  function abrir(c?: Categoria) {
    if (c) {
      setForm({ nombre: c.nombre, descripcion: c.descripcion ?? "" });
      setEditId(c.id);
    } else {
      setForm({ nombre: "", descripcion: "" });
      setEditId(null);
    }
    setError("");
    setModal(true);
  }

  async function guardar() {
    if (!form.nombre.trim()) { setError("El nombre es obligatorio."); return; }
    setGuardando(true);
    const payload = { nombre: form.nombre.trim(), descripcion: form.descripcion || null };
    const { error: err } = editId
      ? await supabase.from("tc_categories").update(payload).eq("id", editId)
      : await supabase.from("tc_categories").insert(payload);
    setGuardando(false);
    if (err) { setError(err.message); return; }
    setMensaje(editId ? "Categoría actualizada." : "Categoría creada.");
    setModal(false);
    setTimeout(() => setMensaje(""), 3000);
    cargar();
  }

  async function desactivar(id: string) {
    if (!confirm("¿Eliminar esta categoría?")) return;
    await supabase.from("tc_categories").update({ activa: false }).eq("id", id);
    cargar();
  }

  return (
    <ToolControlLayout
      title="Categorías de herramientas"
      actions={
        <button
          onClick={() => abrir()}
          className="rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-bold text-amber-950 hover:bg-amber-400"
        >
          + Nueva categoría
        </button>
      }
    >
      {mensaje && <p className="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">{mensaje}</p>}

      {cargando ? (
        <div className="py-10 text-center text-slate-500">Cargando...</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {items.map((c) => (
            <div key={c.id} className="flex items-start justify-between gap-2 rounded-xl border border-slate-800 bg-slate-800/60 p-4">
              <div>
                <div className="font-semibold text-slate-100">{c.nombre}</div>
                {c.descripcion && <p className="mt-1 text-xs text-slate-400">{c.descripcion}</p>}
              </div>
              <div className="flex shrink-0 gap-1">
                <button onClick={() => abrir(c)} className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700">Editar</button>
                <button onClick={() => desactivar(c.id)} className="rounded-lg bg-red-500/15 px-2 py-1 text-xs text-red-300 hover:bg-red-500/25">✕</button>
              </div>
            </div>
          ))}
          {items.length === 0 && (
            <p className="col-span-3 text-sm text-slate-500">Sin categorías creadas.</p>
          )}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold text-slate-100">{editId ? "Editar categoría" : "Nueva categoría"}</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-400">Nombre *</label>
                <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500" placeholder="Herramientas de corte" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400">Descripción</label>
                <textarea value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100" rows={2} />
              </div>
            </div>
            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setModal(false)} className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700">Cancelar</button>
              <button onClick={guardar} disabled={guardando} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-400 disabled:opacity-50">
                {guardando ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ToolControlLayout>
  );
}
