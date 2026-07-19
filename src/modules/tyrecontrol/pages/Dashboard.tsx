import { useTyreAuth } from "../contexts/TyreAuthContext";
import { useFiltrosInformes } from "../hooks/useFiltrosInformes";
import { FiltroBarInformes } from "../components/informes/FiltroBarInformes";
import { DashboardEjecutivo } from "../components/informes/DashboardEjecutivo";

// Landing tras el login: dashboard ejecutivo con KPIs reales (mismos datos
// y filtros que la sección Informes). El detalle por informe vive en /informes.
export default function Dashboard() {
  const { perfil } = useTyreAuth();
  const { filtros, setFiltros, esCliente, empresas } = useFiltrosInformes();

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-black">Dashboard</h1>
          <p className="text-sm text-slate-400">Bienvenido{perfil?.nombre ? `, ${perfil.nombre}` : ""}. Panel de Mobilink TyreControl.</p>
        </div>
        <FiltroBarInformes filtros={filtros} setFiltros={setFiltros} esCliente={esCliente} empresas={empresas} />
      </div>
      <DashboardEjecutivo filtros={filtros} />
    </div>
  );
}
