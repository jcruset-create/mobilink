/**
 * Layout de Mobilink Cash.
 *
 * Misma estructura que `AdminLayout`: topbar pegajosa con el nombre del módulo
 * y sidebar de w-52 colapsable en móvil. Lo propio de caja es el selector de
 * caja física y el indicador de jornada, que tienen que verse desde cualquier
 * pantalla: saber si la caja está abierta y con cuánto es lo primero que mira
 * quien está en el mostrador.
 */

import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Menu, Home, Wallet, CircleDot } from "lucide-react";
import { useCash } from "../contexts/CashContext";
import { NAV, navVisible } from "../config/navigation";
import { euros } from "../utils/money";

export default function CashLayout() {
  const { cajas, cajaId, seleccionarCaja, jornada, permisos, rol } = useCash();
  const navigate = useNavigate();
  const [abierto, setAbierto] = useState(false);

  const items = NAV.filter((i) => navVisible(i, permisos));
  const enMarcha = jornada?.sesion?.estado === "OPEN" || jornada?.sesion?.estado === "REOPENED";

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
          <Wallet className="h-5 w-5 text-sky-400" />
          <span className="text-sm font-black">Mobilink Cash</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {cajas.length > 0 && (
            <select
              value={cajaId ?? ""}
              onChange={(e) => seleccionarCaja(Number(e.target.value))}
              aria-label="Caja"
              className="rounded-lg border border-slate-600 bg-slate-900 px-2 py-1.5 text-[12px] text-slate-100 outline-none focus:ring-2 focus:ring-sky-500"
            >
              {cajas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.centro ? `${c.centro} · ` : ""}
                  {c.nombre}
                </option>
              ))}
            </select>
          )}

          <div
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium ${
              enMarcha ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-800 text-slate-400"
            }`}
            title={enMarcha ? "Jornada abierta" : "No hay ninguna jornada abierta"}
          >
            <CircleDot className="h-3.5 w-3.5" />
            {enMarcha ? (
              <span className="tabular-nums">{euros(jornada!.totalStockCentimos)}</span>
            ) : (
              "Caja cerrada"
            )}
          </div>

          {rol && (
            <span className="hidden text-[10px] uppercase tracking-wide text-slate-500 sm:inline">
              {rol}
            </span>
          )}

          <button
            onClick={() => navigate("/inicio")}
            title="Volver al inicio"
            className="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-[12px] font-medium text-slate-200 hover:bg-slate-700"
          >
            <Home className="h-4 w-4" /> Inicio
          </button>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1500px]">
        <aside
          className={`${abierto ? "block" : "hidden"} w-52 shrink-0 border-r border-slate-700 bg-slate-900 p-2 md:block`}
        >
          <nav className="flex flex-col gap-1">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.key}
                  to={`/cash/${item.path}`}
                  onClick={() => setAbierto(false)}
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

        <main className="min-w-0 flex-1 p-3">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
