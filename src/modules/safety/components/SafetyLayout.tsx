import { useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  ArrowLeftRight,
  CalendarDays,
  ClipboardCheck,
  FileText,
  GraduationCap,
  HardHat,
  Home,
  LayoutDashboard,
  Menu,
  PackageCheck,
  X,
} from "lucide-react";

const LINKS = [
  { to: "/safety", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/safety/epis", label: "EPIs", icon: HardHat },
  { to: "/safety/entregas", label: "Entregas", icon: PackageCheck },
  { to: "/safety/stock", label: "Stock", icon: ArrowLeftRight },
  { to: "/safety/documentos", label: "Documentos", icon: FileText },
  { to: "/safety/reuniones", label: "Reuniones", icon: CalendarDays },
  { to: "/safety/formacion", label: "Formación", icon: GraduationCap },
  { to: "/safety/inspecciones", label: "Inspecciones", icon: ClipboardCheck },
];

type Props = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
};

/** Estructura visual unificada con Mobilink Assist: tema oscuro slate,
 *  barra lateral (cajón deslizante en móvil) y cabecera fija con logo. */
export default function SafetyLayout({ title, subtitle, actions, children }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen bg-slate-900 text-slate-100">
      {/* Backdrop del cajón en móvil */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Barra lateral ── */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 transform flex-col border-r border-slate-800 bg-slate-950 transition-transform duration-200 md:static md:z-auto md:w-52 md:flex-shrink-0 md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-end p-2 md:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav
          onClick={() => setSidebarOpen(false)}
          className="flex flex-1 flex-col gap-1 overflow-y-auto p-2 pt-1 text-sm md:pt-3"
        >
          {LINKS.map(({ to, label, icon: Icon, exact }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-left font-medium transition-colors ${
                  isActive
                    ? "bg-amber-500 text-amber-950"
                    : "text-slate-300 hover:bg-slate-800"
                }`
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 truncate">{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-800 px-4 py-2 text-[10px] text-slate-500">
          Mobilink Safety Manager
        </div>
      </aside>

      {/* ── Columna principal ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/95 px-4 py-2.5 backdrop-blur">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-slate-200 hover:bg-slate-700 md:hidden"
              aria-label="Abrir menú"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center justify-center px-1">
              <img src="/logo_horizontal.png" alt="Mobilink Safety Manager" className="h-9 md:h-12" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-bold md:text-base">{title}</h1>
              {subtitle && <div className="truncate text-xs text-slate-400">{subtitle}</div>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            <button
              type="button"
              onClick={() => navigate("/inicio")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
            >
              <Home className="h-4 w-4" /> <span className="hidden sm:inline">Inicio</span>
            </button>
          </div>
        </header>

        <main className="flex-1 space-y-4 overflow-auto p-4">{children}</main>
      </div>
    </div>
  );
}
