import { useEffect, useState } from "react";
import ToolControlLayout from "../components/ToolControlLayout";
import { supabase } from "../services/supabase";

type Plan = {
  id: string;
  nombre: string;
  frecuencia: string;
  frecuencia_dias: number | null;
  descripcion: string | null;
  proxima_revision: string | null;
  activo: boolean;
  tc_tools: { nombre: string; codigo: string } | null;
  tc_machines: { nombre: string; codigo: string } | null;
};

type Log = {
  id: string;
  tipo: string;
  fecha: string;
  descripcion: string | null;
  coste: number | null;
  estado: string;
  tc_tools: { nombre: string } | null;
  sea_employees: { nombre: string } | null;
};

const FIELD = "rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/40";
const INPUT = `w-full ${FIELD}`;
const LABEL = "text-xs font-medium text-slate-400";

export default function Mantenimiento() {
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [herramientas, setHerramientas] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [tab, setTab] = useState<"planes" | "historial">("planes");
  const [modal, setModal] = useState(false);
  const [modalLog, setModalLog] = useState(false);
  const [form, setForm] = useState({ nombre: "", frecuencia: "mensual", frecuencia_dias: "", tool_id: "", descripcion: "" });
  const [formLog, setFormLog] = useState({ tipo: "preventivo", descripcion: "", coste: "", tool_id: "" });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  useEffect(() => { cargar(); }, []);

  async function cargar() {
    setCargando(true);
    const [{ data: p }, { data: l }, { data: herr }] = await Promise.all([
      supabase
        .from("tc_maintenance_plans")
        .select("id, nombre, frecuencia, frecuencia_dias, descripcion, proxima_revision, activo, tc_tools(nombre, codigo), tc_machines(nombre, codigo)")
        .eq("activo", true)
        .order("proxima_revision", { ascending: true }),
      supabase
        .from("tc_maintenance_logs")
        .select("id, tipo, fecha, descripcion, coste, estado, tc_tools(nombre), sea_employees(nombre)")
        .order("fecha", { ascending: false })
        .limit(100),
      supabase.from("tc_tools").select("id, nombre, codigo").eq("activa", true).order("nombre"),
    ]);
    setPlanes((p ?? []) as any);
    setLogs((l ?? []) as any);
    setHerramientas(herr ?? []);
    setCargando(false);
  }

  async function crearPlan() {
    if (!form.nombre.trim() || !form.tool_id) { setError("Nombre y herramienta son obligatorios."); return; }
    setGuardando(true);
    const { error: err } = await supabase.from("tc_maintenance_plans").insert({
      nombre:          form.nombre.trim(),
      frecuencia:      form.frecuencia,
      frecuencia_dias: form.frecuencia_dias ? parseInt(form.frecuencia_dias) : null,
      tool_id:         form.tool_id,
      descripcion:     form.descripcion || null,
    });
    setGuardando(false);
    if (err) { setError(err.message); return; }
    setMensaje("Plan creado.");
    setModal(false);
    setTimeout(() => setMensaje(""), 3000);
    cargar();
  }

  async function registrarMantenimiento() {
    if (!form.tool_id) { setError("Selecciona una herramienta."); return; }
    setGuardando(true);
    const { error: err } = await supabase.from("tc_maintenance_logs").insert({
      tipo:         formLog.tipo,
      descripcion:  formLog.descripcion || null,
      coste:        formLog.coste ? parseFloat(formLog.coste) : null,
      tool_id:      formLog.tool_id || null,
      fecha:        new Date().toISOString(),
      estado:       "completado",
    });
    setGuardando(false);
    if (err) { setError(err.message); return; }
    setMensaje("Mantenimiento registrado.");
    setModalLog(false);
    setTimeout(() => setMensaje(""), 3000);
    cargar();
  }

  return (
    <ToolControlLayout
      title="Mantenimiento"
      subtitle="Planes y registro de mantenimientos"
      actions={
        <div className="flex gap-2">
          <button onClick={() => { setForm({ nombre: "", frecuencia: "mensual", frecuencia_dias: "", tool_id: "", descripcion: "" }); setError(""); setModal(true); }}
            className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700">
            + Plan
          </button>
          <button onClick={() => { setFormLog({ tipo: "preventivo", descripcion: "", coste: "", tool_id: "" }); setError(""); setModalLog(true); }}
            className="rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-bold text-amber-950 hover:bg-amber-400">
            + <span className="hidden sm:inline">Registrar mantenimiento</span><span className="sm:hidden">Registrar</span>
          </button>
        </div>
      }
    >
      {mensaje && <p className="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">{mensaje}</p>}

      <div className="flex gap-2 border-b border-slate-800">
        {(["planes", "historial"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t ? "border-amber-500 text-amber-400" : "border-transparent text-slate-400 hover:text-slate-200"}`}>
            {t === "planes" ? "Planes activos" : "Historial"}
          </button>
        ))}
      </div>

      {cargando ? (
        <div className="py-10 text-center text-slate-500">Cargando...</div>
      ) : tab === "planes" ? (
        <div className="overflow-auto rounded-xl border border-slate-800 bg-slate-800/60">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="bg-slate-800 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="p-3">Plan</th>
                <th className="p-3">Herramienta</th>
                <th className="p-3">Frecuencia</th>
                <th className="p-3">Próxima revisión</th>
              </tr>
            </thead>
            <tbody>
              {planes.map((p) => {
                const dias = p.proxima_revision
                  ? Math.ceil((new Date(p.proxima_revision).getTime() - Date.now()) / 86400000)
                  : null;
                return (
                  <tr key={p.id} className="border-t border-slate-800 hover:bg-slate-800/50">
                    <td className="p-3">
                      <div className="font-medium text-slate-100">{p.nombre}</div>
                      {p.descripcion && <div className="text-xs text-slate-500">{p.descripcion}</div>}
                    </td>
                    <td className="p-3 text-slate-200">{(p.tc_tools as any)?.nombre ?? (p.tc_machines as any)?.nombre ?? "—"}</td>
                    <td className="p-3 text-slate-400">{p.frecuencia}</td>
                    <td className="p-3">
                      {dias === null ? <span className="text-slate-500">—</span> : (
                        <span className={`text-xs font-semibold ${dias < 0 ? "text-red-400" : dias < 7 ? "text-orange-400" : "text-slate-400"}`}>
                          {dias < 0 ? `Vencida (${Math.abs(dias)}d)` : dias === 0 ? "Hoy" : `En ${dias} días`}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {planes.length === 0 && (
                <tr><td colSpan={4} className="p-8 text-center text-slate-500">Sin planes de mantenimiento.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-auto rounded-xl border border-slate-800 bg-slate-800/60">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="bg-slate-800 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="p-3">Fecha</th>
                <th className="p-3">Herramienta</th>
                <th className="p-3">Tipo</th>
                <th className="p-3">Realizado por</th>
                <th className="p-3">Coste</th>
                <th className="p-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-t border-slate-800 hover:bg-slate-800/50">
                  <td className="p-3 text-xs text-slate-400 whitespace-nowrap">
                    {new Date(l.fecha).toLocaleString("es-ES")}
                  </td>
                  <td className="p-3 text-slate-200">{(l.tc_tools as any)?.nombre ?? "—"}</td>
                  <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${l.tipo === "preventivo" ? "bg-sky-500/15 text-sky-300" : "bg-orange-500/15 text-orange-300"}`}>{l.tipo}</span></td>
                  <td className="p-3 text-slate-200">{(l.sea_employees as any)?.nombre ?? "—"}</td>
                  <td className="p-3 text-slate-200">{l.coste != null ? `${l.coste.toFixed(2)} €` : "—"}</td>
                  <td className="p-3"><span className="rounded-full bg-emerald-500/15 text-emerald-300 px-2 py-0.5 text-xs">{l.estado}</span></td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr><td colSpan={6} className="p-8 text-center text-slate-500">Sin registros.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal plan */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-4 text-slate-100">Nuevo plan de mantenimiento</h2>
            <div className="space-y-3">
              <div>
                <label className={LABEL}>Nombre *</label>
                <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  className={`mt-1 ${INPUT}`} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>Frecuencia</label>
                  <select value={form.frecuencia} onChange={(e) => setForm({ ...form, frecuencia: e.target.value })}
                    className={`mt-1 ${INPUT}`}>
                    {["diario","semanal","mensual","anual","personalizado"].map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                {form.frecuencia === "personalizado" && (
                  <div>
                    <label className={LABEL}>Días</label>
                    <input type="number" value={form.frecuencia_dias} onChange={(e) => setForm({ ...form, frecuencia_dias: e.target.value })}
                      className={`mt-1 ${INPUT}`} />
                  </div>
                )}
              </div>
              <div>
                <label className={LABEL}>Herramienta *</label>
                <select value={form.tool_id} onChange={(e) => setForm({ ...form, tool_id: e.target.value })}
                  className={`mt-1 ${INPUT}`}>
                  <option value="">Seleccionar...</option>
                  {herramientas.map((h) => <option key={h.id} value={h.id}>{h.nombre} ({h.codigo})</option>)}
                </select>
              </div>
              <div>
                <label className={LABEL}>Descripción / Checklist</label>
                <textarea value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                  className={`mt-1 ${INPUT}`} rows={3} />
              </div>
            </div>
            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
            <div className="mt-5 flex gap-2 justify-end">
              <button onClick={() => setModal(false)} className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700">Cancelar</button>
              <button onClick={crearPlan} disabled={guardando} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-amber-950 hover:bg-amber-400 disabled:opacity-50">
                {guardando ? "Guardando..." : "Crear plan"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal log */}
      {modalLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-4 text-slate-100">Registrar mantenimiento</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>Tipo</label>
                  <select value={formLog.tipo} onChange={(e) => setFormLog({ ...formLog, tipo: e.target.value })}
                    className={`mt-1 ${INPUT}`}>
                    {["preventivo","correctivo","revision"].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className={LABEL}>Coste (€)</label>
                  <input type="number" value={formLog.coste} onChange={(e) => setFormLog({ ...formLog, coste: e.target.value })}
                    className={`mt-1 ${INPUT}`} />
                </div>
              </div>
              <div>
                <label className={LABEL}>Herramienta</label>
                <select value={formLog.tool_id} onChange={(e) => setFormLog({ ...formLog, tool_id: e.target.value })}
                  className={`mt-1 ${INPUT}`}>
                  <option value="">Sin asociar</option>
                  {herramientas.map((h) => <option key={h.id} value={h.id}>{h.nombre} ({h.codigo})</option>)}
                </select>
              </div>
              <div>
                <label className={LABEL}>Descripción</label>
                <textarea value={formLog.descripcion} onChange={(e) => setFormLog({ ...formLog, descripcion: e.target.value })}
                  className={`mt-1 ${INPUT}`} rows={3} />
              </div>
            </div>
            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
            <div className="mt-5 flex gap-2 justify-end">
              <button onClick={() => setModalLog(false)} className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700">Cancelar</button>
              <button onClick={registrarMantenimiento} disabled={guardando} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-amber-950 hover:bg-amber-400 disabled:opacity-50">
                {guardando ? "Guardando..." : "Registrar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ToolControlLayout>
  );
}
