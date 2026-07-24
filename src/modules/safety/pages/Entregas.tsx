import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import SafetyLayout from "../components/SafetyLayout";
import { supabase } from "../services/supabase";

type Entrega = {
  id: string;
  cantidad: number;
  talla: string | null;
  estado: string;
  fecha_entrega: string;
  fecha_devolucion: string | null;
  fecha_caducidad: string | null;
  observaciones: string | null;
  sm_epis: { nombre: string; codigo: string } | null;
  sea_employees: { nombre: string } | null;
  entregado_por: { nombre: string } | null;
};

const ESTADO_BADGE: Record<string, string> = {
  entregado:    "border-sky-500/30 bg-sky-500/15 text-sky-300",
  devuelto:     "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
  perdido:      "border-red-500/30 bg-red-500/15 text-red-300",
  dado_de_baja: "border-slate-500/30 bg-slate-500/20 text-slate-300",
  pendiente:    "border-amber-500/30 bg-amber-500/15 text-amber-300",
};

const FIELD = "rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/40";
const INPUT = `w-full ${FIELD}`;
const LABEL = "text-xs font-medium text-slate-400";

export default function Entregas() {
  const [items, setItems] = useState<Entrega[]>([]);
  const [epis, setEpis] = useState<any[]>([]);
  const [empleados, setEmpleados] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtroEstado, setFiltroEstado] = useState("");
  const [filtroTexto, setFiltroTexto] = useState("");
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ epi_id: "", employee_id: "", cantidad: "1", talla: "", fecha_caducidad: "", observaciones: "" });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  useEffect(() => { cargar(); }, []);

  async function cargar() {
    setCargando(true);
    const [{ data: entregas }, { data: episData }, { data: emps }] = await Promise.all([
      supabase.from("sm_epi_assignments")
        .select(`id, cantidad, talla, estado, fecha_entrega, fecha_devolucion, fecha_caducidad, observaciones,
          sm_epis(nombre, codigo),
          sea_employees!sm_epi_assignments_employee_id_fkey(nombre),
          entregado_por:sea_employees!sm_epi_assignments_entregado_por_fkey(nombre)`)
        .order("fecha_entrega", { ascending: false })
        .limit(200),
      supabase.from("sm_epis").select("id, nombre, codigo, stock_actual").eq("activo", true).order("nombre"),
      supabase.from("sea_employees").select("id, nombre").eq("activo", true).order("nombre"),
    ]);
    setItems((entregas ?? []) as any);
    setEpis(episData ?? []);
    setEmpleados(emps ?? []);
    setCargando(false);
  }

  const filtrados = items.filter((e) => {
    if (filtroEstado && e.estado !== filtroEstado) return false;
    if (filtroTexto.trim()) {
      const t = filtroTexto.toLowerCase();
      const campos = [(e.sm_epis as any)?.nombre, (e.sea_employees as any)?.nombre, (e.sm_epis as any)?.codigo].join(" ").toLowerCase();
      if (!campos.includes(t)) return false;
    }
    return true;
  });

  async function crear() {
    if (!form.epi_id || !form.employee_id) { setError("EPI y empleado son obligatorios."); return; }
    setGuardando(true);
    const epi = epis.find((e) => e.id === form.epi_id);
    if (epi && epi.stock_actual < Number(form.cantidad)) {
      setError(`Stock insuficiente. Stock actual: ${epi.stock_actual}`);
      setGuardando(false);
      return;
    }
    // Insertar entrega
    const { error: err } = await supabase.from("sm_epi_assignments").insert({
      epi_id:        form.epi_id,
      employee_id:   form.employee_id,
      cantidad:      Number(form.cantidad) || 1,
      talla:         form.talla || null,
      fecha_caducidad: form.fecha_caducidad || null,
      observaciones: form.observaciones || null,
      estado:        "entregado",
      tipo_entrega:  "directa",
    });
    if (!err && epi) {
      // Registrar movimiento de stock
      await supabase.from("sm_epi_stock_movements").insert({
        epi_id:        form.epi_id,
        tipo:          "entrega",
        cantidad:      -Number(form.cantidad),
        stock_antes:   epi.stock_actual,
        stock_despues: epi.stock_actual - Number(form.cantidad),
      });
    }
    setGuardando(false);
    if (err) { setError(err.message); return; }
    setMensaje("Entrega registrada.");
    setModal(false);
    setTimeout(() => setMensaje(""), 3000);
    cargar();
  }

  async function cambiarEstado(id: string, estado: string) {
    const extra: any = {};
    if (estado === "devuelto") extra.fecha_devolucion = new Date().toISOString();
    await supabase.from("sm_epi_assignments").update({ estado, ...extra }).eq("id", id);
    cargar();
  }

  return (
    <SafetyLayout
      title="Entregas de EPIs"
      subtitle={`${filtrados.length} registros`}
      actions={
        <button onClick={() => { setForm({ epi_id: "", employee_id: "", cantidad: "1", talla: "", fecha_caducidad: "", observaciones: "" }); setError(""); setModal(true); }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-bold text-amber-950 hover:bg-amber-400">
          <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Nueva entrega</span>
        </button>
      }
    >
      {mensaje && (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/15 p-3 text-sm text-emerald-300">{mensaje}</p>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <input value={filtroTexto} onChange={(e) => setFiltroTexto(e.target.value)}
          placeholder="Buscar EPI o empleado..." className={`w-56 ${FIELD}`} />
        <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} className={FIELD}>
          <option value="">Todos los estados</option>
          <option value="entregado">Entregado</option>
          <option value="devuelto">Devuelto</option>
          <option value="perdido">Perdido</option>
          <option value="dado_de_baja">Dado de baja</option>
        </select>
        {(filtroEstado || filtroTexto) && (
          <button onClick={() => { setFiltroEstado(""); setFiltroTexto(""); }}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700">Limpiar</button>
        )}
      </div>

      {cargando ? <div className="py-10 text-center text-slate-500">Cargando...</div> : (
        <div className="overflow-auto rounded-xl border border-slate-700 bg-slate-800 shadow-sm">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-950/60 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="p-3">Fecha</th>
                <th className="p-3">EPI</th>
                <th className="p-3">Empleado</th>
                <th className="p-3">Cantidad</th>
                <th className="p-3">Talla</th>
                <th className="p-3">Caducidad EPI</th>
                <th className="p-3">Estado</th>
                <th className="p-3">Acción</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((e) => {
                const caduca = e.fecha_caducidad
                  ? Math.ceil((new Date(e.fecha_caducidad).getTime() - Date.now()) / 86400000)
                  : null;
                return (
                  <tr key={e.id} className="border-t border-slate-700/70 hover:bg-slate-700/40">
                    <td className="whitespace-nowrap p-3 text-xs text-slate-400">
                      {new Date(e.fecha_entrega).toLocaleDateString("es-ES")}
                    </td>
                    <td className="p-3">
                      <div className="font-medium text-slate-100">{(e.sm_epis as any)?.nombre ?? "—"}</div>
                      <div className="text-xs text-slate-500">{(e.sm_epis as any)?.codigo ?? ""}</div>
                    </td>
                    <td className="p-3 text-slate-200">{(e.sea_employees as any)?.nombre ?? "—"}</td>
                    <td className="p-3 text-center text-slate-200">{e.cantidad}</td>
                    <td className="p-3 text-slate-400">{e.talla ?? "—"}</td>
                    <td className="p-3">
                      {caduca === null ? <span className="text-slate-500">—</span> : (
                        <span className={`text-xs font-semibold ${caduca < 0 ? "text-red-400" : caduca < 30 ? "text-orange-400" : "text-slate-400"}`}>
                          {caduca < 0 ? `Caducado (${Math.abs(caduca)}d)` : caduca === 0 ? "Hoy" : `${caduca}d`}
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${ESTADO_BADGE[e.estado] ?? "border-slate-500/30 bg-slate-500/15 text-slate-300"}`}>
                        {e.estado}
                      </span>
                    </td>
                    <td className="p-3">
                      {e.estado === "entregado" && (
                        <button onClick={() => cambiarEstado(e.id, "devuelto")}
                          className="rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/25">
                          Devolver
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtrados.length === 0 && (
                <tr><td colSpan={8} className="p-8 text-center text-slate-500">Sin entregas registradas.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal nueva entrega */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold text-slate-100">Nueva entrega de EPI</h2>
            <div className="space-y-3">
              <div><label className={LABEL}>EPI *</label>
                <select value={form.epi_id} onChange={(e) => setForm({ ...form, epi_id: e.target.value })}
                  className={`mt-1 ${INPUT}`}>
                  <option value="">Seleccionar EPI...</option>
                  {epis.map((e) => (
                    <option key={e.id} value={e.id}>{e.nombre} ({e.codigo}) — stock: {e.stock_actual}</option>
                  ))}
                </select></div>
              <div><label className={LABEL}>Empleado *</label>
                <select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
                  className={`mt-1 ${INPUT}`}>
                  <option value="">Seleccionar empleado...</option>
                  {empleados.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                </select></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={LABEL}>Cantidad</label>
                  <input type="number" min="1" value={form.cantidad} onChange={(e) => setForm({ ...form, cantidad: e.target.value })}
                    className={`mt-1 ${INPUT}`} /></div>
                <div><label className={LABEL}>Talla</label>
                  <input value={form.talla} onChange={(e) => setForm({ ...form, talla: e.target.value })}
                    className={`mt-1 ${INPUT}`} placeholder="M / 42 / Única" /></div>
              </div>
              <div><label className={LABEL}>Fecha caducidad EPI</label>
                <input type="date" value={form.fecha_caducidad} onChange={(e) => setForm({ ...form, fecha_caducidad: e.target.value })}
                  className={`mt-1 ${INPUT}`} /></div>
              <div><label className={LABEL}>Observaciones</label>
                <textarea value={form.observaciones} onChange={(e) => setForm({ ...form, observaciones: e.target.value })}
                  className={`mt-1 resize-none ${INPUT}`} rows={2} /></div>
            </div>
            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setModal(false)}
                className="rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-600">Cancelar</button>
              <button onClick={crear} disabled={guardando}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-amber-950 hover:bg-amber-400 disabled:opacity-50">
                {guardando ? "Guardando..." : "Registrar entrega"}
              </button>
            </div>
          </div>
        </div>
      )}
    </SafetyLayout>
  );
}
