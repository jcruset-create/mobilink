import { useState } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { Menu, LogOut, Truck, Home } from "lucide-react";
import { useTyreAuth } from "../contexts/TyreAuthContext";
import { NAV, navVisible } from "../config/navigation";
import { ROL_LABELS } from "../types";
import AlertasWebfleet from "../components/AlertasWebfleet";

export default function TyreLayout() {
  const { perfil, pantallas, signOut } = useTyreAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  const esSuperadmin = Boolean(perfil?.es_superadmin);
  const items = NAV.filter((i) => navVisible(i, perfil?.rol, esSuperadmin, pantallas));

  // Gating por URL (usuarios unificados): bloquea también el acceso directo
  const pantallaActual = location.pathname.split("/")[2] || "dashboard";
  const bloqueada =
    !esSuperadmin &&
    pantallas !== null &&
    pantallaActual !== "dashboard" &&
    !pantallas.includes(pantallaActual);

  async function handleSignOut() {
    await signOut();
    navigate("/tyrecontrol/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* Topbar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-700 bg-slate-900/95 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <button className="rounded-lg p-1.5 hover:bg-slate-800 md:hidden" onClick={() => setOpen((v) => !v)}>
            <Menu className="h-5 w-5" />
          </button>
          <Truck className="h-5 w-5 text-sky-400" />
          <span className="text-sm font-black">SEA TyreControl</span>
        </div>
        <div className="flex items-center gap-3">
          <AlertasWebfleet />
          <div className="hidden text-right sm:block">
            <div className="text-[12px] font-semibold leading-tight">👤 {perfil?.nombre}</div>
            <div className="text-[10px] text-slate-400">
              {perfil?.es_superadmin ? "Super-admin" : perfil ? ROL_LABELS[perfil.rol] : ""}
              {perfil?.empresa?.nombre ? ` · ${perfil.empresa.nombre}` : ""}
            </div>
          </div>
          <button onClick={() => navigate("/inicio")} title="Volver al inicio" className="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-[12px] font-medium text-slate-200 hover:bg-slate-700">
            <Home className="h-4 w-4" /> Inicio
          </button>
          <button onClick={handleSignOut} className="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-[12px] font-medium text-slate-200 hover:bg-slate-700">
            <LogOut className="h-4 w-4" /> Salir
          </button>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1500px]">
        {/* Sidebar */}
        <aside className={`${open ? "block" : "hidden"} w-52 shrink-0 border-r border-slate-700 bg-slate-900 p-2 md:block`}>
          <nav className="flex flex-col gap-1">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.key}
                  to={`/tyrecontrol/${item.path}`}
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
        <main className="min-w-0 flex-1 p-3">
          {bloqueada ? (
            <div className="max-w-md rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6 text-sm text-amber-300">
              No tienes acceso a esta pantalla. Contacta con un administrador.
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  );
}
