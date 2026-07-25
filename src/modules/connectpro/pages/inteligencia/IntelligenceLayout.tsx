/**
 * Centro de Inteligencia Operacional — contenedor de la sección.
 *
 * Aporta la subnavegación de los 11 apartados (filtrada por rol), el botón del
 * asistente y el contexto de filtros compartido por todas las pantallas, para
 * que cambiar de apartado no obligue a reconfigurar el periodo ni el ámbito.
 */

import { createContext, useContext, useMemo, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  Activity, BarChart3, Bot, Brain, Coins, FileText, Gauge, Radar, Settings,
  ShieldCheck, Siren, Truck, type LucideIcon,
} from "lucide-react";
import { useConnectAuth, hasRole } from "../../contexts/ConnectAuthContext";
import type { ConnectRole } from "../../types";
import AsistenteIA from "../../components/oi/AsistenteIA";
import { todayRange } from "../../services/oiApi";

export type OiFilters = {
  from: number;
  to: number;
  workshopId?: number | null;
  serviceType?: string | null;
  priority?: string | null;
};

type FiltersCtx = { filters: OiFilters; setFilters: (f: OiFilters) => void };
const FiltersContext = createContext<FiltersCtx | null>(null);

export function useOiFilters(): FiltersCtx {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error("useOiFilters fuera del Centro de Inteligencia Operacional");
  return ctx;
}

/** Convierte los filtros en query string para la API. */
export function filtersToQuery(f: OiFilters): string {
  const p = new URLSearchParams({ from: String(f.from), to: String(f.to) });
  if (f.workshopId) p.set("workshopId", String(f.workshopId));
  if (f.serviceType) p.set("serviceType", f.serviceType);
  if (f.priority) p.set("priority", f.priority);
  return p.toString();
}

type SubNavItem = { path: string; label: string; icon: LucideIcon; minRole: ConnectRole; end?: boolean };

export const OI_SUBNAV: SubNavItem[] = [
  { path: "", label: "Resumen", icon: Gauge, minRole: "analyst", end: true },
  { path: "tiempo-real", label: "Tiempo real", icon: Activity, minRole: "operator" },
  { path: "demanda", label: "Demanda y predicciones", icon: Radar, minRole: "analyst" },
  { path: "proveedores", label: "Rendimiento de proveedores", icon: BarChart3, minRole: "analyst" },
  { path: "flota", label: "Flota y recursos", icon: Truck, minRole: "operator" },
  { path: "calidad", label: "Calidad del servicio", icon: ShieldCheck, minRole: "analyst" },
  { path: "economico", label: "Análisis económico", icon: Coins, minRole: "analyst" },
  { path: "recomendaciones", label: "Recomendaciones de IA", icon: Brain, minRole: "analyst" },
  { path: "alertas", label: "Alertas inteligentes", icon: Siren, minRole: "operator" },
  { path: "informes", label: "Informes", icon: FileText, minRole: "analyst" },
  { path: "configuracion", label: "Configuración", icon: Settings, minRole: "cc_admin" },
];

export default function IntelligenceLayout() {
  const { user } = useConnectAuth();
  const [filters, setFilters] = useState<OiFilters>(() => ({ ...todayRange() }));
  const [assistantOpen, setAssistantOpen] = useState(false);

  const items = useMemo(() => OI_SUBNAV.filter((i) => hasRole(user, i.minRole)), [user]);
  const value = useMemo(() => ({ filters, setFilters }), [filters]);

  return (
    <FiltersContext.Provider value={value}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-100">Centro de Inteligencia Operacional</h1>
          <p className="text-sm text-slate-400">
            Supervisión, análisis y optimización de la asistencia en carretera en tiempo real.
          </p>
        </div>
        <button
          onClick={() => setAssistantOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-cyan-600 px-3 py-2 text-[13px] font-medium text-white hover:bg-cyan-500"
        >
          <Bot className="h-4 w-4" /> Asistente
        </button>
      </div>

      <nav className="mb-4 flex flex-wrap gap-1 border-b border-slate-700 pb-2">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path || "resumen"}
              to={item.path ? `/connect/inteligencia/${item.path}` : "/connect/inteligencia"}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] transition ${
                  isActive ? "bg-cyan-600/20 font-semibold text-cyan-300" : "text-slate-400 hover:bg-slate-800"
                }`
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </NavLink>
          );
        })}
      </nav>

      <Outlet />
      <AsistenteIA open={assistantOpen} onClose={() => setAssistantOpen(false)} />
    </FiltersContext.Provider>
  );
}

/** Selector de periodo compartido por las pantallas analíticas. */
export function PeriodPicker() {
  const { filters, setFilters } = useOiFilters();
  const options: Array<{ label: string; days: number | "today" }> = [
    { label: "Hoy", days: "today" },
    { label: "7 días", days: 7 },
    { label: "30 días", days: 30 },
    { label: "90 días", days: 90 },
  ];
  const activeDays = Math.round((filters.to - filters.from) / 86400_000);
  return (
    <div className="flex gap-1 rounded-lg border border-slate-700 bg-slate-800 p-0.5">
      {options.map((o) => {
        const isToday = o.days === "today";
        const active = isToday ? activeDays === 0 : activeDays === o.days;
        return (
          <button
            key={o.label}
            onClick={() =>
              setFilters({
                ...filters,
                ...(isToday ? todayRange() : { from: Date.now() - (o.days as number) * 86400_000, to: Date.now() }),
              })
            }
            className={`rounded px-2.5 py-1 text-[12px] transition ${
              active ? "bg-cyan-600/30 font-semibold text-cyan-300" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
