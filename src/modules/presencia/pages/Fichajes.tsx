import { useEffect, useState } from "react";
import PresenciaMenu from "../components/PresenciaMenu";
import { supabase } from "../services/supabase";

type Record_ = {
  id: string;
  employee_id: string;
  fecha: string;
  hora_entrada: string | null;
  hora_salida: string | null;
  tipo: string;
  observaciones: string | null;
  validado: boolean;
  sea_employees: { nombre: string; apellidos: string; cargo: string | null; departamento: string | null } | null;
};

const TIPOS = ["normal", "turno", "guardia", "extra"];

function fmt(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function duracion(entrada: string | null, salida: string | null): string {
  if (!entrada || !salida) return "";
  const mins = Math.round((new Date(salida).getTime() - new Date(entrada).getTime()) / 60000);
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

export default function Fichajes() {
  const hoy = new Date().toISOString().slice(0, 10);
  const hace7 = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);

  const [registros, setRegistros] = useState<Record_[]>([]);
  const [empleados, setEmpleados] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtroEmp, setFiltroEmp] = useState("");
  const [filtroDesde, setFiltroDesde] = useState(hace7);
  const [filtroHasta, setFiltroHasta] = useState(hoy);
  const [filtroTipo, setFiltroTipo] = useState("");
  const [soloNoValidados, setSoloNoValidados] = useState(false);
  const [modal, setModal] = useState(false);
  const [editRec, setEditRec] = useState<Record_ | null>(null);
  const [form, setForm] = useState<any>({});
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState("");

  useEffect(() => {
    cargar();
    supabase.from("sea_employees").select("id, nombre, apellidos").eq("activo", true).order("nombre")
      .then(({ data }) => setEmpleados(data ?? []));
  }, [filtroDesde, filtroHasta]);

  async function cargar() {
    setCargando(true);
    let q = supabase.from("pres_records")
      .select("*, sea_employees(nombre, apellidos, cargo, departamento)")
      .gte("fecha", filtroDesde)
      .lte("fecha", filtroHasta)
      .order("fecha", { ascending: false })
      .order("hora_entrada", { ascending: true });
    const { data } = await q;
    setRegistros(data ?? []);
    setCargando(false);
  }

  const filtrados = registros.filter((r) => {
    if (filtroEmp && r.employee_id !== filtroEmp) return false;
    if (filtroTipo && r.tipo !== filtroTipo) return false;
    if (soloNoValidados && r.validado) return false;
    return true;
  });

  function abrirEditar(r: Record_) {
    setEditRec(r);
    setForm({
      fecha:        r.fecha,
      hora_entrada: r.hora_entrada ? new Date(r.hora_entrada).toISOString().slice(11, 16) : "",
      hora_salida:  r.hora_salida  ? new Date(r.hora_salida).toISOString().slice(11, 16)  : "",
      tipo:         r.tipo,
      observaciones: r.observaciones ?? "",
      validado:     r.validado,
    });
    setModal(true);
  }

  function abrirNuevo() {
    setEditRec(null);
    setForm({ employee_id: "", fecha: hoy, hora_entrada: "", hora_salida: "", tipo: "normal", observaciones: "", validado: false });
    setModal(true);
  }

  function toTimestamp(fecha: string, hora: string): string | null {
    if (!hora) return null;
    return new Date(`${fecha}T${hora}:00`).toISOString();
  }

  async function guardar() {
    setGuardando(true);
    const payload = {
      fecha:        form.fecha,
      hora_entrada: toTimestamp(form.fecha, form.hora_entrada),
      hora_salida:  toTimestamp(form.fecha, form.hora_salida),
      tipo:         form.tipo,
      observaciones: form.observaciones || null,
      validado:     form.validado,
    };
    if (editRec) {
      await supabase.from("pres_records").update(payload).eq("id", editRec.id);
    } else {
      await supabase.from("pres_records").insert({ ...payload, employee_id: form.employee_id });
    }
    setGuardando(false);
    setModal(false);
    setMensaje("Guardado correctamente.");
    setTimeout(() => setMensaje(""), 3000);
    cargar();
  }

  async function validar(id: string, validado: boolean) {
    await supabase.from("pres_records").update({ validado }).eq("id", id);
    cargar();
  }

  async function eliminar(id: string) {
    if (!confirm("¿Eliminar este registro?")) return;
    await supabase.from("pres_records").delete().eq("id", id);
    cargar();
  }

  return (
    <div className="p-6 space-y-4">
      <PresenciaMenu />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Fichajes</h1>
          <p className="text-sm text-gray-500">{filtrados.length} registros</p>
        </div>
        <button onClick={abrirNuevo}
          className="rounded-xl bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-900">
          + Añadir registro
        </button>
      </div>

      {mensaje && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{mensaje}</p>}

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 items-center">
        <select value={filtroEmp} onChange={(e) => setFiltroEmp(e.target.value)}
          className="rounded-lg border px-3 py-2 text-sm w-52">
          <option value="">Todos los empleados</option>
          {empleados.map((e) => (
            <option key={e.id} value={e.id}>{e.nombre} {e.apellidos}</option>
          ))}
        </select>
        <input type="date" value={filtroDesde} onChange={(e) => setFiltroDesde(e.target.value)}
          className="rounded-lg border px-3 py-2 text-sm" />
        <span className="text-gray-400 text-sm">—</span>
        <input type="date" value={filtroHasta} onChange={(e) => setFiltroHasta(e.target.value)}
          className="rounded-lg border px-3 py-2 text-sm" />
        <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}
          className="rounded-lg border px-3 py-2 text-sm">
          <option value="">Todos los tipos</option>
          {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={soloNoValidados} onChange={(e) => setSoloNoValidados(e.target.checked)} />
          Sin validar
        </label>
        <button onClick={() => { setFiltroDesde(hace7); setFiltroHasta(hoy); setFiltroEmp(""); setFiltroTipo(""); setSoloNoValidados(false); }}
          className="rounded-lg border px-3 py-2 text-sm text-gray-500 hover:bg-gray-50">
          Limpiar
        </button>
      </div>

      {cargando ? (
        <div className="py-10 text-center text-gray-400">Cargando...</div>
      ) : (
        <div className="overflow-auto rounded-xl border bg-white">
          <table className="w-full min-w-[750px] text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="p-3">Empleado</th>
                <th className="p-3">Fecha</th>
                <th className="p-3">Entrada</th>
                <th className="p-3">Salida</th>
                <th className="p-3">Duración</th>
                <th className="p-3">Tipo</th>
                <th className="p-3">Estado</th>
                <th className="p-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((r) => {
                const emp = r.sea_employees;
                const dur = duracion(r.hora_entrada, r.hora_salida);
                return (
                  <tr key={r.id} className="border-t hover:bg-gray-50">
                    <td className="p-3">
                      <div className="font-medium">{emp?.nombre} {emp?.apellidos}</div>
                      {emp?.departamento && <div className="text-xs text-gray-400">{emp.departamento}</div>}
                    </td>
                    <td className="p-3 text-gray-600">
                      {new Date(r.fecha + "T12:00:00").toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })}
                    </td>
                    <td className="p-3 font-mono text-sm">{fmt(r.hora_entrada)}</td>
                    <td className="p-3 font-mono text-sm">{fmt(r.hora_salida)}</td>
                    <td className="p-3 text-gray-500 text-xs">{dur || "—"}</td>
                    <td className="p-3">
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs capitalize">{r.tipo}</span>
                    </td>
                    <td className="p-3">
                      {r.hora_entrada && !r.hora_salida ? (
                        <span className="rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-xs font-medium flex items-center gap-1 w-fit">
                          <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />Presente
                        </span>
                      ) : r.hora_entrada && r.hora_salida ? (
                        r.validado
                          ? <span className="rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-xs font-medium">✓ Validado</span>
                          : <span className="rounded-full bg-gray-100 text-gray-600 px-2 py-0.5 text-xs">Completado</span>
                      ) : (
                        <span className="rounded-full bg-orange-100 text-orange-700 px-2 py-0.5 text-xs">Sin entrada</span>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex gap-1">
                        {!r.validado && r.hora_salida && (
                          <button onClick={() => validar(r.id, true)}
                            className="rounded-lg bg-blue-50 text-blue-700 px-2 py-1 text-xs hover:bg-blue-100">✓</button>
                        )}
                        {r.validado && (
                          <button onClick={() => validar(r.id, false)}
                            className="rounded-lg bg-gray-100 px-2 py-1 text-xs hover:bg-gray-200">↩</button>
                        )}
                        <button onClick={() => abrirEditar(r)}
                          className="rounded-lg bg-gray-100 px-2 py-1 text-xs hover:bg-gray-200">Editar</button>
                        <button onClick={() => eliminar(r.id)}
                          className="rounded-lg bg-red-50 px-2 py-1 text-xs text-red-600 hover:bg-red-100">✕</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtrados.length === 0 && (
                <tr><td colSpan={8} className="p-8 text-center text-gray-400">Sin fichajes para estos filtros.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal editar / crear */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <h2 className="text-lg font-bold">{editRec ? "Editar fichaje" : "Nuevo fichaje"}</h2>

            {!editRec && (
              <div>
                <label className="text-xs font-medium text-gray-600">Empleado *</label>
                <select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                  <option value="">Selecciona...</option>
                  {empleados.map((e) => (
                    <option key={e.id} value={e.id}>{e.nombre} {e.apellidos}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-gray-600">Fecha</label>
              <input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Hora entrada</label>
                <input type="time" value={form.hora_entrada} onChange={(e) => setForm({ ...form, hora_entrada: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Hora salida</label>
                <input type="time" value={form.hora_salida} onChange={(e) => setForm({ ...form, hora_salida: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600">Tipo</label>
              <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600">Observaciones</label>
              <textarea value={form.observaciones} onChange={(e) => setForm({ ...form, observaciones: e.target.value })}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" rows={2} />
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.validado} onChange={(e) => setForm({ ...form, validado: e.target.checked })} />
              Marcar como validado
            </label>

            <div className="flex gap-2 justify-end">
              <button onClick={() => setModal(false)} className="rounded-xl border px-4 py-2 text-sm font-semibold">Cancelar</button>
              <button onClick={guardar} disabled={guardando}
                className="rounded-xl bg-gray-800 px-4 py-2 text-sm font-bold text-white hover:bg-gray-900 disabled:opacity-50">
                {guardando ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
