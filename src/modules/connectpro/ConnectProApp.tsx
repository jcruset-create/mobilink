/**
 * Mobilink Assist Connect Pro — sub-aplicación del backoffice (/connect/*).
 * Estructura y lenguaje visual: patrón TyreControl (layout oscuro + sidebar).
 */

import { Navigate, Route, Routes } from "react-router-dom";
import { ConnectAuthProvider, ConnectAccessGate, useConnectAuth } from "./contexts/ConnectAuthContext";
import ConnectLayout from "./layouts/ConnectLayout";
import Dashboard from "./pages/Dashboard";
import Asistencias from "./pages/Asistencias";
import ColasOperativas from "./pages/ColasOperativas";
import NuevaAsistencia from "./pages/NuevaAsistencia";
import FichaAsistencia from "./pages/FichaAsistencia";
import Empresas from "./pages/Empresas";
import FichaEmpresa from "./pages/FichaEmpresa";
import FichaTaller from "./pages/FichaTaller";
import Talleres from "./pages/Talleres";
import Integraciones from "./pages/Integraciones";
import Usuarios from "./pages/Usuarios";
import Auditoria from "./pages/Auditoria";
import SaludLite from "./pages/SaludLite";
import Configuracion from "./pages/Configuracion";
import Ofertas from "./pages/Ofertas";
import CentroControl from "./pages/CentroControl";
import MapaOperativo from "./pages/MapaOperativo";
import Incidencias from "./pages/Incidencias";
import Estadisticas from "./pages/Estadisticas";
import Alertas from "./pages/Alertas";
import Clientes from "./pages/Clientes";
import Facturacion from "./pages/Facturacion";
import Tarifas from "./pages/Tarifas";
import PuestaEnMarcha from "./pages/PuestaEnMarcha";
import UnidadesMoviles from "./pages/UnidadesMoviles";
import Informes from "./pages/Informes";
import Inteligencia from "./pages/Inteligencia";

/**
 * Los usuarios de empresa proveedora aterrizan en Ofertas; el resto, en el
 * Dashboard. Rutas SIEMPRE absolutas: una redirección relativa desde una URL
 * no reconocida encadenaría /dashboard/dashboard/... en bucle infinito.
 */
function Home() {
  const { user } = useConnectAuth();
  return <Navigate to={user?.role === "provider_user" ? "/connect/ofertas" : "/connect/dashboard"} replace />;
}

export default function ConnectProApp() {
  return (
    <ConnectAuthProvider>
      <ConnectAccessGate>
        <Routes>
          <Route element={<ConnectLayout />}>
            <Route index element={<Home />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="asistencias" element={<Asistencias />} />
            <Route path="colas" element={<ColasOperativas />} />
            <Route path="colas/:cola" element={<ColasOperativas />} />
            {/* La antigua vista de activas es ahora una pestaña más */}
            <Route path="activas" element={<Navigate to="/connect/colas/activas" replace />} />
            <Route path="asistencias/:id" element={<FichaAsistencia />} />
            <Route path="nueva" element={<NuevaAsistencia />} />
            <Route path="ofertas" element={<Ofertas />} />
            <Route path="centro" element={<CentroControl />} />
            <Route path="mapa" element={<MapaOperativo />} />
            <Route path="incidencias" element={<Incidencias />} />
            <Route path="estadisticas" element={<Estadisticas />} />
            <Route path="sla" element={<Alertas />} />
            <Route path="clientes" element={<Clientes />} />
            <Route path="puesta-en-marcha" element={<PuestaEnMarcha />} />
            <Route path="tarifas" element={<Tarifas />} />
            <Route path="facturacion" element={<Facturacion />} />
            <Route path="unidades" element={<UnidadesMoviles />} />
            <Route path="informes" element={<Informes />} />
            <Route path="inteligencia" element={<Inteligencia />} />
            <Route path="empresas" element={<Empresas />} />
            <Route path="empresas/:id" element={<FichaEmpresa />} />
            <Route path="empresas/:id/talleres/:wid" element={<FichaTaller />} />
            {/* Vistas transversales: fuera del menú, pero las URLs siguen vivas */}
            <Route path="talleres" element={<Talleres />} />
            <Route path="integraciones" element={<Integraciones />} />
            <Route path="usuarios" element={<Usuarios />} />
            <Route path="salud-lite" element={<SaludLite />} />
            <Route path="auditoria" element={<Auditoria />} />
            <Route path="configuracion" element={<Configuracion />} />
            <Route path="*" element={<Home />} />
          </Route>
        </Routes>
      </ConnectAccessGate>
    </ConnectAuthProvider>
  );
}
