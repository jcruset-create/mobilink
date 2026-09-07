import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { Menu, LogOut, Home } from "lucide-react";
import { useTyreAuth } from "../contexts/TyreAuthContext";
import { NAV, navVisible, SIEMPRE_VISIBLES } from "../config/navigation";
import { ROL_LABELS } from "../types";
import AlertasWebfleet from "../components/AlertasWebfleet";
import AsistenteChat from "../components/AsistenteChat";
import { supabase } from "../services/supabase";
import iconoAssist from "../../../assets/hub/icono-assist.png";

export default function TyreLayout() {
  const { perfil, pantallas, signOut } = useTyreAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  const esSuperadmin = Boolean(perfil?.es_superadmin);
  const items = NAV.filter((i) => navVisible(i, perfil?.rol, esSuperadmin, pantallas));

  // Acceso directo a Mobilink Assist: solo si la empresa tiene licencia del
  // módulo y el usuario acceso a él. app_mis_modulos ya cruza las dos cosas;
  // el superadmin lo ve siempre. Si la RPC no existe (base sin la fase SaaS)
  // no se enseña nada: mejor un botón de menos que uno que lleva a un 403.
  const [conAssist, setConAssist] = useState(false);
  useEffect(() => {
    let vivo = true;
    (async () => {
      if (esSuperadmin) { setConAssist(true); return; }
      try {
        const { data, error } = await supabase.rpc("app_mis_modulos");
        if (error) throw error;
        const mods = new Set((data ?? []).map((r: { modulo: string }) => r.modulo));
        if (vivo) setConAssist(mods.has("assist") || mods.has("asistencias"));
      } catch { if (vivo) setConAssist(false); }
    })();
    return () => { vivo = false; };
  }, [esSuperadmin, perfil?.id]);

  // Gating por URL (usuarios unificados): bloquea también el acceso directo
  const pantallaActual = location.pathname.split("/")[2] || "dashboard";
  const bloqueada =
    !esSuperadmin &&
    pantallas !== null &&
    !SIEMPRE_VISIBLES.includes(pantallaActual) &&
    !pantallas.includes(pantallaActual);

  async function handleSignOut() {
    await signOut();
    navigate("/tyrecontrol/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* Topbar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-700 bg-slate-900/95 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2 md:gap-3">
          <button className="rounded-lg p-1.5 hover:bg-slate-800 md:hidden" onClick={() => setOpen((v) => !v)}>
            <Menu className="h-5 w-5" />
          </button>
          <img src="/tyrecontrol-emblem.png" alt="" className="h-9 w-auto" />
          <span className="whitespace-nowrap text-sm font-black leading-none">
            <span className="text-white">Mobi</span>
            <span className="text-blue-400">link</span>{" "}
            <span className="text-green-400">Tyre</span>
            <span className="text-slate-100">Control</span>
          </span>
          <img
            src="/tyrecontrol-features.png"
            alt="Flotas, neumáticos, mantenimiento, informes"
            className="ml-2 hidden h-7 w-auto lg:block"
          />
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
          {conAssist && (
            <button onClick={() => navigate("/asistencias")} title="Ir a Mobilink Assist"
              className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-2 py-1 text-[12px] font-medium text-slate-200 hover:bg-slate-700">
              <img src={iconoAssist} alt="Mobilink Assist" className="h-6 w-6 rounded-md" />
              <span className="hidden md:inline">Assist</span>
            </button>
          )}
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

      {/* Asistente: acompaña a todo el módulo, sin ocupar sitio en las pantallas. */}
      <AsistenteChat />
    </div>
  );
}
