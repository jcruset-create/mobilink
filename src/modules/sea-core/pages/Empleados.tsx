import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import CoreMenu from "../components/CoreMenu";
import { supabase } from "../../almacen-neumaticos/services/supabase";

type Empleado = {
  id: string;
  nombre: string;
  apellidos: string | null;
  dni_nie: string | null;
  telefono: string | null;
  email: string | null;
  cargo: string | null;
  departamento: string | null;
  rol: string;
  codigo_operario: string | null;
  activo: boolean;
  roadside_capable: boolean;
  fecha_alta: string | null;
  sea_companies: { nombre: string } | null;
  sea_work_centers: { nombre: string } | null;
};

const ROLES = ["admin", "responsable", "operario", "prl", "almacen"];

const ROL_BADGE: Record<string, string> = {
  admin:       "bg-red-100 text-red-800",
  responsable: "bg-orange-100 text-orange-800",
  operario:    "bg-blue-100 text-blue-800",
  prl:         "bg-purple-100 text-purple-800",
  almacen:     "bg-green-100 text-green-800",
};

const EMPTY = {
  nombre: "", apellidos: "", dni_nie: "", telefono: "", email: "",
  cargo: "", departamento: "", rol: "operario", codigo_operario: "",
  fecha_alta: "", activo: true, roadside_capable: false, company_id: "", work_center_id: "",
};

