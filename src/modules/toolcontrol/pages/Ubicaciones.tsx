import { useEffect, useState } from "react";
import ToolControlLayout from "../components/ToolControlLayout";
import { supabase } from "../services/supabase";

type Ubicacion = { id: string; nombre: string; descripcion: string | null; codigo: string | null; activa: boolean };

export default function Ubicaciones() {
  const [items, setItems] = useState<Ubicacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ nombre: "", descripcion: "", codigo: "" });
  const [editId, setEditId] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  useEffect(() => { cargar(); }, []);

  async function cargar() {
    setCargando(true);
    const { data } = await supabase.from("tc_locations").select("*").eq("activa", true).order("nombre");
    setItems(data ?? []);
    setCargando(false);
  }

  function abrir(u?: Ubicacion) {
    if (u) {
      setForm({ nombre: u.nombre, descripcion: u.descripcion ?? "", codigo: u.codigo ?? "" });
      setEditId(u.id);
    } else {
      setForm({ nombre: "", descripcion: "", codigo: "" });
      setEditId(null);
    }
    setError("");
    setModal(true);
  }

  async function guardar() {
    if (!form.nombre.trim()) { setError("El nombre es obligatorio."); return; }
    setGuardando(true);
    const payload = { nombre: form.nombre.trim(), descripcion: form.descripcion || null, codigo: form.codigo || null };
    const { error: err } = editId
      ? await supabase.from("tc_locations").update(payload).eq("id", editId)
      : await supabase.from("tc_locations").insert(payload);
    setGuardando(false);
    if (err) { setError(err.message); return; }
    setMensaje(editId ? "Ubicación actualizada." : "Ubicación creada.");
    setModal(false);
    setTimeout(() => setMensaje(""), 3000);
    cargar();
  }

  async function desactivar(id: string) {
    if (!confirm("¿Desactivar esta ubicación?")) return;
    await supabase.from("tc_locations").update({ activa: false }).eq("id", id);
    cargar();
  }

  return (
    <ToolControlLayout
      title="Ubicaciones"
      actions={
        <button
          onClick={() => abrir()}
          className="rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-bold text-amber-950 hover:bg-amber-400"
        >
          + Nueva ubicación
        </button>
      }
    >
      {mensaje && <p className="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">{mensaje}</p>}

      {cargando ? (
        <div className="py-10 text-center text-slate-500">Cargando...</div>
      ) : (
        <div className="overflow-auto rounded-xl border border-slate-800 bg-slate-800/60">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-left text-slate-400">
              <tr>
                <th className="p-3">Nombre</th>
                <th className="p-3">Código</th>
                <th className="p-3">Descripción</th>
                <th className="p-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id} className="border-t border-slate-800 hover:bg-slate-800/50">
                  <td className="p-3 font-medium text-slate-100">{u.nombre}</td>
                  <td className="p-3 font-mono text-slate-400">{u.codigo ?? "—"}</td>
                  <td className="p-3 text-slate-400">{u.descripcion ?? "—"}</td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <button onClick={() => abrir(u)} className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700">Editar</button>
                      <button onClick={() => desactivar(u.id)} className="rounded-lg bg-red-500/15 px-2 py-1 text-xs text-red-300 hover:bg-red-500/25">Eliminar</button>
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={4} className="p-8 text-center text-slate-500">Sin ubicaciones creadas.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold text-slate-100">{editId ? "Editar ubicación" : "Nueva ubicación"}</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-400">Nombre *</label>
                <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500" placeholder="Taller 1 — Banco herramientas" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400">Código</label>
                <input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500" placeholder="T1-BH" />
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
