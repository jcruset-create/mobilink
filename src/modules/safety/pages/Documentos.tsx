import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import SafetyLayout from "../components/SafetyLayout";
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
  procedimiento: "border-sky-500/30 bg-sky-500/15 text-sky-300",
  instruccion:   "border-indigo-500/30 bg-indigo-500/15 text-indigo-300",
  norma:         "border-violet-500/30 bg-violet-500/15 text-violet-300",
  comunicado:    "border-orange-500/30 bg-orange-500/15 text-orange-300",
  otro:          "border-slate-500/30 bg-slate-500/15 text-slate-300",
};

const EMPTY = { titulo: "", tipo: "procedimiento", descripcion: "", version: "1.0", lectura_obligatoria: false, publicado: false, archivo_url: "", fecha_caducidad: "" };

const FIELD = "rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/40";
const INPUT = `w-full ${FIELD}`;
const LABEL = "text-xs font-medium text-slate-400";

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
    <SafetyLayout
      title="Documentos de seguridad"
      subtitle={`${filtrados.length} documentos`}
      actions={
        <button onClick={() => abrir()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-bold text-amber-950 hover:bg-amber-400">
          <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Nuevo documento</span>
        </button>
      }
    >
      {mensaje && (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/15 p-3 text-sm text-emerald-300">{mensaje}</p>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <input value={filtroTexto} onChange={(e) => setFiltroTexto(e.target.value)}
          placeholder="Buscar por título..." className={`w-56 ${FIELD}`} />
        <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} className={FIELD}>
          <option value="">Todos los tipos</option>
          {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={soloObligatorios} onChange={(e) => setSoloObligatorios(e.target.checked)} className="accent-amber-500" />
          Solo lectura obligatoria
        </label>
        {(filtroTipo || filtroTexto || soloObligatorios) && (
          <button onClick={() => { setFiltroTipo(""); setFiltroTexto(""); setSoloObligatorios(false); }}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700">Limpiar</button>
        )}
      </div>

      {cargando ? <div className="py-10 text-center text-slate-500">Cargando...</div> : (
        <div className="overflow-auto rounded-xl border border-slate-700 bg-slate-800 shadow-sm">
          <table className="w-full min-w-[800px] text-sm">
            <thead className="bg-slate-950/60 text-left text-xs uppercase tracking-wide text-slate-400">
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
                  <tr key={d.id} className="border-t border-slate-700/70 hover:bg-slate-700/40">
                    <td className="p-3">
                      <div className="font-medium text-slate-100">{d.titulo}</div>
                      {d.descripcion && <div className="max-w-xs truncate text-xs text-slate-500">{d.descripcion}</div>}
                      {d.lectura_obligatoria && (
                        <span className="rounded-full border border-red-500/30 bg-red-500/15 px-1.5 py-0.5 text-xs text-red-300">Obligatorio</span>
                      )}
                    </td>
                    <td className="p-3">
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${TIPO_BADGE[d.tipo] ?? "border-slate-500/30 bg-slate-500/15 text-slate-300"}`}>
                        {d.tipo}
                      </span>
                    </td>
                    <td className="p-3 text-slate-400">v{d.version}</td>
                    <td className="p-3">
                      {d.publicado ? (
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300">Publicado</span>
                      ) : (
                        <span className="rounded-full border border-slate-500/30 bg-slate-500/15 px-2 py-0.5 text-xs text-slate-400">Borrador</span>
                      )}
                    </td>
                    <td className="p-3">
                      {caduca === null ? <span className="text-slate-500">—</span> : (
                        <span className={`text-xs font-semibold ${caduca < 0 ? "text-red-400" : caduca < 30 ? "text-orange-400" : "text-slate-400"}`}>
                          {caduca < 0 ? `Caducado` : `${caduca}d`}
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      {d.lectura_obligatoria && d.publicado ? (
                        <div className="flex items-center gap-1.5">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-700">
                            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${totalEmpleados > 0 ? Math.round(((firmasMap[d.id] ?? 0) / totalEmpleados) * 100) : 0}%` }} />
                          </div>
                          <span className="whitespace-nowrap text-xs text-slate-400">
                            {firmasMap[d.id] ?? 0}/{totalEmpleados}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex gap-1">
                        <button onClick={() => publicar(d.id, !d.publicado)}
                          className={`rounded-lg border px-2 py-1 text-xs ${d.publicado
                            ? "border-slate-600 bg-slate-700 text-slate-200 hover:bg-slate-600"
                            : "border-emerald-500/30 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"}`}>
                          {d.publicado ? "Despublicar" : "Publicar"}
                        </button>
                        <button onClick={() => abrir(d)}
                          className="rounded-lg border border-slate-600 bg-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-600">Editar</button>
                        <button onClick={() => desactivar(d.id)}
                          className="rounded-lg border border-red-500/30 bg-red-500/15 px-2 py-1 text-xs text-red-300 hover:bg-red-500/25">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtrados.length === 0 && (
                <tr><td colSpan={7} className="p-8 text-center text-slate-500">Sin documentos.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold text-slate-100">{editId ? "Editar documento" : "Nuevo documento"}</h2>
            <div className="space-y-3">
              <div><label className={LABEL}>Título *</label>
                <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                  className={`mt-1 ${INPUT}`} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={LABEL}>Tipo</label>
                  <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}
                    className={`mt-1 ${INPUT}`}>
                    {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select></div>
                <div><label className={LABEL}>Versión</label>
                  <input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })}
                    className={`mt-1 ${INPUT}`} placeholder="1.0" /></div>
              </div>
              <div><label className={LABEL}>Descripción</label>
                <textarea value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                  className={`mt-1 resize-none ${INPUT}`} rows={3} /></div>
              <div><label className={LABEL}>URL archivo (PDF, etc.)</label>
                <input value={form.archivo_url} onChange={(e) => setForm({ ...form, archivo_url: e.target.value })}
                  className={`mt-1 ${INPUT}`} placeholder="https://..." /></div>
              <div><label className={LABEL}>Fecha caducidad</label>
                <input type="date" value={form.fecha_caducidad} onChange={(e) => setForm({ ...form, fecha_caducidad: e.target.value })}
                  className={`mt-1 ${INPUT}`} /></div>
              <div className="flex gap-4">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={form.lectura_obligatoria} onChange={(e) => setForm({ ...form, lectura_obligatoria: e.target.checked })} className="accent-amber-500" />
                  Lectura obligatoria
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={form.publicado} onChange={(e) => setForm({ ...form, publicado: e.target.checked })} className="accent-amber-500" />
                  Publicar ahora
                </label>
              </div>
            </div>
            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setModal(false)}
                className="rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-600">Cancelar</button>
              <button onClick={guardar} disabled={guardando}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-amber-950 hover:bg-amber-400 disabled:opacity-50">
                {guardando ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </SafetyLayout>
  );
}
