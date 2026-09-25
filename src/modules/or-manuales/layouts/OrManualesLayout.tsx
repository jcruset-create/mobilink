/**
 * Layout de OR Manuales: topbar pegajosa con los accesos a los otros módulos
 * y navegación lateral que colapsa en móvil. Misma estructura que Recepciones.
 *
 * Los contadores del menú son los indicadores del módulo: lo que hay que
 * mirar —documentos pendientes y avisos— se ve sin entrar en la pantalla.
 */

import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { FileStack, Menu } from "lucide-react";
import AccesosCabecera from "../../../components/AccesosCabecera";
import VersionDesplegada from "../../../components/VersionDesplegada";
import { NAV, navVisible } from "../config/navigation";
import { useOrManuales } from "../contexts/OrManualesContext";

export default function OrManualesLayout() {
  const { permisos, rol, indicadores } = useOrManuales();
  const [abierto, setAbierto] = useState(false);
  const items = NAV.filter((i) => navVisible(i, permisos));

  const contador = (key: string) => {
    if (key === "pendientes") return indicadores?.documentosPorRevisar;
    if (key === "avisos") return indicadores?.avisosAbiertos;
    if (key === "blocs") return indicadores?.blocsIncompletos;
    if (key === "escanear") return indicadores?.procesosEnCurso;
    return undefined;
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 bg-slate-900/95 px-3 py-2 backdrop-blur print:hidden">
        <div className="flex items-center gap-2">
          <button className="rounded-lg p-1.5 hover:bg-slate-800 md:hidden" onClick={() => setAbierto((v) => !v)} aria-label="Abrir el menú">
            <Menu className="h-5 w-5" />
          </button>
          <FileStack className="h-5 w-5 text-teal-400" />
          <NavLink to="/or-manuales/panel" className="text-sm font-black">
            OR Manuales
          </NavLink>
        </div>
        <div className="flex items-center gap-3">
          {rol && <span className="hidden text-[11px] text-slate-400 sm:block">{rol}</span>}
          {/*
            El número del panel y el commit desplegado. El mismo componente que
            usan Therefore y TyreControl: aquí hace falta por lo mismo que allí
            —«¿ya está subido el arreglo?»— y además avisa cuando el navegador
            arrastra un bundle viejo de la caché, que es de donde salió el
            primer «no funciona, se queda en blanco» de este módulo.
          */}
          <VersionDesplegada className="hidden sm:inline" />
          <AccesosCabecera actual="or-manuales" />
        </div>
      </header>

      <div className="flex">
        <nav
          className={`${abierto ? "block" : "hidden"} w-56 shrink-0 border-r border-slate-800 bg-slate-900 p-2 md:block print:hidden`}
        >
          {items.map((i) => {
            const n = contador(i.key);
            return (
              <NavLink
                key={i.key}
                to={`/or-manuales/${i.path}`}
                onClick={() => setAbierto(false)}
                className={({ isActive }) =>
                  `mb-1 flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] ${
                    isActive ? "bg-teal-600 text-white" : "text-slate-300 hover:bg-slate-800"
                  }`
                }
              >
                <i.icon className="h-4 w-4" />
                <span className="flex-1">{i.label}</span>
                {n ? <span className="rounded-full bg-slate-700/80 px-1.5 text-[10px] font-bold">{n}</span> : null}
              </NavLink>
            );
          })}
        </nav>
        <main className="min-w-0 flex-1 p-3 md:p-5">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
