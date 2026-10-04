/**
 * Layout de Self Storage: cabecera pegajosa con el selector de centro y los
 * accesos a otros módulos, y menú lateral que en móvil se despliega. Misma
 * estructura que Recepciones.
 */

import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Container, Menu } from "lucide-react";
import AccesosCabecera from "../../../components/AccesosCabecera";
import { NAV, navVisible } from "../config/navigation";
import { useSelfStorage } from "../contexts/SelfStorageContext";
import { ETIQUETA_ROLE } from "../types";

export default function SelfStorageLayout() {
  const { permisos, rol, centros, centroId, fijarCentro, empresa, empresas, fijarEmpresa } = useSelfStorage();
  const [abierto, setAbierto] = useState(false);
  const items = NAV.filter((i) => navVisible(i, permisos));

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 bg-slate-900/95 px-3 py-2 backdrop-blur print:hidden">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button className="rounded-lg p-1.5 hover:bg-slate-800 md:hidden" onClick={() => setAbierto((v) => !v)} aria-label="Abrir el menú">
            <Menu className="h-5 w-5" />
          </button>
          <Container className="h-5 w-5 shrink-0 text-orange-400" />
          <NavLink to="/self-storage" className="text-sm font-black">
            Self Storage
          </NavLink>
          {empresas && empresas.length > 0 && (
            // Superadministrador: con qué empresa trabaja (lo valida el servidor).
            <select
              value={empresa?.id ?? ""}
              onChange={(e) => e.target.value && e.target.value !== empresa?.id && fijarEmpresa(e.target.value)}
              className="ml-1 max-w-[40vw] rounded-lg border border-orange-500/50 bg-slate-800 px-2 py-1 text-[12px] text-orange-200"
              aria-label="Empresa"
              title="Empresa con la que trabajas"
            >
              {empresa && !empresas.some((x) => x.id === empresa.id) && <option value={empresa.id}>{empresa.nombre || "Mi empresa"}</option>}
              {empresas.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nombre}
                </option>
              ))}
            </select>
          )}
          {centros.length > 0 && (
            <select
              value={centroId ?? ""}
              onChange={(e) => fijarCentro(e.target.value || null)}
              className="ml-1 max-w-[50vw] rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-[12px] text-slate-200"
              aria-label="Centro"
            >
              {centros.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.status === "inactive" ? " (inactivo)" : ""}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-3">
          {rol && <span className="hidden text-[11px] text-slate-400 sm:block">{ETIQUETA_ROLE[rol]}</span>}
          <AccesosCabecera actual="self-storage" />
        </div>
      </header>

      <div className="flex">
        <nav className={`${abierto ? "block" : "hidden"} w-56 shrink-0 border-r border-slate-800 bg-slate-900 p-2 md:block print:hidden`}>
          {items.map((i, n) => [
            i.grupo && i.grupo !== items[n - 1]?.grupo ? (
              <div key={`g-${i.grupo}`} className="mb-1 mt-3 px-3 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                {i.grupo}
              </div>
            ) : null,
            i.fase ? (
              <div
                key={i.key}
                className="mb-1 flex cursor-not-allowed items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-slate-600"
                title={`Disponible en la fase ${i.fase}`}
              >
                <i.icon className="h-4 w-4" />
                <span className="flex-1">{i.label}</span>
                <span className="rounded-full bg-slate-800 px-1.5 text-[10px] font-bold text-slate-500">F{i.fase}</span>
              </div>
            ) : (
              <NavLink
                key={i.key}
                to={`/self-storage/${i.path}`}
                end={i.path === "call-center" || i.path === "asistente"}
                onClick={() => setAbierto(false)}
                className={({ isActive }) =>
                  `mb-1 flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] ${isActive ? "bg-orange-600 text-white" : "text-slate-300 hover:bg-slate-800"}`
                }
              >
                <i.icon className="h-4 w-4" />
                <span className="flex-1">{i.label}</span>
              </NavLink>
            ),
          ])}
        </nav>
        <main className="min-w-0 flex-1 p-3 md:p-5">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
