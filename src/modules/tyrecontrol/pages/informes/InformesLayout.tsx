import { createContext, useContext } from "react";
import { NavLink, Outlet } from "react-router-dom";
import type { FiltrosInformes } from "../../types/informes";
import { useFiltrosInformes } from "../../hooks/useFiltrosInformes";
import { FiltroBarInformes } from "../../components/informes/FiltroBarInformes";

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
  { to: "/tyrecontrol/informes/alertas", label: "Alertas" },
  { to: "/tyrecontrol/informes/estado-flota", label: "Estado de flota" },
  { to: "/tyrecontrol/informes/inventario", label: "Neumáticos controlados" },
];

export default function InformesLayout() {
  const { filtros, setFiltros, esCliente, empresas } = useFiltrosInformes();

  return (
    <InformesCtx.Provider value={{ filtros, setFiltros, esCliente }}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-black">Informes</h1>
        <FiltroBarInformes filtros={filtros} setFiltros={setFiltros} esCliente={esCliente} empresas={empresas} />
      </div>

      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-700">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
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
