import { useEffect, useState } from "react";
import ToolControlMenu from "../components/ToolControlMenu";
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
    <div className="p-6 space-y-4">
      <ToolControlMenu />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Mantenimiento</h1>
          <p className="text-sm text-gray-500">Planes y registro de mantenimientos</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setForm({ nombre: "", frecuencia: "mensual", frecuencia_dias: "", tool_id: "", descripcion: "" }); setError(""); setModal(true); }}
            className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-gray-50">
            + Plan
          </button>
          <button onClick={() => { setFormLog({ tipo: "preventivo", descripcion: "", coste: "", tool_id: "" }); setError(""); setModalLog(true); }}
            className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600">
            + Registrar mantenimiento
          </button>
        </div>
      </div>

      {mensaje && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{mensaje}</p>}

      <div className="flex gap-2 border-b">
        {(["planes", "historial"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            {t === "planes" ? "Planes activos" : "Historial"}
          </button>
        ))}
      </div>

      {cargando ? (
        <div className="py-10 text-center text-gray-400">Cargando...</div>
      ) : tab === "planes" ? (
        <div className="overflow-auto rounded-xl border bg-white">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="bg-gray-50 text-left">
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
                  <tr key={p.id} className="border-t hover:bg-gray-50">
                    <td className="p-3">
                      <div className="font-medium">{p.nombre}</div>
                      {p.descripcion && <div className="text-xs text-gray-400">{p.descripcion}</div>}
                    </td>
                    <td className="p-3">{(p.tc_tools as any)?.nombre ?? (p.tc_machines as any)?.nombre ?? "—"}</td>
                    <td className="p-3 text-gray-500">{p.frecuencia}</td>
                    <td className="p-3">
                      {dias === null ? <span className="text-gray-400">—</span> : (
                        <span className={`text-xs font-semibold ${dias < 0 ? "text-red-600" : dias < 7 ? "text-orange-600" : "text-gray-500"}`}>
                          {dias < 0 ? `Vencida (${Math.abs(dias)}d)` : dias === 0 ? "Hoy" : `En ${dias} días`}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {planes.length === 0 && (
                <tr><td colSpan={4} className="p-8 text-center text-gray-400">Sin planes de mantenimiento.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-auto rounded-xl border bg-white">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="bg-gray-50 text-left">
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
                <tr key={l.id} className="border-t hover:bg-gray-50">
                  <td className="p-3 text-xs text-gray-500 whitespace-nowrap">
                    {new Date(l.fecha).toLocaleString("es-ES")}
                  </td>
                  <td className="p-3">{(l.tc_tools as any)?.nombre ?? "—"}</td>
                  <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${l.tipo === "preventivo" ? "bg-blue-100 text-blue-800" : "bg-orange-100 text-orange-800"}`}>{l.tipo}</span></td>
                  <td className="p-3">{(l.sea_employees as any)?.nombre ?? "—"}</td>
                  <td className="p-3">{l.coste != null ? `${l.coste.toFixed(2)} €` : "—"}</td>
                  <td className="p-3"><span className="rounded-full bg-green-100 text-green-800 px-2 py-0.5 text-xs">{l.estado}</span></td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr><td colSpan={6} className="p-8 text-center text-gray-400">Sin registros.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal plan */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-4">Nuevo plan de mantenimiento</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Nombre *</label>
                <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">Frecuencia</label>
                  <select value={form.frecuencia} onChange={(e) => setForm({ ...form, frecuencia: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                    {["diario","semanal","mensual","anual","personalizado"].map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                {form.frecuencia === "personalizado" && (
                  <div>
                    <label className="text-xs font-medium text-gray-600">Días</label>
                    <input type="number" value={form.frecuencia_dias} onChange={(e) => setForm({ ...form, frecuencia_dias: e.target.value })}
                      className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Herramienta *</label>
                <select value={form.tool_id} onChange={(e) => setForm({ ...form, tool_id: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                  <option value="">Seleccionar...</option>
                  {herramientas.map((h) => <option key={h.id} value={h.id}>{h.nombre} ({h.codigo})</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Descripción / Checklist</label>
                <textarea value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" rows={3} />
              </div>
            </div>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <div className="mt-5 flex gap-2 justify-end">
              <button onClick={() => setModal(false)} className="rounded-xl border px-4 py-2 text-sm font-semibold">Cancelar</button>
              <button onClick={crearPlan} disabled={guardando} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {guardando ? "Guardando..." : "Crear plan"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal log */}
      {modalLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-4">Registrar mantenimiento</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">Tipo</label>
                  <select value={formLog.tipo} onChange={(e) => setFormLog({ ...formLog, tipo: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                    {["preventivo","correctivo","revision"].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Coste (€)</label>
                  <input type="number" value={formLog.coste} onChange={(e) => setFormLog({ ...formLog, coste: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Herramienta</label>
                <select value={formLog.tool_id} onChange={(e) => setFormLog({ ...formLog, tool_id: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                  <option value="">Sin asociar</option>
                  {herramientas.map((h) => <option key={h.id} value={h.id}>{h.nombre} ({h.codigo})</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Descripción</label>
                <textarea value={formLog.descripcion} onChange={(e) => setFormLog({ ...formLog, descripcion: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" rows={3} />
              </div>
            </div>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <div className="mt-5 flex gap-2 justify-end">
              <button onClick={() => setModalLog(false)} className="rounded-xl border px-4 py-2 text-sm font-semibold">Cancelar</button>
              <button onClick={registrarMantenimiento} disabled={guardando} className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {guardando ? "Guardando..." : "Registrar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
