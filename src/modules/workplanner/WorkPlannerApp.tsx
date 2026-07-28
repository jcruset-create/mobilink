import { Routes, Route, Navigate, NavLink, useNavigate } from "react-router-dom";
import { Home, CalendarClock, ClipboardList, CalendarDays, BarChart3, Settings } from "lucide-react";
import SeaTarragonaV1 from "../../SeaTarragonaV1";

// Menú del módulo. Estadísticas y Configuración quedan preparadas como
// placeholders ("Próximamente") para las próximas fases.
const SECCIONES = [
  { key: "operativo2", label: "Operativo 2", icon: ClipboardList, proximamente: false },
  { key: "agenda", label: "Agenda", icon: CalendarDays, proximamente: false },
  { key: "estadisticas", label: "Análisis y estadísticas", icon: BarChart3, proximamente: true },
  { key: "configuracion", label: "Configuración", icon: Settings, proximamente: true },
] as const;

function Proximamente({ titulo }: { titulo: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-slate-700 bg-slate-800 p-8 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-sky-500/15">
          <CalendarClock className="h-6 w-6 text-sky-400" />
        </div>
        <h2 className="text-base font-bold text-slate-100">{titulo}</h2>
        <p className="mt-2 text-sm text-slate-400">
          Esta sección de Mobilink WorkPlanner estará disponible próximamente.
        </p>
      </div>
    </div>
  );
}

/**
 * Mobilink WorkPlanner: agrupa Operativo 2 y la agenda (Agenda 2) del panel
 * de taller bajo un menú propio, con Estadísticas y Configuración preparadas
 * para fases futuras. Las vistas funcionales reutilizan SeaTarragonaV1 vía
 * initialView (mismo mecanismo que /operativo2), sin duplicar código.
 */
export default function WorkPlannerApp() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="sticky top-0 z-40 border-b border-slate-700 bg-slate-900/95 px-3 py-1.5 backdrop-blur">
        <div className="flex items-center gap-3 overflow-x-auto">
          <button
            onClick={() => navigate("/inicio")}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1.5 text-[12px] font-medium text-slate-200 hover:bg-slate-700"
            title="Volver a Inicio"
          >
            <Home className="h-4 w-4" /> <span className="hidden sm:inline">Inicio</span>
          </button>
          <div className="flex shrink-0 items-center gap-1.5">
            <CalendarClock className="h-4 w-4 text-sky-400" />
            <span className="text-[13px] font-black">Mobilink WorkPlanner</span>
          </div>
          <nav className="flex items-center gap-1">
            {SECCIONES.map((s) => {
              const Icon = s.icon;
              return (
                <NavLink
                  key={s.key}
                  to={`/workplanner/${s.key}`}
                  className={({ isActive }) =>
                    `flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition ${
                      isActive
                        ? "bg-sky-600 text-white"
                        : s.proximamente
                          ? "text-slate-500 hover:bg-slate-800 hover:text-slate-400"
                          : "text-slate-300 hover:bg-slate-800 hover:text-white"
                    }`
                  }
                >
                  <Icon className="h-3.5 w-3.5" />
                  {s.label}
                  {s.proximamente && (
                    <span className="rounded-full border border-slate-600 px-1.5 py-px text-[9px] font-bold uppercase text-slate-500">
                      Próx.
                    </span>
                  )}
                </NavLink>
              );
            })}
          </nav>
        </div>
      </header>

      <Routes>
        <Route index element={<Navigate to="/workplanner/operativo2" replace />} />
        <Route path="operativo2" element={<SeaTarragonaV1 initialView="operativo2" />} />
        <Route path="agenda" element={<SeaTarragonaV1 initialView="agenda2" />} />
        <Route path="estadisticas" element={<Proximamente titulo="Análisis y estadísticas" />} />
        <Route path="configuracion" element={<Proximamente titulo="Configuración" />} />
        <Route path="*" element={<Navigate to="/workplanner/operativo2" replace />} />
      </Routes>
    </div>
  );
}
