import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ToolControlLayout from "../components/ToolControlLayout";
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
  disponible:          "bg-emerald-500/15 text-emerald-300",
  en_uso:              "bg-sky-500/15 text-sky-300",
  compartida:          "bg-cyan-500/15 text-cyan-300",
  pendiente_devolucion:"bg-yellow-500/15 text-yellow-300",
  danada:              "bg-red-500/15 text-red-300",
  mantenimiento:       "bg-orange-500/15 text-orange-300",
  perdida:             "bg-slate-500/15 text-slate-400",
  fuera_servicio:      "bg-slate-500/15 text-slate-400",
  pendiente_revision:  "bg-violet-500/15 text-violet-300",
  desactualizada:      "bg-pink-500/15 text-pink-300",
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

  return (
    <ToolControlLayout
      title="Mobilink ToolControl"
      subtitle="Gestión de herramientas y maquinaria"
      actions={
        <Link
          to="/toolcontrol/herramientas"
          className="rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-bold text-amber-950 hover:bg-amber-400"
        >
          + Nueva herramienta
        </Link>
      }
    >
      {cargando ? (
        <div className="flex h-40 items-center justify-center text-slate-500">Cargando...</div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
            {[
              { label: "Total",         value: stats?.total,               badge: "border-slate-500/30 bg-slate-500/15 text-slate-300" },
              { label: "Disponibles",   value: stats?.disponibles,         badge: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" },
              { label: "En uso",        value: stats?.en_uso,              badge: "border-sky-500/30 bg-sky-500/15 text-sky-300" },
              { label: "Mantenimiento", value: stats?.mantenimiento,       badge: "border-orange-500/30 bg-orange-500/15 text-orange-300" },
              { label: "Dañadas",       value: stats?.danadas,             badge: "border-red-500/30 bg-red-500/15 text-red-300" },
              { label: "Incidencias",   value: stats?.incidencias_abiertas,badge: "border-yellow-500/30 bg-yellow-500/15 text-yellow-300" },
            ].map((s) => (
              <div key={s.label} className={`rounded-lg border px-2 py-1.5 ${s.badge}`}>
                <div className="text-[9px] font-bold uppercase leading-tight">{s.label}</div>
                <div className="text-lg font-black leading-none">{s.value ?? 0}</div>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {/* Herramientas recientes */}
            <div className="rounded-xl border border-slate-700 bg-slate-800 shadow-sm lg:col-span-2">
              <div className="flex items-center justify-between border-b border-slate-700 p-4">
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-300">Herramientas</h2>
                <Link to="/toolcontrol/herramientas" className="text-sm text-amber-400 hover:underline">
                  Ver todas →
                </Link>
              </div>
              <div className="divide-y divide-slate-700/70">
                {herramientasRecientes.length === 0 ? (
                  <p className="p-4 text-sm text-slate-500">Sin herramientas registradas</p>
                ) : (
                  herramientasRecientes.map((h) => (
                    <div key={h.id} className="flex items-center gap-3 p-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-100">{h.nombre}</div>
                        <div className="text-xs text-slate-500">
                          {h.codigo} {h.marca ? `· ${h.marca}` : ""} {h.modelo ? h.modelo : ""}
                        </div>
                        {h.tc_locations?.nombre && (
                          <div className="text-xs text-slate-500">📍 {h.tc_locations.nombre}</div>
                        )}
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_BADGE[h.estado] ?? "bg-slate-500/15 text-slate-400"}`}>
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
              <div className="rounded-xl border border-slate-700 bg-slate-800 shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-700 p-4">
                  <h2 className="text-sm font-bold uppercase tracking-wide text-red-300">⚠ Incidencias abiertas</h2>
                  <Link to="/toolcontrol/incidencias" className="text-xs text-amber-400 hover:underline">
                    Ver todas →
                  </Link>
                </div>
                <div className="divide-y divide-slate-700/70">
                  {incidencias.length === 0 ? (
                    <p className="p-4 text-sm text-slate-500">Sin incidencias</p>
                  ) : (
                    incidencias.map((i) => (
                      <div key={i.id} className="p-3">
                        <div className="text-sm font-medium text-slate-100">{i.titulo}</div>
                        <div className="text-xs text-slate-500">
                          {(i.tc_tools as any)?.nombre ?? "—"} · {i.estado}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Próximas revisiones */}
              <div className="rounded-xl border border-slate-700 bg-slate-800 shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-700 p-4">
                  <h2 className="text-sm font-bold uppercase tracking-wide text-orange-300">🔔 Próximas revisiones</h2>
                  <Link to="/toolcontrol/mantenimiento" className="text-xs text-amber-400 hover:underline">
                    Ver todas →
                  </Link>
                </div>
                <div className="divide-y divide-slate-700/70">
                  {proximoMantenimiento.length === 0 ? (
                    <p className="p-4 text-sm text-slate-500">Sin revisiones próximas</p>
                  ) : (
                    proximoMantenimiento.map((h) => {
                      const dias = h.proxima_revision
                        ? Math.ceil((new Date(h.proxima_revision).getTime() - Date.now()) / 86400000)
                        : null;
                      return (
                        <div key={h.id} className="p-3">
                          <div className="text-sm font-medium text-slate-100">{h.nombre}</div>
                          <div className={`text-xs font-semibold ${dias !== null && dias < 0 ? "text-red-400" : dias !== null && dias < 7 ? "text-orange-400" : "text-slate-500"}`}>
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
              { to: "/toolcontrol/herramientas", label: "Herramientas", icon: "🔧", badge: "border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20" },
              { to: "/toolcontrol/maquinas",     label: "Máquinas",     icon: "⚙️", badge: "border-sky-500/30 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20" },
              { to: "/toolcontrol/inventario",   label: "Inventario",   icon: "📋", badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20" },
              { to: "/toolcontrol/incidencias",  label: "Incidencias",  icon: "⚠️", badge: "border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20" },
            ].map((a) => (
              <Link
                key={a.to}
                to={a.to}
                className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-colors ${a.badge}`}
              >
                <span className="text-2xl">{a.icon}</span>
                <span className="text-sm font-semibold">{a.label}</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </ToolControlLayout>
  );
}
