import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../modules/almacen-neumaticos/services/supabase";
import { getPortalSession, clearPortalSession } from "./PortalLogin";

const TABS = ["Mi perfil", "Competencias", "Certificaciones", "Autorizaciones", "Formación", "Mis EPIs", "Vestuario"];

const NIVEL_BADGE: Record<string, string> = {
  basico: "bg-gray-100 text-gray-700", medio: "bg-blue-100 text-blue-700",
  avanzado: "bg-purple-100 text-purple-700", experto: "bg-orange-100 text-orange-700",
};

function BadgeCaducidad({ fecha }: { fecha: string | null }) {
  if (!fecha) return null;
  const dias = Math.ceil((new Date(fecha).getTime() - Date.now()) / 86400000);
  if (dias < 0)  return <span className="rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-xs font-medium">Caducado</span>;
  if (dias <= 30) return <span className="rounded-full bg-orange-100 text-orange-700 px-2 py-0.5 text-xs font-medium">Caduca en {dias}d</span>;
  return <span className="rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-xs font-medium">Válido</span>;
}

export default function PortalFicha() {
  const navigate = useNavigate();
  const sesion = getPortalSession();

  const [tabActiva, setTabActiva] = useState(0);
  const [cargando, setCargando] = useState(true);

  const [empleado, setEmpleado]         = useState<any>(null);
  const [competencias, setCompetencias] = useState<any[]>([]);
  const [certs, setCerts]               = useState<any[]>([]);
  const [auts, setAuts]                 = useState<any[]>([]);
  const [formacion, setFormacion]       = useState<any[]>([]);
  const [epis, setEpis]                 = useState<any[]>([]);
  const [vestuario, setVestuario]       = useState<any>(null);

  useEffect(() => {
    if (!sesion) { navigate("/portal"); return; }
    cargar(sesion.id);
  }, []);

  async function cargar(empId: string) {
    setCargando(true);
    const [
      { data: emp },
      { data: comp },
      { data: cert },
      { data: aut },
      { data: form },
      { data: epiAsig },
      { data: vest },
    ] = await Promise.all([
      supabase.from("sea_employees")
        .select("*, sea_companies(nombre), sea_work_centers(nombre)")
        .eq("id", empId).single(),
      supabase.from("sea_employee_competencies")
        .select("*, sea_competencies(nombre, categoria)")
        .eq("employee_id", empId).order("created_at"),
      supabase.from("sea_employee_certifications")
        .select("*").eq("employee_id", empId).order("fecha_obtencion", { ascending: false }),
      supabase.from("sea_employee_authorizations")
        .select("*, sea_authorizations(nombre)")
        .eq("employee_id", empId).order("created_at"),
      supabase.from("sea_training_records")
        .select("*").eq("employee_id", empId).order("fecha_inicio", { ascending: false }),
      supabase.from("sm_epi_assignments")
        .select("*, sm_epis(nombre, descripcion)")
        .eq("employee_id", empId).eq("estado", "activa").order("fecha_entrega", { ascending: false }),
      supabase.from("sea_employee_clothing")
        .select("*").eq("employee_id", empId).maybeSingle(),
    ]);
    setEmpleado(emp);
    setCompetencias(comp ?? []);
    setCerts(cert ?? []);
    setAuts(aut ?? []);
    setFormacion(form ?? []);
    setEpis(epiAsig ?? []);
    setVestuario(vest);
    setCargando(false);
  }

  function cerrarSesion() {
    clearPortalSession();
    navigate("/portal");
  }

  if (!sesion) return null;

  if (cargando) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-gray-400 text-sm">Cargando tu ficha...</div>
    </div>
  );

  const alertasCaducidad = [
    ...certs.filter((c) => c.fecha_caducidad && Math.ceil((new Date(c.fecha_caducidad).getTime() - Date.now()) / 86400000) <= 30),
    ...auts.filter((a) => a.fecha_caducidad && Math.ceil((new Date(a.fecha_caducidad).getTime() - Date.now()) / 86400000) <= 30),
    ...formacion.filter((f) => f.fecha_caducidad && Math.ceil((new Date(f.fecha_caducidad).getTime() - Date.now()) / 86400000) <= 30),
  ];

  return (
    <div className="min-h-screen bg-gray-100 pb-10">
      {/* Header */}
      <header className="bg-gray-800 text-white px-5 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-white/20 flex items-center justify-center font-bold text-sm shrink-0">
              {sesion.nombre.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="font-bold leading-tight">{sesion.nombre}</div>
              {empleado?.cargo && <div className="text-xs text-white/70">{empleado.cargo}</div>}
            </div>
          </div>
          <button onClick={cerrarSesion}
            className="text-xs text-white/70 hover:text-white border border-white/30 rounded-lg px-3 py-1.5 transition-colors">
            Salir
          </button>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 pt-5 space-y-4">

        {/* Alertas de caducidad */}
        {alertasCaducidad.length > 0 && (
          <div className="rounded-xl bg-orange-50 border border-orange-200 p-4 space-y-1">
            <div className="font-semibold text-orange-800 text-sm flex items-center gap-1">
              ⚠️ Tienes {alertasCaducidad.length} documento{alertasCaducidad.length > 1 ? "s" : ""} próximos a caducar
            </div>
            <p className="text-xs text-orange-700">Consulta con tu responsable para renovarlos.</p>
          </div>
        )}

        {/* Tabs */}
        <div className="overflow-x-auto">
          <div className="flex gap-1 min-w-max border-b pb-0">
            {TABS.map((tab, i) => (
              <button key={tab} onClick={() => setTabActiva(i)}
                className={`px-3 py-2 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors ${
                  tabActiva === i ? "border-gray-800 text-gray-800" : "border-transparent text-gray-500 hover:text-gray-700"
                }`}>
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Tab 0: Mi perfil */}
        {tabActiva === 0 && empleado && (
          <div className="rounded-xl border bg-white divide-y overflow-hidden">
            {[
              { label: "Empresa",          value: empleado.sea_companies?.nombre },
              { label: "Centro de trabajo",value: empleado.sea_work_centers?.nombre },
              { label: "Departamento",     value: empleado.departamento },
              { label: "Cargo",            value: empleado.cargo },
              { label: "Email",            value: empleado.email },
              { label: "Teléfono",         value: empleado.telefono },
              { label: "Fecha de alta",    value: empleado.fecha_alta ? new Date(empleado.fecha_alta).toLocaleDateString("es-ES") : null },
            ].filter((f) => f.value).map(({ label, value }) => (
              <div key={label} className="flex justify-between px-4 py-3 text-sm">
                <span className="text-gray-500">{label}</span>
                <span className="font-medium text-right">{value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Tab 1: Competencias */}
        {tabActiva === 1 && (
          <div className="rounded-xl border bg-white divide-y overflow-hidden">
            {competencias.length === 0
              ? <p className="p-6 text-center text-sm text-gray-400">Sin competencias registradas.</p>
              : competencias.map((c) => (
                <div key={c.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <div className="font-medium text-sm">{c.sea_competencies?.nombre}</div>
                    <div className="text-xs text-gray-400 capitalize">{c.sea_competencies?.categoria}</div>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${NIVEL_BADGE[c.nivel] ?? "bg-gray-100"}`}>
                    {c.nivel}
                  </span>
                </div>
              ))}
          </div>
        )}

        {/* Tab 2: Certificaciones */}
        {tabActiva === 2 && (
          <div className="rounded-xl border bg-white divide-y overflow-hidden">
            {certs.length === 0
              ? <p className="p-6 text-center text-sm text-gray-400">Sin certificaciones.</p>
              : certs.map((c) => (
                <div key={c.id} className="flex items-start justify-between px-4 py-3 gap-2">
                  <div>
                    <div className="font-medium text-sm">{c.nombre}</div>
                    {c.entidad_emisora && <div className="text-xs text-gray-400">{c.entidad_emisora}</div>}
                    {c.fecha_obtencion && <div className="text-xs text-gray-400">Obtenida: {new Date(c.fecha_obtencion).toLocaleDateString("es-ES")}</div>}
                  </div>
                  <BadgeCaducidad fecha={c.fecha_caducidad} />
                </div>
              ))}
          </div>
        )}

        {/* Tab 3: Autorizaciones */}
        {tabActiva === 3 && (
          <div className="rounded-xl border bg-white divide-y overflow-hidden">
            {auts.length === 0
              ? <p className="p-6 text-center text-sm text-gray-400">Sin autorizaciones.</p>
              : auts.map((a) => (
                <div key={a.id} className="flex items-start justify-between px-4 py-3 gap-2">
                  <div>
                    <div className="font-medium text-sm">{a.sea_authorizations?.nombre}</div>
                    {a.numero_autorizacion && <div className="text-xs text-gray-400">Nº {a.numero_autorizacion}</div>}
                    {a.fecha_emision && <div className="text-xs text-gray-400">Emitida: {new Date(a.fecha_emision).toLocaleDateString("es-ES")}</div>}
                  </div>
                  <BadgeCaducidad fecha={a.fecha_caducidad} />
                </div>
              ))}
          </div>
        )}

        {/* Tab 4: Formación */}
        {tabActiva === 4 && (
          <div className="rounded-xl border bg-white divide-y overflow-hidden">
            {formacion.length === 0
              ? <p className="p-6 text-center text-sm text-gray-400">Sin registros de formación.</p>
              : formacion.map((f) => (
                <div key={f.id} className="flex items-start justify-between px-4 py-3 gap-2">
                  <div>
                    <div className="font-medium text-sm">{f.nombre_curso}</div>
                    <div className="text-xs text-gray-400">
                      {[f.entidad_formadora, f.horas ? `${f.horas}h` : null,
                        f.fecha_inicio ? new Date(f.fecha_inicio).toLocaleDateString("es-ES") : null
                      ].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      f.resultado === "superado" ? "bg-green-100 text-green-700"
                      : f.resultado === "no_superado" ? "bg-red-100 text-red-700"
                      : "bg-gray-100 text-gray-600"
                    }`}>{f.resultado?.replace("_", " ")}</span>
                    <BadgeCaducidad fecha={f.fecha_caducidad} />
                  </div>
                </div>
              ))}
          </div>
        )}

        {/* Tab 5: Mis EPIs */}
        {tabActiva === 5 && (
          <div className="rounded-xl border bg-white divide-y overflow-hidden">
            {epis.length === 0
              ? <p className="p-6 text-center text-sm text-gray-400">No tienes EPIs asignados actualmente.</p>
              : epis.map((e) => (
                <div key={e.id} className="px-4 py-3">
                  <div className="font-medium text-sm">{e.sm_epis?.nombre}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {e.cantidad && `${e.cantidad} ud. · `}
                    Entregado: {e.fecha_entrega ? new Date(e.fecha_entrega).toLocaleDateString("es-ES") : "—"}
                  </div>
                  {e.sm_epis?.descripcion && <div className="text-xs text-gray-400">{e.sm_epis.descripcion}</div>}
                </div>
              ))}
          </div>
        )}

        {/* Tab 6: Vestuario */}
        {tabActiva === 6 && (
          <div className="rounded-xl border bg-white divide-y overflow-hidden">
            {!vestuario
              ? <p className="p-6 text-center text-sm text-gray-400">No hay tallas registradas. Consulta con RRHH.</p>
              : [
                  { label: "Camiseta",  value: vestuario.camiseta },
                  { label: "Camisa",    value: vestuario.camisa },
                  { label: "Pantalón",  value: vestuario.pantalon },
                  { label: "Calzado",   value: vestuario.calzado },
                  { label: "Chaqueta",  value: vestuario.chaqueta },
                  { label: "Sudadera",  value: vestuario.sudadera },
                  { label: "Chaleco",   value: vestuario.chaleco },
                ].filter((f) => f.value).map(({ label, value }) => (
                  <div key={label} className="flex justify-between px-4 py-3 text-sm">
                    <span className="text-gray-500">{label}</span>
                    <span className="font-bold">{value}</span>
                  </div>
                ))}
            {vestuario?.observaciones && (
              <div className="px-4 py-3 text-xs text-gray-400">{vestuario.observaciones}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
