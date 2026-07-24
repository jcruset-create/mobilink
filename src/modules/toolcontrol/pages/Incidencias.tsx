import { useEffect, useState } from "react";
import ToolControlLayout from "../components/ToolControlLayout";
import { supabase } from "../services/supabase";

type Incidencia = {
  id: string;
  titulo: string;
  tipo: string;
  estado: string;
  descripcion: string | null;
  created_at: string;
  fecha_cierre: string | null;
  resolucion: string | null;
  tc_tools: { nombre: string; codigo: string } | null;
  tc_machines: { nombre: string; codigo: string } | null;
};

const TIPOS = ["averia", "perdida", "danio", "fuera_sitio", "otro"];
const ESTADOS = ["abierta", "avisada", "justificada", "revisada", "cerrada", "reincidente"];

const ESTADO_BADGE: Record<string, string> = {
  abierta:     "bg-red-500/15 text-red-300",
  avisada:     "bg-orange-500/15 text-orange-300",
  justificada: "bg-yellow-500/15 text-yellow-300",
  revisada:    "bg-sky-500/15 text-sky-300",
  cerrada:     "bg-emerald-500/15 text-emerald-300",
  reincidente: "bg-purple-500/15 text-purple-300",
};

const FIELD = "rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/40";
const INPUT = `w-full ${FIELD}`;
const LABEL = "text-xs font-medium text-slate-400";

