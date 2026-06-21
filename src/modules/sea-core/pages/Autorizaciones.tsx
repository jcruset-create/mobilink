import { useEffect, useState } from "react";
import CoreMenu from "../components/CoreMenu";
import { supabase } from "../../almacen-neumaticos/services/supabase";

type Autorizacion = {
  id: string;
  nombre: string;
  descripcion: string | null;
  requiere_formacion: boolean;
  vigencia_meses: number | null;
  activa: boolean;
};

const EMPTY = { nombre: "", descripcion: "", requiere_formacion: false, vigencia_meses: "", activa: true };

export default function Autorizaciones() {
  const [items, setItems] = useState<Autorizacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro] = useState("");
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<any>({ ...EMPTY });
  const [editId, setEditId] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  useEffect(() => { cargar(); }, []);

  async function cargar() {
    setCargando(true);
    const { data } = await supabase.from("sea_authorizations").select("*").order("nombre");
    setItems(data ?? []);
    setCargando(false);
  }

  const filtrados = items.filter((a) => {
    const t = filtro.toLowerCase();
    return !t || [a.nombre, a.descripcion].join(" ").toLowerCase().includes(t);
  });

  function abrirNuevo() { setForm({ ...EMPTY }); setEditId(null); setError(""); setModal(true); }
  function abrirEditar(a: Autorizacion) {
    setForm({
      nombre: a.nombre, descripcion: a.descripcion ?? "",
      requiere_formacion: a.requiere_formacion,
      vigencia_meses: a.vigencia_meses ?? "", activa: a.activa,
    });
    setEditId(a.id); setError(""); setModal(true);
  }

  async function guardar() {
    if (!form.nombre?.trim()) { setError("El nombre es obligatorio."); return; }
    setGuardando(true);
    const payload = {
      nombre: form.nombre.trim(),
      descripcion: form.descripcion || null,
      requiere_formacion: form.requiere_formacion,
      vigencia_meses: form.vigencia_meses ? parseInt(form.vigencia_meses) : null,
      activa: form.activa,
    };
    const { error: err } = editId
      ? await supabase.from("sea_authorizations").update(payload).eq("id", editId)
      : await supabase.from("sea_authorizations").insert(payload);
    setGuardando(false);
    if (err) { setError(err.message); return; }
    setMensaje(editId ? "Autorización actualizada." : "Autorización creada.");
    setModal(false);
    setTimeout(() => setMensaje(""), 3000);
    cargar();
  }

  async function toggleActiva(a: Autorizacion) {
    await supabase.from("sea_authorizations").update({ activa: !a.activa }).eq("id", a.id);
    cargar();
  }

  return (
    <div className="p-6 space-y-4">
      <CoreMenu />

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Catálogo de autorizaciones</h1>
          <p className="text-sm text-gray-500">{filtrados.length} autorizaciones</p>
        </div>
        <button onClick={abrirNuevo}
          className="rounded-xl bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-900">
          + Nueva autorización
        </button>
      </div>

      {mensaje && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{mensaje}</p>}

      <input value={filtro} onChange={(e) => setFiltro(e.target.value)}
        placeholder="Buscar autorización..." className="rounded-lg border px-3 py-2 text-sm w-72" />

      {cargando ? <div className="py-10 text-center text-gray-400">Cargando...</div> : (
        <div className="rounded-xl border bg-white divide-y overflow-hidden">
          {filtrados.map((a) => (
            <div key={a.id} className="flex items-center gap-4 p-4 hover:bg-gray-50">
              <div className="flex-1 min-w-0">
                <div className={`font-medium ${!a.activa ? "text-gray-400 line-through" : ""}`}>{a.nombre}</div>
                {a.descripcion && <div className="text-sm text-gray-400 mt-0.5">{a.descripcion}</div>}
                <div className="flex flex-wrap gap-2 mt-1.5">
                  {a.vigencia_meses && (
                    <span className="rounded-full bg-blue-50 text-blue-700 px-2 py-0.5 text-xs font-medium">
                      Vigencia {a.vigencia_meses} meses
                    </span>
                  )}
                  {a.requiere_formacion && (
                    <span className="rounded-full bg-orange-50 text-orange-700 px-2 py-0.5 text-xs font-medium">
                      Requiere formación
                    </span>
                  )}
                  {!a.activa && (
                    <span className="rounded-full bg-red-50 text-red-600 px-2 py-0.5 text-xs font-medium">Inactiva</span>
                  )}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => abrirEditar(a)}
                  className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium hover:bg-gray-200">
                  Editar
                </button>
                <button onClick={() => toggleActiva(a)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                    a.activa ? "bg-red-50 text-red-600 hover:bg-red-100" : "bg-green-50 text-green-700 hover:bg-green-100"
                  }`}>
                  {a.activa ? "Desactivar" : "Activar"}
                </button>
              </div>
            </div>
          ))}
          {filtrados.length === 0 && (
            <div className="p-8 text-center text-gray-400">Sin autorizaciones.</div>
          )}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-4">{editId ? "Editar autorización" : "Nueva autorización"}</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Nombre *</label>
                <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  placeholder="Puente grúa, Carretilla elevadora..." />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Descripción</label>
                <textarea value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" rows={2} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Vigencia (meses)</label>
                <input type="number" value={form.vigencia_meses}
                  onChange={(e) => setForm({ ...form, vigencia_meses: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  placeholder="12, 24, 36... (dejar vacío si no caduca)" min={1} />
              </div>
              <div className="flex flex-col gap-2 pt-1">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.requiere_formacion}
                    onChange={(e) => setForm({ ...form, requiere_formacion: e.target.checked })} />
                  Requiere formación previa
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.activa}
                    onChange={(e) => setForm({ ...form, activa: e.target.checked })} />
                  Autorización activa
                </label>
              </div>
            </div>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <div className="mt-5 flex gap-2 justify-end">
              <button onClick={() => setModal(false)} className="rounded-xl border px-4 py-2 text-sm font-semibold">Cancelar</button>
              <button onClick={guardar} disabled={guardando}
                className="rounded-xl bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-900 disabled:opacity-50">
                {guardando ? "Guardando..." : editId ? "Guardar" : "Crear"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
