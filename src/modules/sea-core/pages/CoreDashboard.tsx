import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import CoreMenu from "../components/CoreMenu";
import { supabase } from "../../almacen-neumaticos/services/supabase";

export default function CoreDashboard() {
  const [stats, setStats] = useState({ total: 0, activos: 0, inactivos: 0, empresas: 0, centros: 0 });
  const [recientes, setRecientes] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => { cargar(); }, []);

  async function cargar() {
    setCargando(true);
    const [{ data: emps }, { data: empresas }, { data: centros }] = await Promise.all([
      supabase.from("sea_employees").select("id, nombre, rol, activo, created_at, sea_companies(nombre)").order("created_at", { ascending: false }),
      supabase.from("sea_companies").select("id").eq("activa", true),
      supabase.from("sea_work_centers").select("id").eq("activo", true),
    ]);
    const todos = emps ?? [];
    setStats({
      total:    todos.length,
      activos:  todos.filter((e) => e.activo).length,
      inactivos:todos.filter((e) => !e.activo).length,
      empresas: empresas?.length ?? 0,
      centros:  centros?.length ?? 0,
    });
    setRecientes(todos.slice(0, 8));
    setCargando(false);
  }

  const ROL_BADGE: Record<string, string> = {
    admin:       "bg-red-100 text-red-800",
    responsable: "bg-orange-100 text-orange-800",
    operario:    "bg-blue-100 text-blue-800",
    prl:         "bg-purple-100 text-purple-800",
    almacen:     "bg-green-100 text-green-800",
  };

  return (
    <div className="p-6 space-y-6">
      <CoreMenu />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">SEA Core</h1>
          <p className="text-sm text-gray-500">Gestión central de empleados y organización</p>
        </div>
        <Link to="/sea-core/empleados" className="rounded-xl bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-900">
          + Nuevo empleado
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {[
          { label: "Total empleados", value: stats.total,    color: "bg-gray-50 border-gray-200",     text: "text-gray-800" },
          { label: "Activos",         value: stats.activos,  color: "bg-green-50 border-green-200",   text: "text-green-800" },
          { label: "Inactivos",       value: stats.inactivos,color: "bg-red-50 border-red-200",       text: "text-red-800" },
          { label: "Empresas",        value: stats.empresas, color: "bg-blue-50 border-blue-200",     text: "text-blue-800" },
          { label: "Centros trabajo", value: stats.centros,  color: "bg-purple-50 border-purple-200", text: "text-purple-800" },
        ].map((s) => (
          <div key={s.label} className={`rounded-xl border p-4 ${s.color}`}>
            <div className={`text-3xl font-black ${s.text}`}>{s.value}</div>
            <div className="text-xs text-gray-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Lista recientes */}
      <div className="rounded-xl border bg-white">
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="font-semibold">Empleados</h2>
          <Link to="/sea-core/empleados" className="text-sm text-blue-600 hover:underline">Ver todos →</Link>
        </div>
        {cargando ? (
          <div className="p-8 text-center text-gray-400">Cargando...</div>
        ) : (
          <div className="divide-y">
            {recientes.map((e) => (
              <Link key={e.id} to={`/sea-core/empleados/${e.id}`}
                className="flex items-center gap-3 p-3 hover:bg-gray-50 transition-colors">
                <div className="h-9 w-9 rounded-full bg-gray-200 flex items-center justify-center text-sm font-bold text-gray-600 shrink-0">
                  {e.nombre?.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{e.nombre}</div>
                  <div className="text-xs text-gray-400">{(e.sea_companies as any)?.nombre ?? "Sin empresa"}</div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium shrink-0 ${ROL_BADGE[e.rol] ?? "bg-gray-100 text-gray-600"}`}>
                  {e.rol}
                </span>
                {!e.activo && <span className="rounded-full bg-red-100 text-red-600 px-2 py-0.5 text-xs">Inactivo</span>}
              </Link>
            ))}
            {recientes.length === 0 && <p className="p-6 text-center text-sm text-gray-400">Sin empleados registrados.</p>}
          </div>
        )}
      </div>

      {/* Accesos rápidos */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { to: "/sea-core/empleados",   label: "Empleados",       icon: "👷" },
          { to: "/sea-core/empresas",    label: "Empresas",        icon: "🏢" },
          { to: "/sea-core/centros",     label: "Centros trabajo", icon: "📍" },
          { to: "/sea-core/competencias",label: "Competencias",    icon: "🎯" },
        ].map((a) => (
          <Link key={a.to} to={a.to}
            className="flex flex-col items-center gap-2 rounded-xl border bg-white p-4 text-center hover:bg-gray-50 transition-colors">
            <span className="text-2xl">{a.icon}</span>
            <span className="text-sm font-semibold">{a.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
