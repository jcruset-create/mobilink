import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import CoreMenu from "../components/CoreMenu";
import { supabase } from "../../almacen-neumaticos/services/supabase";

const ROL_BADGE: Record<string, string> = {
  admin:       "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
  responsable: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  operario:    "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
  prl:         "bg-violet-50 text-violet-700 ring-1 ring-violet-200",
  almacen:     "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
};

const ROL_AVATAR: Record<string, string> = {
  admin: "bg-rose-100 text-rose-700",
  responsable: "bg-amber-100 text-amber-700",
  operario: "bg-sky-100 text-sky-700",
  prl: "bg-violet-100 text-violet-700",
  almacen: "bg-emerald-100 text-emerald-700",
};

export default function CoreDashboard() {
  const [stats, setStats] = useState({ total: 0, activos: 0, inactivos: 0, empresas: 0, centros: 0 });
  const [recientes, setRecientes] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => { cargar(); }, []);

  async function cargar() {
    setCargando(true);
    const [{ data: emps }, { data: empresas }, { data: centros }] = await Promise.all([
      supabase.from("sea_employees")
        .select("id, nombre, apellidos, cargo, rol, activo, created_at, sea_companies(nombre)")
        .order("created_at", { ascending: false }),
      supabase.from("sea_companies").select("id").eq("activa", true),
      supabase.from("sea_work_centers").select("id").eq("activo", true),
    ]);
    const todos = emps ?? [];
    setStats({
      total:     todos.length,
      activos:   todos.filter((e) => e.activo).length,
      inactivos: todos.filter((e) => !e.activo).length,
      empresas:  empresas?.length ?? 0,
      centros:   centros?.length ?? 0,
    });
    setRecientes(todos.slice(0, 10));
    setCargando(false);
  }

  const STATS = [
    { label: "Plantilla total",   value: stats.total,     sub: "empleados",  color: "text-gray-900",    bg: "bg-gray-50",    border: "border-gray-200" },
    { label: "Activos",           value: stats.activos,   sub: "en activo",  color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" },
    { label: "Inactivos",         value: stats.inactivos, sub: "dados de baja",color: "text-rose-600",  bg: "bg-rose-50",    border: "border-rose-200" },
    { label: "Empresas",          value: stats.empresas,  sub: "activas",    color: "text-sky-700",     bg: "bg-sky-50",     border: "border-sky-200" },
    { label: "Centros de trabajo",value: stats.centros,   sub: "activos",    color: "text-violet-700",  bg: "bg-violet-50",  border: "border-violet-200" },
  ];

  const ACCESOS = [
    { to: "/sea-core/empleados",    label: "Empleados",       desc: "Gestión de personal",     icon: "👤", color: "hover:border-gray-400" },
    { to: "/sea-core/empresas",     label: "Empresas",        desc: "Clientes y proveedores",  icon: "🏢", color: "hover:border-sky-400" },
    { to: "/sea-core/centros",      label: "Centros",         desc: "Delegaciones y plantas",  icon: "📍", color: "hover:border-violet-400" },
    { to: "/sea-core/competencias", label: "Competencias",    desc: "Catálogo de habilidades", icon: "🎯", color: "hover:border-amber-400" },
    { to: "/sea-core/autorizaciones",label: "Autorizaciones", desc: "Permisos y habilitaciones",icon: "🔑",color: "hover:border-emerald-400" },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <CoreMenu />

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Dashboard</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </p>
          </div>
          <Link to="/sea-core/empleados"
            className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 transition-colors shadow-sm">
            + Nuevo empleado
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {STATS.map((s) => (
            <div key={s.label} className={`rounded-2xl border ${s.border} ${s.bg} p-5`}>
              <div className={`text-4xl font-black tabular-nums ${s.color}`}>{s.value}</div>
              <div className="text-xs font-semibold text-gray-700 mt-2">{s.label}</div>
              <div className="text-xs text-gray-400">{s.sub}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

          {/* Lista empleados */}
          <div className="lg:col-span-2 rounded-2xl border bg-white overflow-hidden shadow-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h2 className="font-semibold text-gray-900">Empleados recientes</h2>
              <Link to="/sea-core/empleados"
                className="text-xs font-medium text-gray-400 hover:text-gray-700 transition-colors">
                Ver todos →
              </Link>
            </div>

            {cargando ? (
              <div className="p-10 text-center text-gray-400 text-sm">Cargando...</div>
            ) : recientes.length === 0 ? (
              <div className="p-10 text-center">
                <div className="text-4xl mb-3">👷</div>
                <p className="text-sm text-gray-400">Sin empleados registrados.</p>
                <Link to="/sea-core/empleados"
                  className="mt-4 inline-block text-sm font-medium text-gray-700 underline underline-offset-2">
                  Añadir primer empleado
                </Link>
              </div>
            ) : (
              <div className="divide-y">
                {recientes.map((e) => {
                  const inicial = (e.nombre ?? "?").charAt(0).toUpperCase();
                  const nombreCompleto = [e.nombre, e.apellidos].filter(Boolean).join(" ");
                  return (
                    <Link key={e.id} to={`/sea-core/empleados/${e.id}`}
                      className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors group">
                      <div className={`h-9 w-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${ROL_AVATAR[e.rol] ?? "bg-gray-100 text-gray-600"}`}>
                        {inicial}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm text-gray-900 truncate">{nombreCompleto}</div>
                        <div className="text-xs text-gray-400 truncate">
                          {e.cargo ?? "Sin cargo"} · {(e.sea_companies as any)?.nombre ?? "Sin empresa"}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {!e.activo && (
                          <span className="rounded-full bg-red-50 text-red-600 ring-1 ring-red-200 px-2 py-0.5 text-xs font-medium">
                            Inactivo
                          </span>
                        )}
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ROL_BADGE[e.rol] ?? "bg-gray-100 text-gray-600"}`}>
                          {e.rol}
                        </span>
                        <span className="text-gray-300 group-hover:text-gray-500 text-sm transition-colors">→</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Accesos rápidos */}
          <div className="space-y-3">
            <h2 className="font-semibold text-gray-900 text-sm px-1">Accesos rápidos</h2>
            {ACCESOS.map((a) => (
              <Link key={a.to} to={a.to}
                className={`flex items-center gap-4 rounded-xl border bg-white px-4 py-3.5 hover:shadow-sm transition-all ${a.color} group`}>
                <div className="h-9 w-9 rounded-lg bg-gray-100 flex items-center justify-center text-lg shrink-0 group-hover:scale-110 transition-transform">
                  {a.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-gray-900">{a.label}</div>
                  <div className="text-xs text-gray-400">{a.desc}</div>
                </div>
                <span className="text-gray-300 group-hover:text-gray-500 transition-colors">→</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
