import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Menu, LogOut, Truck } from "lucide-react";
import { useTyreAuth } from "../contexts/TyreAuthContext";
import { NAV, navVisible } from "../config/navigation";
import { ROL_LABELS } from "../types";

export default function TyreLayout() {
  const { perfil, signOut } = useTyreAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const items = NAV.filter((i) => navVisible(i, perfil?.rol, Boolean(perfil?.es_superadmin)));

  async function handleSignOut() {
    await signOut();
    navigate("/tyrecontrol/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Topbar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <button className="rounded-lg p-1.5 hover:bg-slate-100 md:hidden" onClick={() => setOpen((v) => !v)}>
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-slate-700" />
            <span className="text-sm font-black">SEA TyreControl</span>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <div className="hidden text-right sm:block">
            <div className="font-semibold leading-tight">{perfil?.nombre}</div>
            <div className="text-[11px] text-slate-400">
              {perfil?.es_superadmin ? "Super-admin" : perfil ? ROL_LABELS[perfil.rol] : ""}
              {perfil?.empresa?.nombre ? ` · ${perfil.empresa.nombre}` : ""}
            </div>
          </div>
          <button onClick={handleSignOut} className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <LogOut className="h-4 w-4" /> Salir
          </button>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1400px]">
        {/* Sidebar */}
        <aside className={`${open ? "block" : "hidden"} w-56 shrink-0 border-r border-slate-200 bg-white p-3 md:block`}>
          <nav className="flex flex-col gap-1">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.key}
                  to={item.path}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ${
                      isActive ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
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
        <main className="min-w-0 flex-1 p-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
