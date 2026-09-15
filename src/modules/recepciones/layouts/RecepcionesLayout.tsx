/**
 * Layout de Recepciones: topbar pegajosa con los accesos a los otros módulos
 * y navegación lateral que colapsa en móvil. Misma estructura que Therefore.
 */

import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Menu, PackageCheck } from "lucide-react";
import AccesosCabecera from "../../../components/AccesosCabecera";
import { NAV, navVisible } from "../config/navigation";
import { useRecepciones } from "../contexts/RecepcionesContext";

export default function RecepcionesLayout() {
  const { permisos, rol, contadores, centroId, centros } = useRecepciones();
  const [abierto, setAbierto] = useState(false);
  const location = useLocation();
  const items = NAV.filter((i) => navVisible(i, permisos));
  // La pantalla del operario va a pantalla completa: sin menú lateral, que en
  // una tablet en el muelle sólo estorba.
  const sinMenu = /\/recibir\//.test(location.pathname);
  const centro = centros.find((c) => c.id === centroId);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 bg-slate-900/95 px-3 py-2 backdrop-blur print:hidden">
        <div className="flex items-center gap-2">
          {!sinMenu && (
            <button className="rounded-lg p-1.5 hover:bg-slate-800 md:hidden" onClick={() => setAbierto((v) => !v)} aria-label="Abrir el menú">
              <Menu className="h-5 w-5" />
            </button>
          )}
          <PackageCheck className="h-5 w-5 text-emerald-400" />
          <NavLink to="/recepciones/bandeja" className="text-sm font-black">
            Recepciones
          </NavLink>
          {centro && <span className="hidden rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300 sm:block">{centro.nombre}</span>}
        </div>
        <div className="flex items-center gap-3">
          {rol && <span className="hidden text-[11px] text-slate-400 sm:block">{rol}</span>}
          <AccesosCabecera actual="recepciones" />
        </div>
      </header>

      <div className="flex">
        {!sinMenu && (
          <nav className={`${abierto ? "block" : "hidden"} w-56 shrink-0 border-r border-slate-800 bg-slate-900 p-2 md:block print:hidden`}>
            {items.map((i) => {
              const n =
                i.key === "bandeja"
                  ? contadores?.pendientes
                  : i.key === "incidencias"
                    ? contadores?.incidenciasAbiertas
                    : i.key === "pedidos"
                      ? contadores?.pedidosPendientes
                      : i.key === "correo"
                        ? contadores?.correosEnRevision
                        : undefined;
              return (
                <NavLink
                  key={i.key}
                  to={`/recepciones/${i.path}`}
                  onClick={() => setAbierto(false)}
                  className={({ isActive }) =>
                    `mb-1 flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] ${isActive ? "bg-emerald-600 text-white" : "text-slate-300 hover:bg-slate-800"}`
                  }
                >
                  <i.icon className="h-4 w-4" />
                  <span className="flex-1">{i.label}</span>
                  {n ? <span className="rounded-full bg-slate-700/80 px-1.5 text-[10px] font-bold">{n}</span> : null}
                </NavLink>
              );
            })}
          </nav>
        )}
        <main className="min-w-0 flex-1 p-3 md:p-5">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
