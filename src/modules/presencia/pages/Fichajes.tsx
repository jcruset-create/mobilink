import { useEffect, useState } from "react";
import PresenciaLayout from "../components/PresenciaLayout";
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

const INPUT_CLS = "rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500";

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
    <PresenciaLayout
      title="Fichajes"
      subtitle={`${filtrados.length} registros`}
      actions={
        <button onClick={abrirNuevo}
          className="rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-bold text-amber-950 hover:bg-amber-400">
          + Añadir registro
        </button>
      }
    >
      {mensaje && (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/15 p-3 text-sm text-emerald-300">{mensaje}</p>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={filtroEmp} onChange={(e) => setFiltroEmp(e.target.value)}
          className={`${INPUT_CLS} w-52`}>
          <option value="">Todos los empleados</option>
          {empleados.map((e) => (
            <option key={e.id} value={e.id}>{e.nombre} {e.apellidos}</option>
          ))}
        </select>
        <input type="date" value={filtroDesde} onChange={(e) => setFiltroDesde(e.target.value)}
          className={INPUT_CLS} />
        <span className="text-sm text-slate-500">—</span>
        <input type="date" value={filtroHasta} onChange={(e) => setFiltroHasta(e.target.value)}
          className={INPUT_CLS} />
        <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}
          className={INPUT_CLS}>
          <option value="">Todos los tipos</option>
          {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={soloNoValidados} onChange={(e) => setSoloNoValidados(e.target.checked)} />
          Sin validar
        </label>
        <button onClick={() => { setFiltroDesde(hace7); setFiltroHasta(hoy); setFiltroEmp(""); setFiltroTipo(""); setSoloNoValidados(false); }}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700">
          Limpiar
        </button>
      </div>

      {cargando ? (
        <div className="flex h-40 items-center justify-center text-slate-500">Cargando...</div>
      ) : (
        <div className="overflow-auto rounded-xl border border-slate-800 bg-slate-950/60">
          <table className="w-full min-w-[750px] text-sm">
            <thead className="bg-slate-900 text-left text-slate-400">
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
                  <tr key={r.id} className="border-t border-slate-800 hover:bg-slate-800/50">
                    <td className="p-3">
                      <div className="font-medium">{emp?.nombre} {emp?.apellidos}</div>
                      {emp?.departamento && <div className="text-xs text-slate-500">{emp.departamento}</div>}
                    </td>
                    <td className="p-3 text-slate-400">
                      {new Date(r.fecha + "T12:00:00").toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })}
                    </td>
                    <td className="p-3 font-mono text-sm">{fmt(r.hora_entrada)}</td>
                    <td className="p-3 font-mono text-sm">{fmt(r.hora_salida)}</td>
                    <td className="p-3 text-xs text-slate-500">{dur || "—"}</td>
                    <td className="p-3">
                      <span className="rounded-full bg-slate-500/15 px-2 py-0.5 text-xs capitalize text-slate-300">{r.tipo}</span>
                    </td>
                    <td className="p-3">
                      {r.hora_entrada && !r.hora_salida ? (
                        <span className="flex w-fit items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />Presente
                        </span>
                      ) : r.hora_entrada && r.hora_salida ? (
                        r.validado
                          ? <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs font-medium text-sky-300">✓ Validado</span>
                          : <span className="rounded-full bg-slate-500/15 px-2 py-0.5 text-xs text-slate-400">Completado</span>
                      ) : (
                        <span className="rounded-full bg-orange-500/15 px-2 py-0.5 text-xs text-orange-300">Sin entrada</span>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex gap-1">
                        {!r.validado && r.hora_salida && (
                          <button onClick={() => validar(r.id, true)}
                            className="rounded-lg bg-sky-500/15 px-2 py-1 text-xs text-sky-300 hover:bg-sky-500/25">✓</button>
                        )}
                        {r.validado && (
                          <button onClick={() => validar(r.id, false)}
                            className="rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700">↩</button>
                        )}
                        <button onClick={() => abrirEditar(r)}
                          className="rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700">Editar</button>
                        <button onClick={() => eliminar(r.id)}
                          className="rounded-lg bg-red-500/15 px-2 py-1 text-xs text-red-300 hover:bg-red-500/25">✕</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtrados.length === 0 && (
                <tr><td colSpan={8} className="p-8 text-center text-slate-500">Sin fichajes para estos filtros.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal editar / crear */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
            <h2 className="text-lg font-bold">{editRec ? "Editar fichaje" : "Nuevo fichaje"}</h2>

            {!editRec && (
              <div>
                <label className="text-xs font-medium text-slate-400">Empleado *</label>
                <select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
                  className={`mt-1 w-full ${INPUT_CLS}`}>
                  <option value="">Selecciona...</option>
                  {empleados.map((e) => (
                    <option key={e.id} value={e.id}>{e.nombre} {e.apellidos}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-slate-400">Fecha</label>
              <input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })}
                className={`mt-1 w-full ${INPUT_CLS}`} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-400">Hora entrada</label>
                <input type="time" value={form.hora_entrada} onChange={(e) => setForm({ ...form, hora_entrada: e.target.value })}
                  className={`mt-1 w-full ${INPUT_CLS}`} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400">Hora salida</label>
                <input type="time" value={form.hora_salida} onChange={(e) => setForm({ ...form, hora_salida: e.target.value })}
                  className={`mt-1 w-full ${INPUT_CLS}`} />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-400">Tipo</label>
              <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}
                className={`mt-1 w-full ${INPUT_CLS}`}>
                {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-400">Observaciones</label>
              <textarea value={form.observaciones} onChange={(e) => setForm({ ...form, observaciones: e.target.value })}
                className={`mt-1 w-full ${INPUT_CLS}`} rows={2} />
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={form.validado} onChange={(e) => setForm({ ...form, validado: e.target.checked })} />
              Marcar como validado
            </label>

            <div className="flex justify-end gap-2">
              <button onClick={() => setModal(false)}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700">
                Cancelar
              </button>
              <button onClick={guardar} disabled={guardando}
                className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-amber-950 hover:bg-amber-400 disabled:opacity-50">
                {guardando ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PresenciaLayout>
  );
}
