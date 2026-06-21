import { useEffect, useState } from "react";
import ToolControlMenu from "../components/ToolControlMenu";
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
  abierta:     "bg-red-100 text-red-800",
  avisada:     "bg-orange-100 text-orange-800",
  justificada: "bg-yellow-100 text-yellow-800",
  revisada:    "bg-blue-100 text-blue-800",
  cerrada:     "bg-green-100 text-green-800",
  reincidente: "bg-purple-100 text-purple-800",
};

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
    <div className="p-6 space-y-4">
      <ToolControlMenu />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Incidencias</h1>
          <p className="text-sm text-gray-500">{filtradas.length} registros</p>
        </div>
        <button
          onClick={() => { setForm({ titulo: "", tipo: "averia", descripcion: "", tool_id: "" }); setError(""); setModal(true); }}
          className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
        >
          + Nueva incidencia
        </button>
      </div>

      {mensaje && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{mensaje}</p>}

      {/* Stats rápidas */}
      <div className="flex flex-wrap gap-2">
        {ESTADOS.map((e) => {
          const n = items.filter((i) => i.estado === e).length;
          return (
            <button
              key={e}
              onClick={() => setFiltroEstado(filtroEstado === e ? "" : e)}
              className={`rounded-full px-3 py-1 text-xs font-medium border transition-all ${
                filtroEstado === e ? "ring-2 ring-offset-1 ring-gray-400" : ""
              } ${ESTADO_BADGE[e] ?? "bg-gray-100 text-gray-600"}`}
            >
              {e.replace(/_/g, " ")} ({n})
            </button>
          );
        })}
      </div>

      {cargando ? (
        <div className="py-10 text-center text-gray-400">Cargando...</div>
      ) : (
        <div className="overflow-auto rounded-xl border bg-white">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="bg-gray-50 text-left">
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
                <tr key={i.id} className="border-t hover:bg-gray-50 cursor-pointer" onClick={() => setModalDetalle(i)}>
                  <td className="p-3 text-gray-500 text-xs whitespace-nowrap">
                    {new Date(i.created_at).toLocaleString("es-ES")}
                  </td>
                  <td className="p-3 font-medium">{i.titulo}</td>
                  <td className="p-3 text-gray-500">{i.tipo}</td>
                  <td className="p-3 text-gray-500">
                    {(i.tc_tools as any)?.nombre ?? (i.tc_machines as any)?.nombre ?? "—"}
                  </td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_BADGE[i.estado] ?? "bg-gray-100 text-gray-600"}`}>
                      {i.estado}
                    </span>
                  </td>
                  <td className="p-3" onClick={(e) => e.stopPropagation()}>
                    <select
                      value={i.estado}
                      onChange={(e) => cambiarEstado(i.id, e.target.value)}
                      className="rounded-lg border px-2 py-1 text-xs"
                    >
                      {ESTADOS.map((e) => <option key={e} value={e}>{e}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
              {filtradas.length === 0 && (
                <tr><td colSpan={6} className="p-8 text-center text-gray-400">Sin incidencias.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal nueva */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-4">Nueva incidencia</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Título *</label>
                <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">Tipo</label>
                  <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                    {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Herramienta</label>
                  <select value={form.tool_id} onChange={(e) => setForm({ ...form, tool_id: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                    <option value="">Sin asociar</option>
                    {herramientas.map((h) => <option key={h.id} value={h.id}>{h.nombre} ({h.codigo})</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Descripción</label>
                <textarea value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" rows={3} />
              </div>
            </div>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <div className="mt-5 flex gap-2 justify-end">
              <button onClick={() => setModal(false)} className="rounded-xl border px-4 py-2 text-sm font-semibold">Cancelar</button>
              <button onClick={crear} disabled={guardando} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {guardando ? "Guardando..." : "Crear incidencia"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal detalle */}
      {modalDetalle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setModalDetalle(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-lg font-bold">{modalDetalle.titulo}</h2>
              <button onClick={() => setModalDetalle(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <dl className="space-y-2 text-sm">
              <div className="flex gap-2"><dt className="text-gray-500 w-28">Estado:</dt>
                <dd><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_BADGE[modalDetalle.estado]}`}>{modalDetalle.estado}</span></dd>
              </div>
              <div className="flex gap-2"><dt className="text-gray-500 w-28">Tipo:</dt><dd>{modalDetalle.tipo}</dd></div>
              <div className="flex gap-2"><dt className="text-gray-500 w-28">Herramienta:</dt>
                <dd>{(modalDetalle.tc_tools as any)?.nombre ?? "—"}</dd>
              </div>
              <div className="flex gap-2"><dt className="text-gray-500 w-28">Descripción:</dt><dd>{modalDetalle.descripcion ?? "—"}</dd></div>
              <div className="flex gap-2"><dt className="text-gray-500 w-28">Resolución:</dt><dd>{modalDetalle.resolucion ?? "—"}</dd></div>
              <div className="flex gap-2"><dt className="text-gray-500 w-28">Fecha:</dt>
                <dd>{new Date(modalDetalle.created_at).toLocaleString("es-ES")}</dd>
              </div>
            </dl>
            <div className="mt-4">
              <label className="text-xs font-medium text-gray-600">Cambiar estado</label>
              <div className="flex flex-wrap gap-2 mt-2">
                {ESTADOS.map((e) => (
                  <button key={e} onClick={() => cambiarEstado(modalDetalle.id, e)}
                    className={`rounded-full px-3 py-1 text-xs font-medium border ${modalDetalle.estado === e ? "ring-2 ring-offset-1 ring-gray-400" : ""} ${ESTADO_BADGE[e]}`}>
                    {e}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
