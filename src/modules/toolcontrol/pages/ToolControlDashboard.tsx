import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ToolControlMenu from "../components/ToolControlMenu";
import { supabase } from "../services/supabase";

type Stats = {
  total: number;
  disponibles: number;
  en_uso: number;
  mantenimiento: number;
  danadas: number;
  incidencias_abiertas: number;
};

const ESTADO_BADGE: Record<string, string> = {
  disponible:          "bg-green-100 text-green-800",
  en_uso:              "bg-blue-100 text-blue-800",
  compartida:          "bg-cyan-100 text-cyan-800",
  pendiente_devolucion:"bg-yellow-100 text-yellow-800",
  danada:              "bg-red-100 text-red-800",
  mantenimiento:       "bg-orange-100 text-orange-800",
  perdida:             "bg-gray-200 text-gray-600",
  fuera_servicio:      "bg-gray-200 text-gray-600",
  pendiente_revision:  "bg-purple-100 text-purple-800",
  desactualizada:      "bg-pink-100 text-pink-800",
};

export default function ToolControlDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [herramientasRecientes, setHerramientasRecientes] = useState<any[]>([]);
  const [incidencias, setIncidencias] = useState<any[]>([]);
  const [proximoMantenimiento, setProximoMantenimiento] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    setCargando(true);
    const [
      { data: herramientas },
      { data: incidenciasData },
      { data: mantenimientoData },
    ] = await Promise.all([
      supabase
        .from("tc_tools")
        .select("id, estado")
        .eq("activa", true),
      supabase
        .from("tc_incidents")
        .select("id, titulo, tipo, estado, created_at, tc_tools(nombre, codigo)")
        .in("estado", ["abierta", "avisada"])
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("tc_tools")
        .select("id, nombre, codigo, proxima_revision")
        .eq("activa", true)
        .not("proxima_revision", "is", null)
        .order("proxima_revision", { ascending: true })
        .limit(5),
    ]);

    if (herramientas) {
      setStats({
        total:          herramientas.length,
        disponibles:    herramientas.filter((h) => h.estado === "disponible").length,
        en_uso:         herramientas.filter((h) => ["en_uso", "compartida"].includes(h.estado)).length,
        mantenimiento:  herramientas.filter((h) => h.estado === "mantenimiento").length,
        danadas:        herramientas.filter((h) => h.estado === "danada").length,
        incidencias_abiertas: incidenciasData?.length ?? 0,
      });
    }

    const [{ data: recientes }] = await Promise.all([
      supabase
        .from("tc_tools")
        .select("id, codigo, nombre, estado, marca, modelo, tc_locations!tc_tools_ubicacion_actual_id_fkey(nombre)")
        .eq("activa", true)
        .order("updated_at", { ascending: false })
        .limit(8),
    ]);

    setHerramientasRecientes(recientes ?? []);
    setIncidencias(incidenciasData ?? []);
    setProximoMantenimiento(mantenimientoData ?? []);
    setCargando(false);
  }

  if (cargando) {
    return (
      <div className="p-6">
        <ToolControlMenu />
        <div className="flex items-center justify-center h-40 text-gray-400">Cargando...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <ToolControlMenu />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">SEA ToolControl</h1>
          <p className="text-sm text-gray-500">Gestión de herramientas y maquinaria</p>
        </div>
        <Link
          to="/toolcontrol/herramientas"
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          + Nueva herramienta
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "Total",         value: stats?.total,               color: "bg-gray-50  border-gray-200",  text: "text-gray-800" },
          { label: "Disponibles",   value: stats?.disponibles,         color: "bg-green-50 border-green-200", text: "text-green-800" },
          { label: "En uso",        value: stats?.en_uso,              color: "bg-blue-50  border-blue-200",  text: "text-blue-800" },
          { label: "Mantenimiento", value: stats?.mantenimiento,       color: "bg-orange-50 border-orange-200", text: "text-orange-800" },
          { label: "Dañadas",       value: stats?.danadas,             color: "bg-red-50   border-red-200",   text: "text-red-800" },
          { label: "Incidencias",   value: stats?.incidencias_abiertas,color: "bg-yellow-50 border-yellow-200", text: "text-yellow-800" },
        ].map((s) => (
          <div key={s.label} className={`rounded-xl border p-4 ${s.color}`}>
            <div className={`text-3xl font-black ${s.text}`}>{s.value ?? 0}</div>
            <div className="text-xs text-gray-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Herramientas recientes */}
        <div className="lg:col-span-2 rounded-xl border bg-white">
          <div className="flex items-center justify-between border-b p-4">
            <h2 className="font-semibold">Herramientas</h2>
            <Link to="/toolcontrol/herramientas" className="text-sm text-blue-600 hover:underline">
              Ver todas →
            </Link>
          </div>
          <div className="divide-y">
            {herramientasRecientes.length === 0 ? (
              <p className="p-4 text-sm text-gray-400">Sin herramientas registradas</p>
            ) : (
              herramientasRecientes.map((h) => (
                <div key={h.id} className="flex items-center gap-3 p-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{h.nombre}</div>
                    <div className="text-xs text-gray-400">
                      {h.codigo} {h.marca ? `· ${h.marca}` : ""} {h.modelo ? h.modelo : ""}
                    </div>
                    {h.tc_locations?.nombre && (
                      <div className="text-xs text-gray-400">📍 {h.tc_locations.nombre}</div>
                    )}
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_BADGE[h.estado] ?? "bg-gray-100 text-gray-600"}`}>
                    {h.estado.replace(/_/g, " ")}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Panel lateral */}
        <div className="space-y-4">
          {/* Incidencias abiertas */}
          <div className="rounded-xl border bg-white">
            <div className="flex items-center justify-between border-b p-4">
              <h2 className="font-semibold text-red-700">⚠ Incidencias abiertas</h2>
              <Link to="/toolcontrol/incidencias" className="text-xs text-blue-600 hover:underline">
                Ver todas →
              </Link>
            </div>
            <div className="divide-y">
              {incidencias.length === 0 ? (
                <p className="p-4 text-sm text-gray-400">Sin incidencias</p>
              ) : (
                incidencias.map((i) => (
                  <div key={i.id} className="p-3">
                    <div className="text-sm font-medium">{i.titulo}</div>
                    <div className="text-xs text-gray-400">
                      {(i.tc_tools as any)?.nombre ?? "—"} · {i.estado}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Próximas revisiones */}
          <div className="rounded-xl border bg-white">
            <div className="flex items-center justify-between border-b p-4">
              <h2 className="font-semibold text-orange-700">🔔 Próximas revisiones</h2>
              <Link to="/toolcontrol/mantenimiento" className="text-xs text-blue-600 hover:underline">
                Ver todas →
              </Link>
            </div>
            <div className="divide-y">
              {proximoMantenimiento.length === 0 ? (
                <p className="p-4 text-sm text-gray-400">Sin revisiones próximas</p>
              ) : (
                proximoMantenimiento.map((h) => {
                  const dias = h.proxima_revision
                    ? Math.ceil((new Date(h.proxima_revision).getTime() - Date.now()) / 86400000)
                    : null;
                  return (
                    <div key={h.id} className="p-3">
                      <div className="text-sm font-medium">{h.nombre}</div>
                      <div className={`text-xs font-semibold ${dias !== null && dias < 0 ? "text-red-600" : dias !== null && dias < 7 ? "text-orange-600" : "text-gray-400"}`}>
                        {dias === null
                          ? "—"
                          : dias < 0
                          ? `Vencida hace ${Math.abs(dias)} días`
                          : dias === 0
                          ? "Hoy"
                          : `En ${dias} días`}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Accesos rápidos */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { to: "/toolcontrol/herramientas", label: "Herramientas", icon: "🔧", color: "bg-blue-50 hover:bg-blue-100 border-blue-200" },
          { to: "/toolcontrol/maquinas",     label: "Máquinas",     icon: "⚙️", color: "bg-indigo-50 hover:bg-indigo-100 border-indigo-200" },
          { to: "/toolcontrol/inventario",   label: "Inventario",   icon: "📋", color: "bg-green-50 hover:bg-green-100 border-green-200" },
          { to: "/toolcontrol/incidencias",  label: "Incidencias",  icon: "⚠️", color: "bg-red-50 hover:bg-red-100 border-red-200" },
        ].map((a) => (
          <Link
            key={a.to}
            to={a.to}
            className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-colors ${a.color}`}
          >
            <span className="text-2xl">{a.icon}</span>
            <span className="text-sm font-semibold">{a.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
