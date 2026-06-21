import { useEffect, useState } from "react";
import SafetyMenu from "../components/SafetyMenu";
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
  entregado:    "bg-blue-100 text-blue-800",
  devuelto:     "bg-green-100 text-green-800",
  perdido:      "bg-red-100 text-red-800",
  dado_de_baja: "bg-gray-200 text-gray-600",
  pendiente:    "bg-yellow-100 text-yellow-800",
};

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
    <div className="p-6 space-y-4">
      <SafetyMenu />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Entregas de EPIs</h1>
          <p className="text-sm text-gray-500">{filtrados.length} registros</p>
        </div>
        <button onClick={() => { setForm({ epi_id: "", employee_id: "", cantidad: "1", talla: "", fecha_caducidad: "", observaciones: "" }); setError(""); setModal(true); }}
          className="rounded-xl bg-yellow-500 px-4 py-2 text-sm font-semibold text-white hover:bg-yellow-600">
          + Nueva entrega
        </button>
      </div>

      {mensaje && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{mensaje}</p>}

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <input value={filtroTexto} onChange={(e) => setFiltroTexto(e.target.value)}
          placeholder="Buscar EPI o empleado..." className="rounded-lg border px-3 py-2 text-sm w-56" />
        <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} className="rounded-lg border px-3 py-2 text-sm">
          <option value="">Todos los estados</option>
          <option value="entregado">Entregado</option>
          <option value="devuelto">Devuelto</option>
          <option value="perdido">Perdido</option>
          <option value="dado_de_baja">Dado de baja</option>
        </select>
        {(filtroEstado || filtroTexto) && (
          <button onClick={() => { setFiltroEstado(""); setFiltroTexto(""); }}
            className="rounded-lg border px-3 py-2 text-sm text-gray-500 hover:bg-gray-50">Limpiar</button>
        )}
      </div>

      {cargando ? <div className="py-10 text-center text-gray-400">Cargando...</div> : (
        <div className="overflow-auto rounded-xl border bg-white">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-gray-50 text-left">
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
                  <tr key={e.id} className="border-t hover:bg-gray-50">
                    <td className="p-3 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(e.fecha_entrega).toLocaleDateString("es-ES")}
                    </td>
                    <td className="p-3">
                      <div className="font-medium">{(e.sm_epis as any)?.nombre ?? "—"}</div>
                      <div className="text-xs text-gray-400">{(e.sm_epis as any)?.codigo ?? ""}</div>
                    </td>
                    <td className="p-3">{(e.sea_employees as any)?.nombre ?? "—"}</td>
                    <td className="p-3 text-center">{e.cantidad}</td>
                    <td className="p-3 text-gray-500">{e.talla ?? "—"}</td>
                    <td className="p-3">
                      {caduca === null ? <span className="text-gray-400">—</span> : (
                        <span className={`text-xs font-semibold ${caduca < 0 ? "text-red-600" : caduca < 30 ? "text-orange-600" : "text-gray-500"}`}>
                          {caduca < 0 ? `Caducado (${Math.abs(caduca)}d)` : caduca === 0 ? "Hoy" : `${caduca}d`}
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_BADGE[e.estado] ?? "bg-gray-100"}`}>
                        {e.estado}
                      </span>
                    </td>
                    <td className="p-3">
                      {e.estado === "entregado" && (
                        <button onClick={() => cambiarEstado(e.id, "devuelto")}
                          className="rounded-lg bg-green-50 px-2 py-1 text-xs text-green-700 hover:bg-green-100">
                          Devolver
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtrados.length === 0 && (
                <tr><td colSpan={8} className="p-8 text-center text-gray-400">Sin entregas registradas.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal nueva entrega */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-4">Nueva entrega de EPI</h2>
            <div className="space-y-3">
              <div><label className="text-xs font-medium text-gray-600">EPI *</label>
                <select value={form.epi_id} onChange={(e) => setForm({ ...form, epi_id: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                  <option value="">Seleccionar EPI...</option>
                  {epis.map((e) => (
                    <option key={e.id} value={e.id}>{e.nombre} ({e.codigo}) — stock: {e.stock_actual}</option>
                  ))}
                </select></div>
              <div><label className="text-xs font-medium text-gray-600">Empleado *</label>
                <select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                  <option value="">Seleccionar empleado...</option>
                  {empleados.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                </select></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-gray-600">Cantidad</label>
                  <input type="number" min="1" value={form.cantidad} onChange={(e) => setForm({ ...form, cantidad: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
                <div><label className="text-xs font-medium text-gray-600">Talla</label>
                  <input value={form.talla} onChange={(e) => setForm({ ...form, talla: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" placeholder="M / 42 / Única" /></div>
              </div>
              <div><label className="text-xs font-medium text-gray-600">Fecha caducidad EPI</label>
                <input type="date" value={form.fecha_caducidad} onChange={(e) => setForm({ ...form, fecha_caducidad: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
              <div><label className="text-xs font-medium text-gray-600">Observaciones</label>
                <textarea value={form.observaciones} onChange={(e) => setForm({ ...form, observaciones: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" rows={2} /></div>
            </div>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <div className="mt-5 flex gap-2 justify-end">
              <button onClick={() => setModal(false)} className="rounded-xl border px-4 py-2 text-sm font-semibold">Cancelar</button>
              <button onClick={crear} disabled={guardando}
                className="rounded-xl bg-yellow-500 px-4 py-2 text-sm font-semibold text-white hover:bg-yellow-600 disabled:opacity-50">
                {guardando ? "Guardando..." : "Registrar entrega"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
