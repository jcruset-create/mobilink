/**
 * Connect Pro — layout del backoffice: tema oscuro, topbar y sidebar fija
 * (mismo lenguaje visual que TyreControl / TyreLayout).
 */

import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Menu, LogOut, Home } from "lucide-react";
import { supabase } from "../../administracion/services/supabase";
import { CONNECT_NAV } from "../config/navigation";
import { useConnectAuth, hasRole } from "../contexts/ConnectAuthContext";
import { ROLE_LABELS } from "../types";
import AlertBell from "../components/AlertBell";
import logoMobilink from "../../../assets/logo-mobilink.png";

export default function ConnectLayout() {
  const { user, controlCenter } = useConnectAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const items = CONNECT_NAV.filter((i) => hasRole(user, i.minRole));

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate("/acceso", { replace: true });
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* Topbar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-700 bg-slate-900/95 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2 md:gap-3">
          <button className="rounded-lg p-1.5 hover:bg-slate-800 md:hidden" onClick={() => setOpen((v) => !v)}>
            <Menu className="h-5 w-5" />
          </button>
          <img src={logoMobilink} alt="Mobilink" className="h-8 w-auto" />
          <span className="whitespace-nowrap text-sm font-black leading-none">
            <span className="text-white">Assist</span>{" "}
            <span className="text-cyan-400">Connect</span>
            <span className="text-slate-100"> Pro</span>
          </span>
          {controlCenter && (
            <span className="ml-2 hidden rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300 sm:inline">
              {controlCenter.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {user && user.role !== "provider_user" && <AlertBell />}
          <button onClick={() => navigate("/inicio")} className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-800" title="Volver al hub">
            <Home className="h-4 w-4" />
          </button>
          <div className="hidden text-right sm:block">
            <div className="text-[12px] font-semibold leading-tight">👤 {user?.name || user?.email}</div>
            <div className="text-[10px] text-slate-400">{user ? ROLE_LABELS[user.role] : ""}</div>
          </div>
          <button onClick={handleSignOut} className="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-[12px] font-medium text-slate-200 hover:bg-slate-700">
            <LogOut className="h-4 w-4" /> Salir
          </button>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside
          className={`${open ? "block" : "hidden"} fixed inset-y-0 top-[49px] z-20 w-60 shrink-0 overflow-y-auto border-r border-slate-700 bg-slate-900 md:sticky md:block md:h-[calc(100vh-49px)]`}
        >
          <nav className="flex flex-col gap-0.5 p-2">
            {items.map((item) => {
              const Icon = item.icon;
              if (item.phase) {
                return (
                  <div
                    key={item.key}
                    className="flex cursor-not-allowed items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-slate-600"
                    title={`Disponible en fase ${item.phase.slice(1)}`}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="flex-1">{item.label}</span>
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">{item.phase}</span>
                  </div>
                );
              }
              return (
                <NavLink
                  key={item.key}
                  to={`/connect/${item.path}`}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] transition ${
                      isActive ? "bg-cyan-600/20 font-semibold text-cyan-300" : "text-slate-300 hover:bg-slate-800"
                    }`
                  }
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              );
            })}
          </nav>
        </aside>

        {/* Contenido */}
        <main className="min-w-0 flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
