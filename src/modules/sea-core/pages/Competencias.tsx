import { useEffect, useState } from "react";
import CoreMenu from "../components/CoreMenu";
import { supabase } from "../../almacen-neumaticos/services/supabase";

type Competencia = {
  id: string; nombre: string; descripcion: string | null;
  categoria: string; activa: boolean;
};

const CATEGORIAS = ["tecnica", "seguridad", "calidad", "operativa", "gestion", "otra"];

const CAT_BADGE: Record<string, string> = {
  tecnica:   "bg-blue-100 text-blue-800",
  seguridad: "bg-red-100 text-red-800",
  calidad:   "bg-purple-100 text-purple-800",
  operativa: "bg-orange-100 text-orange-800",
  gestion:   "bg-green-100 text-green-800",
  otra:      "bg-gray-100 text-gray-600",
};

const EMPTY = { nombre: "", descripcion: "", categoria: "tecnica", activa: true };

export default function Competencias() {
  const [items, setItems] = useState<Competencia[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroTexto, setFiltroTexto] = useState("");
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<any>({ ...EMPTY });
  const [editId, setEditId] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  useEffect(() => { cargar(); }, []);

  async function cargar() {
    setCargando(true);
    const { data } = await supabase.from("sea_competencies").select("*").order("categoria").order("nombre");
    setItems(data ?? []);
    setCargando(false);
  }

  const filtrados = items.filter((c) => {
    if (filtroCategoria && c.categoria !== filtroCategoria) return false;
    if (filtroTexto.trim() && !c.nombre.toLowerCase().includes(filtroTexto.toLowerCase())) return false;
    return true;
  });

  // Group by category
  const grupos = filtrados.reduce((acc, c) => {
    if (!acc[c.categoria]) acc[c.categoria] = [];
    acc[c.categoria].push(c);
    return acc;
  }, {} as Record<string, Competencia[]>);

  function abrirNuevo() { setForm({ ...EMPTY }); setEditId(null); setError(""); setModal(true); }
  function abrirEditar(c: Competencia) {
    setForm({ nombre: c.nombre, descripcion: c.descripcion ?? "", categoria: c.categoria, activa: c.activa });
    setEditId(c.id); setError(""); setModal(true);
  }

  async function guardar() {
    if (!form.nombre?.trim()) { setError("El nombre es obligatorio."); return; }
    setGuardando(true);
    const payload = {
      nombre: form.nombre.trim(), descripcion: form.descripcion || null,
      categoria: form.categoria, activa: form.activa,
    };
    const { error: err } = editId
      ? await supabase.from("sea_competencies").update(payload).eq("id", editId)
      : await supabase.from("sea_competencies").insert(payload);
    setGuardando(false);
    if (err) { setError(err.message); return; }
    setMensaje(editId ? "Competencia actualizada." : "Competencia creada.");
    setModal(false);
    setTimeout(() => setMensaje(""), 3000);
    cargar();
  }

  async function toggleActiva(c: Competencia) {
    await supabase.from("sea_competencies").update({ activa: !c.activa }).eq("id", c.id);
    cargar();
  }

  return (
    <div className="p-6 space-y-4">
      <CoreMenu />
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Catálogo de competencias</h1>
          <p className="text-sm text-gray-500">{filtrados.length} competencias</p>
        </div>
        <button onClick={abrirNuevo}
          className="rounded-xl bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-900">
          + Nueva competencia
        </button>
      </div>

      {mensaje && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{mensaje}</p>}

      <div className="flex flex-wrap gap-2 items-center">
        <input value={filtroTexto} onChange={(e) => setFiltroTexto(e.target.value)}
          placeholder="Buscar competencia..." className="rounded-lg border px-3 py-2 text-sm w-56" />
        <div className="flex flex-wrap gap-1">
          <button onClick={() => setFiltroCategoria("")}
            className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
              !filtroCategoria ? "bg-gray-800 text-white border-gray-800" : "bg-white text-gray-600 hover:bg-gray-50"
            }`}>Todas</button>
          {CATEGORIAS.map((cat) => (
            <button key={cat} onClick={() => setFiltroCategoria(cat === filtroCategoria ? "" : cat)}
              className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                filtroCategoria === cat ? "bg-gray-800 text-white border-gray-800" : "bg-white text-gray-600 hover:bg-gray-50"
              }`}>{cat}</button>
          ))}
        </div>
      </div>

      {cargando ? <div className="py-10 text-center text-gray-400">Cargando...</div> : (
        <div className="space-y-4">
          {Object.entries(grupos).map(([cat, comps]) => (
            <div key={cat} className="rounded-xl border bg-white overflow-hidden">
              <div className={`px-4 py-2 flex items-center gap-2 border-b ${CAT_BADGE[cat] ?? "bg-gray-50"}`}>
                <span className="font-semibold text-sm capitalize">{cat}</span>
                <span className="text-xs opacity-70">({comps.length})</span>
              </div>
              <div className="divide-y">
                {comps.map((c) => (
                  <div key={c.id} className="flex items-center justify-between p-3">
                    <div>
                      <div className={`font-medium text-sm ${!c.activa ? "text-gray-400 line-through" : ""}`}>{c.nombre}</div>
                      {c.descripcion && <div className="text-xs text-gray-400">{c.descripcion}</div>}
                    </div>
                    <div className="flex items-center gap-2">
                      {!c.activa && <span className="rounded-full bg-red-100 text-red-600 px-2 py-0.5 text-xs">Inactiva</span>}
                      <button onClick={() => abrirEditar(c)} className="rounded-lg bg-gray-100 px-2 py-1 text-xs hover:bg-gray-200">Editar</button>
                      <button onClick={() => toggleActiva(c)}
                        className={`rounded-lg px-2 py-1 text-xs ${c.activa ? "bg-red-50 text-red-600 hover:bg-red-100" : "bg-green-50 text-green-700 hover:bg-green-100"}`}>
                        {c.activa ? "Desactivar" : "Activar"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {filtrados.length === 0 && (
            <div className="rounded-xl border bg-white p-8 text-center text-gray-400">Sin competencias.</div>
          )}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-4">{editId ? "Editar competencia" : "Nueva competencia"}</h2>
            <div className="space-y-3">
              <div><label className="text-xs font-medium text-gray-600">Nombre *</label>
                <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" placeholder="Mecánica industrial, Soldadura MIG..." /></div>
              <div><label className="text-xs font-medium text-gray-600">Categoría</label>
                <select value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                  {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select></div>
              <div><label className="text-xs font-medium text-gray-600">Descripción</label>
                <textarea value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" rows={2} /></div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.activa} onChange={(e) => setForm({ ...form, activa: e.target.checked })} />
                Competencia activa
              </label>
            </div>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <div className="mt-4 flex gap-2 justify-end">
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
