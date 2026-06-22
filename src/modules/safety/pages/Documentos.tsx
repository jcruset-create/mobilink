import { useEffect, useState } from "react";
import SafetyMenu from "../components/SafetyMenu";
import { supabase } from "../services/supabase";

type Documento = {
  id: string;
  titulo: string;
  tipo: string;
  descripcion: string | null;
  version: string;
  lectura_obligatoria: boolean;
  publicado: boolean;
  fecha_publicacion: string | null;
  fecha_caducidad: string | null;
  archivo_url: string | null;
  activo: boolean;
};

const TIPOS = ["procedimiento", "instruccion", "norma", "comunicado", "otro"];

const TIPO_BADGE: Record<string, string> = {
  procedimiento: "bg-blue-100 text-blue-800",
  instruccion:   "bg-indigo-100 text-indigo-800",
  norma:         "bg-purple-100 text-purple-800",
  comunicado:    "bg-orange-100 text-orange-800",
  otro:          "bg-gray-100 text-gray-600",
};

const EMPTY = { titulo: "", tipo: "procedimiento", descripcion: "", version: "1.0", lectura_obligatoria: false, publicado: false, archivo_url: "", fecha_caducidad: "" };

export default function Documentos() {
  const [items, setItems] = useState<Documento[]>([]);
  const [firmasMap, setFirmasMap] = useState<Record<string, number>>({});
  const [totalEmpleados, setTotalEmpleados] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroTexto, setFiltroTexto] = useState("");
  const [soloObligatorios, setSoloObligatorios] = useState(false);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<any>({ ...EMPTY });
  const [editId, setEditId] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  useEffect(() => { cargar(); }, []);

  async function cargar() {
    setCargando(true);
    const [{ data }, { data: acks }, { count: empCount }] = await Promise.all([
      supabase.from("sm_safety_documents")
        .select("id, titulo, tipo, descripcion, version, lectura_obligatoria, publicado, fecha_publicacion, fecha_caducidad, archivo_url, activo")
        .eq("activo", true).order("fecha_publicacion", { ascending: false }),
      supabase.from("sm_document_acknowledgements").select("document_id").eq("firmado", true),
      supabase.from("sea_employees").select("*", { count: "exact", head: true }).eq("activo", true),
    ]);
    setItems(data ?? []);

    const map: Record<string, number> = {};
    for (const a of acks ?? []) {
      map[a.document_id] = (map[a.document_id] ?? 0) + 1;
    }
    setFirmasMap(map);
    setTotalEmpleados(empCount ?? 0);
    setCargando(false);
  }

  const filtrados = items.filter((d) => {
    if (filtroTipo && d.tipo !== filtroTipo) return false;
    if (soloObligatorios && !d.lectura_obligatoria) return false;
    if (filtroTexto.trim() && !d.titulo.toLowerCase().includes(filtroTexto.toLowerCase())) return false;
    return true;
  });

  function abrir(d?: Documento) {
    if (d) {
      setForm({ titulo: d.titulo, tipo: d.tipo, descripcion: d.descripcion ?? "", version: d.version,
        lectura_obligatoria: d.lectura_obligatoria, publicado: d.publicado,
        archivo_url: d.archivo_url ?? "", fecha_caducidad: d.fecha_caducidad?.substring(0, 10) ?? "" });
      setEditId(d.id);
    } else {
      setForm({ ...EMPTY });
      setEditId(null);
    }
    setError("");
    setModal(true);
  }

  async function guardar() {
    if (!form.titulo?.trim()) { setError("El título es obligatorio."); return; }
    setGuardando(true);
    const payload = {
      titulo:              form.titulo.trim(),
      tipo:                form.tipo,
      descripcion:         form.descripcion || null,
      version:             form.version || "1.0",
      lectura_obligatoria: form.lectura_obligatoria,
      publicado:           form.publicado,
      fecha_publicacion:   form.publicado ? new Date().toISOString() : null,
      archivo_url:         form.archivo_url || null,
      fecha_caducidad:     form.fecha_caducidad || null,
      activo:              true,
    };
    const { error: err } = editId
      ? await supabase.from("sm_safety_documents").update(payload).eq("id", editId)
      : await supabase.from("sm_safety_documents").insert(payload);
    setGuardando(false);
    if (err) { setError(err.message); return; }
    setMensaje(editId ? "Documento actualizado." : "Documento creado.");
    setModal(false);
    setTimeout(() => setMensaje(""), 3000);
    cargar();
  }

  async function publicar(id: string, publicado: boolean) {
    await supabase.from("sm_safety_documents").update({
      publicado, fecha_publicacion: publicado ? new Date().toISOString() : null,
    }).eq("id", id);
    cargar();
  }

  async function desactivar(id: string) {
    if (!confirm("¿Desactivar este documento?")) return;
    await supabase.from("sm_safety_documents").update({ activo: false }).eq("id", id);
    cargar();
  }

  return (
    <div className="p-6 space-y-4">
      <SafetyMenu />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Documentos de seguridad</h1>
          <p className="text-sm text-gray-500">{filtrados.length} documentos</p>
        </div>
        <button onClick={() => abrir()}
          className="rounded-xl bg-yellow-500 px-4 py-2 text-sm font-semibold text-white hover:bg-yellow-600">
          + Nuevo documento
        </button>
      </div>

      {mensaje && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{mensaje}</p>}

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 items-center">
        <input value={filtroTexto} onChange={(e) => setFiltroTexto(e.target.value)}
          placeholder="Buscar por título..." className="rounded-lg border px-3 py-2 text-sm w-56" />
        <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} className="rounded-lg border px-3 py-2 text-sm">
          <option value="">Todos los tipos</option>
          {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={soloObligatorios} onChange={(e) => setSoloObligatorios(e.target.checked)} />
          Solo lectura obligatoria
        </label>
        {(filtroTipo || filtroTexto || soloObligatorios) && (
          <button onClick={() => { setFiltroTipo(""); setFiltroTexto(""); setSoloObligatorios(false); }}
            className="rounded-lg border px-3 py-2 text-sm text-gray-500 hover:bg-gray-50">Limpiar</button>
        )}
      </div>

      {cargando ? <div className="py-10 text-center text-gray-400">Cargando...</div> : (
        <div className="overflow-auto rounded-xl border bg-white">
          <table className="w-full min-w-[800px] text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="p-3">Título</th>
                <th className="p-3">Tipo</th>
                <th className="p-3">Versión</th>
                <th className="p-3">Publicado</th>
                <th className="p-3">Caducidad</th>
                <th className="p-3">Firmas</th>
                <th className="p-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((d) => {
                const caduca = d.fecha_caducidad
                  ? Math.ceil((new Date(d.fecha_caducidad).getTime() - Date.now()) / 86400000)
                  : null;
                return (
                  <tr key={d.id} className="border-t hover:bg-gray-50">
                    <td className="p-3">
                      <div className="font-medium">{d.titulo}</div>
                      {d.descripcion && <div className="text-xs text-gray-400 truncate max-w-xs">{d.descripcion}</div>}
                      {d.lectura_obligatoria && (
                        <span className="rounded-full bg-red-100 text-red-700 px-1.5 py-0.5 text-xs">Obligatorio</span>
                      )}
                    </td>
                    <td className="p-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TIPO_BADGE[d.tipo] ?? "bg-gray-100"}`}>
                        {d.tipo}
                      </span>
                    </td>
                    <td className="p-3 text-gray-500">v{d.version}</td>
                    <td className="p-3">
                      {d.publicado ? (
                        <span className="rounded-full bg-green-100 text-green-800 px-2 py-0.5 text-xs font-medium">Publicado</span>
                      ) : (
                        <span className="rounded-full bg-gray-100 text-gray-500 px-2 py-0.5 text-xs">Borrador</span>
                      )}
                    </td>
                    <td className="p-3">
                      {caduca === null ? <span className="text-gray-400">—</span> : (
                        <span className={`text-xs font-semibold ${caduca < 0 ? "text-red-600" : caduca < 30 ? "text-orange-600" : "text-gray-500"}`}>
                          {caduca < 0 ? `Caducado` : `${caduca}d`}
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      {d.lectura_obligatoria && d.publicado ? (
                        <div className="flex items-center gap-1.5">
                          <div className="h-1.5 w-16 rounded-full bg-gray-200 overflow-hidden">
                            <div className="h-full bg-green-500 rounded-full" style={{ width: `${totalEmpleados > 0 ? Math.round(((firmasMap[d.id] ?? 0) / totalEmpleados) * 100) : 0}%` }} />
                          </div>
                          <span className="text-xs text-gray-500 whitespace-nowrap">
                            {firmasMap[d.id] ?? 0}/{totalEmpleados}
                          </span>
                        </div>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex gap-1">
                        <button onClick={() => publicar(d.id, !d.publicado)}
                          className={`rounded-lg px-2 py-1 text-xs ${d.publicado ? "bg-gray-100 hover:bg-gray-200" : "bg-green-50 text-green-700 hover:bg-green-100"}`}>
                          {d.publicado ? "Despublicar" : "Publicar"}
                        </button>
                        <button onClick={() => abrir(d)} className="rounded-lg bg-gray-100 px-2 py-1 text-xs hover:bg-gray-200">Editar</button>
                        <button onClick={() => desactivar(d.id)} className="rounded-lg bg-red-50 px-2 py-1 text-xs text-red-600 hover:bg-red-100">✕</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtrados.length === 0 && (
                <tr><td colSpan={7} className="p-8 text-center text-gray-400">Sin documentos.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-4">{editId ? "Editar documento" : "Nuevo documento"}</h2>
            <div className="space-y-3">
              <div><label className="text-xs font-medium text-gray-600">Título *</label>
                <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-gray-600">Tipo</label>
                  <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                    {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select></div>
                <div><label className="text-xs font-medium text-gray-600">Versión</label>
                  <input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" placeholder="1.0" /></div>
              </div>
              <div><label className="text-xs font-medium text-gray-600">Descripción</label>
                <textarea value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" rows={3} /></div>
              <div><label className="text-xs font-medium text-gray-600">URL archivo (PDF, etc.)</label>
                <input value={form.archivo_url} onChange={(e) => setForm({ ...form, archivo_url: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" placeholder="https://..." /></div>
              <div><label className="text-xs font-medium text-gray-600">Fecha caducidad</label>
                <input type="date" value={form.fecha_caducidad} onChange={(e) => setForm({ ...form, fecha_caducidad: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.lectura_obligatoria} onChange={(e) => setForm({ ...form, lectura_obligatoria: e.target.checked })} />
                  Lectura obligatoria
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.publicado} onChange={(e) => setForm({ ...form, publicado: e.target.checked })} />
                  Publicar ahora
                </label>
              </div>
            </div>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <div className="mt-5 flex gap-2 justify-end">
              <button onClick={() => setModal(false)} className="rounded-xl border px-4 py-2 text-sm font-semibold">Cancelar</button>
              <button onClick={guardar} disabled={guardando}
                className="rounded-xl bg-yellow-500 px-4 py-2 text-sm font-semibold text-white hover:bg-yellow-600 disabled:opacity-50">
                {guardando ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
