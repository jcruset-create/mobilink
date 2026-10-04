/**
 * Mobilink Self Storage — punto de entrada del módulo en el panel.
 *
 * Misma forma que `RecepcionesApp`: proveedor de estado, layout y rutas hijas
 * bajo `/self-storage/*`. Si el usuario no tiene acceso, se explica en lugar
 * de dejar la pantalla en blanco.
 *
 * Fase 1: dashboard, plano, trasteros, clientes, centros/zonas, tipos e
 * importación. Fase 2: contratos, facturas, pagos, impagos, conceptos y
 * configuración. Fase 3: puertas (hardware) y accesos. Call Center: llamadas,
 * incidencias, operadores, catálogo, configuración y logs (sin IA).
 */

import { Navigate, Route, Routes } from "react-router-dom";
import { SelfStorageProvider, useSelfStorage } from "./contexts/SelfStorageContext";
import SelfStorageLayout from "./layouts/SelfStorageLayout";
import Dashboard from "./pages/Dashboard";
import Centros from "./pages/Centros";
import Tipos from "./pages/Tipos";
import Trasteros from "./pages/Trasteros";
import Plano from "./pages/Plano";
import Clientes from "./pages/Clientes";
import ClienteDetalle from "./pages/ClienteDetalle";
import Importar from "./pages/Importar";
import Contratos from "./pages/Contratos";
import ContratoDetalle from "./pages/ContratoDetalle";
import Facturas from "./pages/Facturas";
import Pagos from "./pages/Pagos";
import Impagos from "./pages/Impagos";
import Conceptos from "./pages/Conceptos";
import Configuracion from "./pages/Configuracion";
import Puertas from "./pages/Puertas";
import Accesos from "./pages/Accesos";
import Incidencias from "./pages/Incidencias";
import CallCenterDashboard from "./pages/callcenter/CallCenterDashboard";
import Llamadas from "./pages/callcenter/Llamadas";
import Llamada from "./pages/callcenter/Llamada";
import Operadores from "./pages/callcenter/Operadores";
import Catalogo from "./pages/callcenter/Catalogo";
import ConfigCallCenter from "./pages/callcenter/ConfigCallCenter";
import LogsCallCenter from "./pages/callcenter/Logs";
import { inicioPara } from "./config/navigation";

function Contenido() {
  const { cargando, error, permisos, puede } = useSelfStorage();

  if (cargando) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-900 text-sm text-slate-400">Cargando Self Storage…</div>;
  }

  if (error || permisos.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 p-6">
        <div className="max-w-md rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6 text-sm text-amber-200">
          <p className="mb-1 font-bold">No se ha podido abrir Self Storage</p>
          <p>{error || "Tu usuario no tiene acceso al módulo. Pídeselo a un administrador."}</p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route element={<SelfStorageLayout />}>
        <Route index element={<Navigate to={`/self-storage/${inicioPara(permisos)}`} replace />} />
        {puede("ss.view") && <Route path="dashboard" element={<Dashboard />} />}
        {puede("ss.view") && <Route path="plano" element={<Plano />} />}
        {puede("ss.view") && <Route path="trasteros" element={<Trasteros />} />}
        {puede("ss.view") && <Route path="centros" element={<Centros />} />}
        {puede("ss.view") && <Route path="tipos" element={<Tipos />} />}
        {puede("ss.customers.view") && <Route path="clientes" element={<Clientes />} />}
        {puede("ss.customers.view") && <Route path="clientes/:id" element={<ClienteDetalle />} />}
        {puede("ss.import") && <Route path="importar" element={<Importar />} />}
        {puede("ss.contracts.view") && <Route path="contratos" element={<Contratos />} />}
        {puede("ss.contracts.view") && <Route path="contratos/:id" element={<ContratoDetalle />} />}
        {puede("ss.billing.view") && <Route path="facturas" element={<Facturas />} />}
        {puede("ss.billing.view") && <Route path="pagos" element={<Pagos />} />}
        {puede("ss.billing.view") && <Route path="impagos" element={<Impagos />} />}
        {puede("ss.billing.view") && <Route path="conceptos" element={<Conceptos />} />}
        {puede("ss.doors.view") && <Route path="puertas" element={<Puertas />} />}
        {puede("ss.access.view") && <Route path="accesos" element={<Accesos />} />}
        {puede("ss.settings.manage") && <Route path="configuracion" element={<Configuracion />} />}
        {puede("ss.incidents.view") && <Route path="incidencias" element={<Incidencias />} />}
        {puede("ss.callcenter.view") && <Route path="call-center" element={<CallCenterDashboard />} />}
        {puede("ss.callcenter.view") && <Route path="call-center/llamadas" element={<Llamadas />} />}
        {puede("ss.callcenter.create") && <Route path="call-center/llamada" element={<Llamada />} />}
        {puede("ss.callcenter.view") && <Route path="call-center/llamada/:id" element={<Llamada />} />}
        {puede("ss.callcenter.view") && <Route path="call-center/operadores" element={<Operadores />} />}
        {puede("ss.callcenter.view") && <Route path="call-center/motivos" element={<Catalogo />} />}
        {puede("ss.settings.manage") && <Route path="call-center/configuracion" element={<ConfigCallCenter />} />}
        {puede("ss.callcenter.view") && <Route path="call-center/logs" element={<LogsCallCenter />} />}
        <Route path="*" element={<Navigate to={`/self-storage/${inicioPara(permisos)}`} replace />} />
      </Route>
    </Routes>
  );
}

export default function SelfStorageApp() {
  return (
    <SelfStorageProvider>
      <Contenido />
    </SelfStorageProvider>
  );
}
