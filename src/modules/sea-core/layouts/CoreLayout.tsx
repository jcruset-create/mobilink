import { useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Menu, Home, LayoutDashboard, Users, Building2, MapPin, Target, KeyRound } from "lucide-react";

const NAV = [
  { to: "/sea-core", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/sea-core/empleados", label: "Empleados", icon: Users, end: false },
  { to: "/sea-core/empresas", label: "Empresas", icon: Building2, end: false },
  { to: "/sea-core/centros", label: "Centros de trabajo", icon: MapPin, end: false },
  { to: "/sea-core/competencias", label: "Competencias", icon: Target, end: false },
  { to: "/sea-core/autorizaciones", label: "Autorizaciones", icon: KeyRound, end: false },
];

// Shell del módulo Mobilink Core con el mismo estilo que Mobilink TyreControl:
// topbar oscuro + sidebar izquierda (activo en sky-600) sobre fondo slate.
export default function CoreLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* Topbar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-700 bg-slate-900/95 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <button className="rounded-lg p-1.5 hover:bg-slate-800 md:hidden" onClick={() => setOpen((v) => !v)}>
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-sky-600">
            <span className="text-[10px] font-black text-white">SC</span>
          </div>
          <span className="text-sm font-black">Mobilink Core</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/inicio")} title="Volver al inicio" className="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-[12px] font-medium text-slate-200 hover:bg-slate-700">
            <Home className="h-4 w-4" /> Inicio
          </button>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1500px]">
        {/* Sidebar */}
        <aside className={`${open ? "block" : "hidden"} w-52 shrink-0 border-r border-slate-700 bg-slate-900 p-2 md:block`}>
          <nav className="flex flex-col gap-1">
            {NAV.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium ${
                      isActive ? "bg-sky-600 text-white" : "text-slate-300 hover:bg-slate-800"
                    }`
                  }
                >
                  <Icon className="h-4 w-4" /> {item.label}
                </NavLink>
              );
            })}
          </nav>
        </aside>

        {/* Contenido */}
        <main className="min-w-0 flex-1 space-y-4 p-3">{children}</main>
      </div>
    </div>
  );
}
