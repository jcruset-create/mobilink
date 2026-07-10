import { createContext, useContext, useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { listarEmpresas } from "../../services/data";
import type { Empresa } from "../../types";
import type { FiltrosInformes } from "../../types/informes";
import { inputCls } from "../../components/ui";
import { useTyreAuth } from "../../contexts/TyreAuthContext";

interface Ctx {
  filtros: FiltrosInformes;
  setFiltros: (f: FiltrosInformes) => void;
  esCliente: boolean;
}
const InformesCtx = createContext<Ctx | null>(null);

// Filtros globales compartidos por todos los informes.
export function useInformesFiltros(): Ctx {
  const c = useContext(InformesCtx);
  if (!c) throw new Error("useInformesFiltros fuera de InformesLayout");
  return c;
}

const TABS = [
  { to: "/tyrecontrol/informes", label: "Dashboard", end: true },
  { to: "/tyrecontrol/informes/estado-flota", label: "Estado de flota", end: false },
  { to: "/tyrecontrol/informes/inventario", label: "Neumáticos controlados", end: false },
];

export default function InformesLayout() {
  const { perfil } = useTyreAuth();
  const esCliente = perfil?.rol === "cliente" && !perfil?.es_superadmin;

  const [filtros, setFiltros] = useState<FiltrosInformes>({
    empresaId: esCliente ? (perfil?.empresa_id ?? null) : null,
    desde: null,
    hasta: null,
  });
  const [empresas, setEmpresas] = useState<Empresa[]>([]);

  useEffect(() => {
    if (!esCliente) listarEmpresas().then(setEmpresas).catch(() => setEmpresas([]));
  }, [esCliente]);

  return (
    <InformesCtx.Provider value={{ filtros, setFiltros, esCliente }}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-black">Informes</h1>
        <div className="flex flex-wrap items-center gap-2">
          {!esCliente && (
            <select
              className={`${inputCls} w-auto`}
              value={filtros.empresaId ?? ""}
              onChange={(e) => setFiltros({ ...filtros, empresaId: e.target.value || null })}
            >
              <option value="">Todas las empresas</option>
              {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
          )}
          <input type="date" className={`${inputCls} w-auto`} value={filtros.desde ?? ""} onChange={(e) => setFiltros({ ...filtros, desde: e.target.value || null })} title="Desde" />
          <input type="date" className={`${inputCls} w-auto`} value={filtros.hasta ?? ""} onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value || null })} title="Hasta" />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-700">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `rounded-t px-3 py-2 text-[13px] font-semibold ${isActive ? "border-b-2 border-sky-400 text-sky-300" : "text-slate-400 hover:text-slate-200"}`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </div>

      <Outlet />
    </InformesCtx.Provider>
  );
}
