import { useEffect, useState } from "react";
import ToolControlMenu from "../components/ToolControlMenu";
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
    <div className="p-6 space-y-4">
      <ToolControlMenu />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Categorías de herramientas</h1>
        <button onClick={() => abrir()} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
          + Nueva categoría
        </button>
      </div>
      {mensaje && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{mensaje}</p>}

      {cargando ? (
        <div className="py-10 text-center text-gray-400">Cargando...</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {items.map((c) => (
            <div key={c.id} className="rounded-xl border bg-white p-4 flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold">{c.nombre}</div>
                {c.descripcion && <p className="text-xs text-gray-500 mt-1">{c.descripcion}</p>}
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => abrir(c)} className="rounded-lg bg-gray-100 px-2 py-1 text-xs hover:bg-gray-200">Editar</button>
                <button onClick={() => desactivar(c.id)} className="rounded-lg bg-red-50 px-2 py-1 text-xs text-red-600 hover:bg-red-100">✕</button>
              </div>
            </div>
          ))}
          {items.length === 0 && (
            <p className="text-sm text-gray-400 col-span-3">Sin categorías creadas.</p>
          )}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-4">{editId ? "Editar categoría" : "Nueva categoría"}</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Nombre *</label>
                <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" placeholder="Herramientas de corte" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Descripción</label>
                <textarea value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" rows={2} />
              </div>
            </div>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <div className="mt-5 flex gap-2 justify-end">
              <button onClick={() => setModal(false)} className="rounded-xl border px-4 py-2 text-sm font-semibold">Cancelar</button>
              <button onClick={guardar} disabled={guardando} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {guardando ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
