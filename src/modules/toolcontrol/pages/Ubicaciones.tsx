import { useEffect, useState } from "react";
import ToolControlMenu from "../components/ToolControlMenu";
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
    <div className="p-6 space-y-4">
      <ToolControlMenu />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Ubicaciones</h1>
        <button onClick={() => abrir()} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
          + Nueva ubicación
        </button>
      </div>
      {mensaje && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{mensaje}</p>}

      {cargando ? (
        <div className="py-10 text-center text-gray-400">Cargando...</div>
      ) : (
        <div className="overflow-auto rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="p-3">Nombre</th>
                <th className="p-3">Código</th>
                <th className="p-3">Descripción</th>
                <th className="p-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id} className="border-t hover:bg-gray-50">
                  <td className="p-3 font-medium">{u.nombre}</td>
                  <td className="p-3 font-mono text-gray-500">{u.codigo ?? "—"}</td>
                  <td className="p-3 text-gray-500">{u.descripcion ?? "—"}</td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <button onClick={() => abrir(u)} className="rounded-lg bg-gray-100 px-2 py-1 text-xs hover:bg-gray-200">Editar</button>
                      <button onClick={() => desactivar(u.id)} className="rounded-lg bg-red-50 px-2 py-1 text-xs text-red-600 hover:bg-red-100">Eliminar</button>
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={4} className="p-8 text-center text-gray-400">Sin ubicaciones creadas.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-4">{editId ? "Editar ubicación" : "Nueva ubicación"}</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Nombre *</label>
                <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" placeholder="Taller 1 — Banco herramientas" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Código</label>
                <input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" placeholder="T1-BH" />
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