export default function Empleados() {
  const [items, setItems] = useState<Empleado[]>([]);
  const [empresas, setEmpresas] = useState<any[]>([]);
  const [centros, setCentros] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtroTexto, setFiltroTexto] = useState("");
  const [filtroRol, setFiltroRol] = useState("");
  const [filtroActivo, setFiltroActivo] = useState<"todos" | "activos" | "inactivos">("activos");
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<any>({ ...EMPTY });
  const [editId, setEditId] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  useEffect(() => { cargar(); }, []);

  async function cargar() {
    setCargando(true);
    const [{ data: emps }, { data: emp }, { data: cent }] = await Promise.all([
      supabase.from("sea_employees")
        .select("id, nombre, apellidos, dni_nie, telefono, email, cargo, departamento, rol, codigo_operario, activo, fecha_alta, sea_companies(nombre), sea_work_centers(nombre)")
        .order("nombre"),
      supabase.from("sea_companies").select("id, nombre").eq("activa", true).order("nombre"),
      supabase.from("sea_work_centers").select("id, nombre").eq("activo", true).order("nombre"),
    ]);
    setItems((emps ?? []) as any);
    setEmpresas(emp ?? []);
    setCentros(cent ?? []);
    setCargando(false);
  }

  const filtrados = items.filter((e) => {
    if (filtroRol && e.rol !== filtroRol) return false;
    if (filtroActivo === "activos" && !e.activo) return false;
    if (filtroActivo === "inactivos" && e.activo) return false;
    if (filtroTexto.trim()) {
      const t = filtroTexto.toLowerCase();
      const campos = [e.nombre, e.apellidos, e.email, e.codigo_operario, e.cargo, e.dni_nie].join(" ").toLowerCase();
      if (!campos.includes(t)) return false;
    }
    return true;
  });

  function abrirNuevo() {
    setForm({ ...EMPTY });
    setEditId(null);
    setError("");
    setModal(true);
  }

  function abrirEditar(e: Empleado) {
    setForm({
      nombre: e.nombre, apellidos: e.apellidos ?? "", dni_nie: e.dni_nie ?? "",
      telefono: e.telefono ?? "", email: e.email ?? "", cargo: e.cargo ?? "",
      departamento: e.departamento ?? "", rol: e.rol,
      codigo_operario: e.codigo_operario ?? "",
      fecha_alta: (e.fecha_alta ?? "").substring(0, 10),
      activo: e.activo,
      roadside_capable: e.roadside_capable ?? false,
      company_id: (e as any).company_id ?? "",
      work_center_id: (e as any).work_center_id ?? "",
    });
    setEditId(e.id);
    setError("");
    setModal(true);
  }

  async function guardar() {
    if (!form.nombre?.trim()) { setError("El nombre es obligatorio."); return; }
    setGuardando(true);
    const payload = {
      nombre:          form.nombre.trim(),
      apellidos:       form.apellidos || null,
      dni_nie:         form.dni_nie || null,
      telefono:        form.telefono || null,
      email:           form.email || null,
      cargo:           form.cargo || null,
      departamento:    form.departamento || null,
      rol:             form.rol,
      codigo_operario:  form.codigo_operario || null,
      fecha_alta:       form.fecha_alta || null,
      activo:           form.activo,
      roadside_capable: form.roadside_capable,
      company_id:       form.company_id || null,
      work_center_id:  form.work_center_id || null,
    };
    const { error: err } = editId
      ? await supabase.from("sea_employees").update(payload).eq("id", editId)
      : await supabase.from("sea_employees").insert(payload);
    setGuardando(false);
    if (err) { setError(err.message); return; }
    setMensaje(editId ? "Empleado actualizado." : "Empleado creado.");
    setModal(false);
    setTimeout(() => setMensaje(""), 3000);
    cargar();
  }

  return (
    <div className="p-6 space-y-4">
      <CoreMenu />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Empleados</h1>
          <p className="text-sm text-gray-500">{filtrados.length} empleados</p>
        </div>
        <button onClick={abrirNuevo}
          className="rounded-xl bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-900">
          + Nuevo empleado
        </button>
      </div>

      {mensaje && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{mensaje}</p>}

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 items-center">
        <input value={filtroTexto} onChange={(e) => setFiltroTexto(e.target.value)}
          placeholder="Buscar nombre, email, código, DNI..." className="rounded-lg border px-3 py-2 text-sm w-64" />
        <select value={filtroRol} onChange={(e) => setFiltroRol(e.target.value)} className="rounded-lg border px-3 py-2 text-sm">
          <option value="">Todos los roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <div className="flex rounded-lg border overflow-hidden text-sm">
          {(["activos","todos","inactivos"] as const).map((v) => (
            <button key={v} onClick={() => setFiltroActivo(v)}
              className={`px-3 py-2 transition-colors ${filtroActivo === v ? "bg-gray-800 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        {(filtroTexto || filtroRol) && (
          <button onClick={() => { setFiltroTexto(""); setFiltroRol(""); }}
            className="rounded-lg border px-3 py-2 text-sm text-gray-500 hover:bg-gray-50">Limpiar</button>
        )}
      </div>

      {/* Tabla */}
      {cargando ? <div className="py-10 text-center text-gray-400">Cargando...</div> : (
        <div className="overflow-auto rounded-xl border bg-white">
          <table className="w-full min-w-[800px] text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="p-3">Empleado</th>
                <th className="p-3">Rol</th>
                <th className="p-3">Empresa / Centro</th>
                <th className="p-3">Contacto</th>
                <th className="p-3">Código</th>
                <th className="p-3">Estado</th>
                <th className="p-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((e) => (
                <tr key={e.id} className="border-t hover:bg-gray-50">
                  <td className="p-3">
                    <Link to={`/sea-core/empleados/${e.id}`} className="flex items-center gap-2 group">
                      <div className="h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-600 shrink-0">
                        {e.nombre.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium group-hover:text-blue-600">{e.nombre} {e.apellidos ?? ""}</div>
                        {e.cargo && <div className="text-xs text-gray-400">{e.cargo}</div>}
                      </div>
                    </Link>
                  </td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ROL_BADGE[e.rol] ?? "bg-gray-100 text-gray-600"}`}>
                      {e.rol}
                    </span>
                  </td>
                  <td className="p-3 text-gray-500">
                    <div>{(e.sea_companies as any)?.nombre ?? "—"}</div>
                    <div className="text-xs">{(e.sea_work_centers as any)?.nombre ?? ""}</div>
                  </td>
                  <td className="p-3 text-gray-500">
                    <div>{e.email ?? "—"}</div>
                    <div className="text-xs">{e.telefono ?? ""}</div>
                  </td>
                  <td className="p-3 font-mono text-gray-500">{e.codigo_operario ?? "—"}</td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${e.activo ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700"}`}>
                      {e.activo ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex gap-1">
                      <Link to={`/sea-core/empleados/${e.id}`}
                        className="rounded-lg bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100">
                        Ver ficha
                      </Link>
                      <button onClick={() => abrirEditar(e)}
                        className="rounded-lg bg-gray-100 px-2 py-1 text-xs hover:bg-gray-200">
                        Editar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtrados.length === 0 && (
                <tr><td colSpan={7} className="p-8 text-center text-gray-400">Sin empleados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal crear/editar */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-5">{editId ? "Editar empleado" : "Nuevo empleado"}</h2>

            <div className="space-y-4">
              {/* Datos personales */}
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Datos personales</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs font-medium text-gray-600">Nombre *</label>
                    <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                      className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
                  <div><label className="text-xs font-medium text-gray-600">Apellidos</label>
                    <input value={form.apellidos} onChange={(e) => setForm({ ...form, apellidos: e.target.value })}
                      className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
                  <div><label className="text-xs font-medium text-gray-600">DNI / NIE</label>
                    <input value={form.dni_nie} onChange={(e) => setForm({ ...form, dni_nie: e.target.value })}
                      className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
                  <div><label className="text-xs font-medium text-gray-600">Teléfono</label>
                    <input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })}
                      className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
                  <div><label className="text-xs font-medium text-gray-600">Email</label>
                    <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                      className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
                  <div><label className="text-xs font-medium text-gray-600">Fecha de alta</label>
                    <input type="date" value={form.fecha_alta} onChange={(e) => setForm({ ...form, fecha_alta: e.target.value })}
                      className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
                </div>
              </div>

              {/* Puesto */}
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Puesto y acceso</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs font-medium text-gray-600">Cargo</label>
                    <input value={form.cargo} onChange={(e) => setForm({ ...form, cargo: e.target.value })}
                      className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" placeholder="Mecánico, Encargado..." /></div>
                  <div><label className="text-xs font-medium text-gray-600">Departamento</label>
                    <input value={form.departamento} onChange={(e) => setForm({ ...form, departamento: e.target.value })}
                      className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
                  <div><label className="text-xs font-medium text-gray-600">Rol</label>
                    <select value={form.rol} onChange={(e) => setForm({ ...form, rol: e.target.value })}
                      className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select></div>
                  <div><label className="text-xs font-medium text-gray-600">Código operario</label>
                    <input value={form.codigo_operario}
                      onChange={(e) => setForm({ ...form, codigo_operario: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                      className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-mono"
                      placeholder="1234" maxLength={4} inputMode="numeric" /></div>
                </div>
              </div>

              {/* Empresa y centro */}
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Organización</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs font-medium text-gray-600">Empresa</label>
                    <select value={form.company_id} onChange={(e) => setForm({ ...form, company_id: e.target.value })}
                      className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                      <option value="">Sin empresa</option>
                      {empresas.map((emp) => <option key={emp.id} value={emp.id}>{emp.nombre}</option>)}
                    </select></div>
                  <div><label className="text-xs font-medium text-gray-600">Centro de trabajo</label>
                    <select value={form.work_center_id} onChange={(e) => setForm({ ...form, work_center_id: e.target.value })}
                      className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                      <option value="">Sin centro</option>
                      {centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                    </select></div>
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} />
                Empleado activo
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.roadside_capable} onChange={(e) => setForm({ ...form, roadside_capable: e.target.checked })} />
                <span>Puede gestionar asistencias en carretera</span>
                {form.roadside_capable && !form.codigo_operario && (
                  <span className="text-xs text-orange-600">(requiere código operario)</span>
                )}
              </label>
            </div>

            {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
            <div className="mt-5 flex gap-2 justify-end">
              <button onClick={() => setModal(false)} className="rounded-xl border px-4 py-2 text-sm font-semibold">Cancelar</button>
              <button onClick={guardar} disabled={guardando}
                className="rounded-xl bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-900 disabled:opacity-50">
                {guardando ? "Guardando..." : editId ? "Guardar cambios" : "Crear empleado"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