export default function Incidencias() {
  const [items, setItems] = useState<Incidencia[]>([]);
  const [herramientas, setHerramientas] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtroEstado, setFiltroEstado] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [modal, setModal] = useState(false);
  const [modalDetalle, setModalDetalle] = useState<Incidencia | null>(null);
  const [form, setForm] = useState({ titulo: "", tipo: "averia", descripcion: "", tool_id: "" });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { cargar(); }, []);

  async function cargar() {
    setCargando(true);
    const [{ data: inc }, { data: herr }] = await Promise.all([
      supabase
        .from("tc_incidents")
        .select("id, titulo, tipo, estado, descripcion, created_at, fecha_cierre, resolucion, tc_tools(nombre, codigo), tc_machines(nombre, codigo)")
        .order("created_at", { ascending: false }),
      supabase.from("tc_tools").select("id, nombre, codigo").eq("activa", true).order("nombre"),
    ]);
    setItems((inc ?? []) as any);
    setHerramientas(herr ?? []);
    setCargando(false);
  }

  const filtradas = items.filter((i) => !filtroEstado || i.estado === filtroEstado);

  async function crear() {
    if (!form.titulo.trim()) { setError("El título es obligatorio."); return; }
    setGuardando(true);
    const { error: err } = await supabase.from("tc_incidents").insert({
      titulo:       form.titulo.trim(),
      tipo:         form.tipo,
      descripcion:  form.descripcion || null,
      tool_id:      form.tool_id || null,
      estado:       "abierta",
    });
    setGuardando(false);
    if (err) { setError(err.message); return; }
    setMensaje("Incidencia creada.");
    setModal(false);
    setTimeout(() => setMensaje(""), 3000);
    cargar();
  }

  async function cambiarEstado(id: string, estado: string) {
    const extra: any = {};
    if (estado === "cerrada") extra.fecha_cierre = new Date().toISOString();
    await supabase.from("tc_incidents").update({ estado, ...extra }).eq("id", id);
    cargar();
    if (modalDetalle) setModalDetalle({ ...modalDetalle, estado });
  }

  return (
    <ToolControlLayout
      title="Incidencias"
      subtitle={`${filtradas.length} registros`}
      actions={
        <button
          onClick={() => { setForm({ titulo: "", tipo: "averia", descripcion: "", tool_id: "" }); setError(""); setModal(true); }}
          className="rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-bold text-amber-950 hover:bg-amber-400"
        >
          + <span className="hidden sm:inline">Nueva incidencia</span><span className="sm:hidden">Nueva</span>
        </button>
      }
    >
      {mensaje && <p className="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">{mensaje}</p>}

      {/* Stats rápidas */}
      <div className="flex flex-wrap gap-2">
        {ESTADOS.map((e) => {
          const n = items.filter((i) => i.estado === e).length;
          return (
            <button
              key={e}
              onClick={() => setFiltroEstado(filtroEstado === e ? "" : e)}
              className={`rounded-full px-3 py-1 text-xs font-medium border border-slate-700 transition-all ${
                filtroEstado === e ? "ring-2 ring-offset-1 ring-offset-slate-900 ring-amber-500" : ""
              } ${ESTADO_BADGE[e] ?? "bg-slate-500/15 text-slate-300"}`}
            >
              {e.replace(/_/g, " ")} ({n})
            </button>
          );
        })}
      </div>

      {cargando ? (
        <div className="py-10 text-center text-slate-500">Cargando...</div>
      ) : (
        <div className="overflow-auto rounded-xl border border-slate-800 bg-slate-800/60">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="bg-slate-800 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="p-3">Fecha</th>
                <th className="p-3">Título</th>
                <th className="p-3">Tipo</th>
                <th className="p-3">Herramienta</th>
                <th className="p-3">Estado</th>
                <th className="p-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((i) => (
                <tr key={i.id} className="border-t border-slate-800 hover:bg-slate-800/50 cursor-pointer" onClick={() => setModalDetalle(i)}>
                  <td className="p-3 text-slate-400 text-xs whitespace-nowrap">
                    {new Date(i.created_at).toLocaleString("es-ES")}
                  </td>
                  <td className="p-3 font-medium text-slate-100">{i.titulo}</td>
                  <td className="p-3 text-slate-400">{i.tipo}</td>
                  <td className="p-3 text-slate-400">
                    {(i.tc_tools as any)?.nombre ?? (i.tc_machines as any)?.nombre ?? "—"}
                  </td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_BADGE[i.estado] ?? "bg-slate-500/15 text-slate-300"}`}>
                      {i.estado}
                    </span>
                  </td>
                  <td className="p-3" onClick={(e) => e.stopPropagation()}>
                    <select
                      value={i.estado}
                      onChange={(e) => cambiarEstado(i.id, e.target.value)}
                      className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100"
                    >
                      {ESTADOS.map((e) => <option key={e} value={e}>{e}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
              {filtradas.length === 0 && (
                <tr><td colSpan={6} className="p-8 text-center text-slate-500">Sin incidencias.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal nueva */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-4 text-slate-100">Nueva incidencia</h2>
            <div className="space-y-3">
              <div>
                <label className={LABEL}>Título *</label>
                <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                  className={`mt-1 ${INPUT}`} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>Tipo</label>
                  <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}
                    className={`mt-1 ${INPUT}`}>
                    {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className={LABEL}>Herramienta</label>
                  <select value={form.tool_id} onChange={(e) => setForm({ ...form, tool_id: e.target.value })}
                    className={`mt-1 ${INPUT}`}>
                    <option value="">Sin asociar</option>
                    {herramientas.map((h) => <option key={h.id} value={h.id}>{h.nombre} ({h.codigo})</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={LABEL}>Descripción</label>
                <textarea value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                  className={`mt-1 ${INPUT}`} rows={3} />
              </div>
            </div>
            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
            <div className="mt-5 flex gap-2 justify-end">
              <button onClick={() => setModal(false)} className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700">Cancelar</button>
              <button onClick={crear} disabled={guardando} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-amber-950 hover:bg-amber-400 disabled:opacity-50">
                {guardando ? "Guardando..." : "Crear incidencia"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal detalle */}
      {modalDetalle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setModalDetalle(null)}>
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-100">{modalDetalle.titulo}</h2>
              <button onClick={() => setModalDetalle(null)} className="text-slate-400 hover:text-slate-200">✕</button>
            </div>
            <dl className="space-y-2 text-sm text-slate-200">
              <div className="flex gap-2"><dt className="text-slate-400 w-28">Estado:</dt>
                <dd><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_BADGE[modalDetalle.estado]}`}>{modalDetalle.estado}</span></dd>
              </div>
              <div className="flex gap-2"><dt className="text-slate-400 w-28">Tipo:</dt><dd>{modalDetalle.tipo}</dd></div>
              <div className="flex gap-2"><dt className="text-slate-400 w-28">Herramienta:</dt>
                <dd>{(modalDetalle.tc_tools as any)?.nombre ?? "—"}</dd>
              </div>
              <div className="flex gap-2"><dt className="text-slate-400 w-28">Descripción:</dt><dd>{modalDetalle.descripcion ?? "—"}</dd></div>
              <div className="flex gap-2"><dt className="text-slate-400 w-28">Resolución:</dt><dd>{modalDetalle.resolucion ?? "—"}</dd></div>
              <div className="flex gap-2"><dt className="text-slate-400 w-28">Fecha:</dt>
                <dd>{new Date(modalDetalle.created_at).toLocaleString("es-ES")}</dd>
              </div>
            </dl>
            <div className="mt-4">
              <label className={LABEL}>Cambiar estado</label>
              <div className="flex flex-wrap gap-2 mt-2">
                {ESTADOS.map((e) => (
                  <button key={e} onClick={() => cambiarEstado(modalDetalle.id, e)}
                    className={`rounded-full px-3 py-1 text-xs font-medium border border-slate-700 ${modalDetalle.estado === e ? "ring-2 ring-offset-1 ring-offset-slate-900 ring-amber-500" : ""} ${ESTADO_BADGE[e]}`}>
                    {e}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </ToolControlLayout>
  );
}
