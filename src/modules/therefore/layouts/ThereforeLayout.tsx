/**
 * Layout de Therefore.
 *
 * Misma estructura que `TacografosLayout`: topbar pegajosa con los accesos a
 * los otros módulos y navegación lateral que colapsa en móvil.
 *
 * La navegación es corta a propósito: esto es una bandeja de trabajo, no un
 * cliente de correo. Quien entra viene a ver qué le toca hacer, y todo lo demás
 * cuelga del expediente.
 */

import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { HelpCircle, Inbox, Menu, Settings } from "lucide-react";
import AccesosCabecera from "../../../components/AccesosCabecera";
import VersionDesplegada from "../../../components/VersionDesplegada";
import { useTherefore } from "../contexts/ThereforeContext";

const NAV = [
  { a: "/therefore/bandeja", texto: "Bandeja", icono: Inbox, permiso: "therefore.view" },
  // Se ve con «therefore.view» aunque resolver pida su propio permiso: saber
  // qué está parado esperando una decisión le sirve a cualquiera que mire la
  // cola, aunque no sea quien decida.
  { a: "/therefore/revision", texto: "Revisión", icono: HelpCircle, permiso: "therefore.view" },
  {
    a: "/therefore/configuracion",
    texto: "Configuración",
    icono: Settings,
    permiso: "therefore.config.edit",
  },
];

export default function ThereforeLayout() {
  const { permisos, rol } = useTherefore();
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
          <Inbox className="h-5 w-5 text-sky-400" />
          <span className="text-sm font-black">Therefore</span>
        </div>
        <div className="flex items-center gap-3">
          {rol && <span className="hidden text-[11px] text-slate-400 sm:block">{rol}</span>}
          {/*
            El número y el commit desplegado. En un módulo que se calibra
            contra documentos reales, «¿ya está subido el arreglo?» se pregunta
            cada día, y sin esto la única respuesta era volver a probarlo.
          */}
          <VersionDesplegada className="hidden sm:inline" />
          <AccesosCabecera actual="therefore" />
        </div>
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
