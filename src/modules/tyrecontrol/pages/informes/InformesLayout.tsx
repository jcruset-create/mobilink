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

// `interna: true` marca los informes que un CLIENTE no debe ver: Económico y
// Rankings enseñan costes de compra; Productividad, los tiempos de los
// técnicos de Mobilink; Operaciones e Historial neumático usan formato y
// códigos internos. Ocultar la pestaña no basta: las rutas de estos informes
// están además bajo RoleRoute administrador en TyreControlApp.tsx — si se
// añade un informe interno aquí, hay que añadirlo TAMBIÉN allí.
const TABS = [
  { to: "/tyrecontrol/informes/ejecutivo", label: "Ejecutivo" },
  { to: "/tyrecontrol/informes/alertas", label: "Alertas" },
  { to: "/tyrecontrol/informes/estado-flota", label: "Estado de flota" },
  { to: "/tyrecontrol/informes/inventario", label: "Neumáticos controlados" },
  { to: "/tyrecontrol/informes/economico", label: "Económico", interna: true },
  { to: "/tyrecontrol/informes/rankings", label: "Rankings", interna: true },
  { to: "/tyrecontrol/informes/desgaste", label: "Desgaste" },
  { to: "/tyrecontrol/informes/presiones", label: "Presiones" },
  { to: "/tyrecontrol/informes/productividad", label: "Productividad", interna: true },
  { to: "/tyrecontrol/informes/operaciones-informe", label: "Operaciones", interna: true },
  { to: "/tyrecontrol/informes/historial-neumatico", label: "Historial neumático", interna: true },
  { to: "/tyrecontrol/informes/historial-vehiculo", label: "Historial vehículo" },
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
        {TABS.filter((t) => !esCliente || !t.interna).map((t) => (
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
