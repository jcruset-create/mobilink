/**
 * Layout del módulo Tacógrafos.
 *
 * Misma estructura que `CashLayout`: topbar pegajosa y navegación lateral que
 * colapsa en móvil. La contraseña identificativa del centro se ve siempre: es
 * lo que distingue un centro técnico de otro y aparece en los tres documentos.
 */

import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { FileText, Menu, Settings, ShieldCheck } from "lucide-react";
import { useTacografos } from "../contexts/TacografosContext";

const NAV = [
  { a: "/tacografos/expedientes", texto: "Expedientes", icono: FileText, permiso: "tacografos.view" },
  { a: "/tacografos/custodia", texto: "Custodia y trámites", icono: ShieldCheck, permiso: "tacografos.view" },
  { a: "/tacografos/centro", texto: "Centro técnico", icono: Settings, permiso: "tacografos.view" },
];

export default function TacografosLayout() {
  const { centro, permisos, rol } = useTacografos();
  const [abierto, setAbierto] = useState(false);
  const items = NAV.filter((i) => permisos.includes(i.permiso));

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 bg-slate-900/95 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <button
            className="rounded-lg p-1.5 hover:bg-slate-800 md:hidden"
            onClick={() => setAbierto((v) => !v)}
            aria-label="Abrir el menú"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-bold tracking-wide">Tacógrafos</span>
          {centro?.numCentro && (
            <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
              {centro.numCentro}
            </span>
          )}
        </div>
        {rol && <span className="text-[11px] text-slate-400">{rol}</span>}
      </header>

      <div className="flex">
        <nav
          className={`${abierto ? "block" : "hidden"} w-52 shrink-0 border-r border-slate-800 bg-slate-900 p-2 md:block`}
        >
          {items.map((i) => (
            <NavLink
              key={i.a}
              to={i.a}
              onClick={() => setAbierto(false)}
              className={({ isActive }) =>
                `mb-1 flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] ${
                  isActive ? "bg-sky-600 text-white" : "text-slate-300 hover:bg-slate-800"
                }`
              }
            >
              <i.icono className="h-4 w-4" />
              {i.texto}
            </NavLink>
          ))}
        </nav>

        <main className="min-w-0 flex-1 p-3 md:p-5">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
