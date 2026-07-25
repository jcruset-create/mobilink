/**
 * Mobilink Assist Connect Pro — sub-aplicación del backoffice (/connect/*).
 * Estructura y lenguaje visual: patrón TyreControl (layout oscuro + sidebar).
 */

import { Navigate, Route, Routes } from "react-router-dom";
import { ConnectAuthProvider, ConnectAccessGate, useConnectAuth } from "./contexts/ConnectAuthContext";
import ConnectLayout from "./layouts/ConnectLayout";
import Dashboard from "./pages/Dashboard";
import Asistencias from "./pages/Asistencias";
import NuevaAsistencia from "./pages/NuevaAsistencia";
import FichaAsistencia from "./pages/FichaAsistencia";
import Empresas from "./pages/Empresas";
import Talleres from "./pages/Talleres";
import Integraciones from "./pages/Integraciones";
import Usuarios from "./pages/Usuarios";
import Auditoria from "./pages/Auditoria";
import Configuracion from "./pages/Configuracion";
import Ofertas from "./pages/Ofertas";
import CentroControl from "./pages/CentroControl";
import MapaOperativo from "./pages/MapaOperativo";
import Incidencias from "./pages/Incidencias";
import Estadisticas from "./pages/Estadisticas";
import Alertas from "./pages/Alertas";
import Clientes from "./pages/Clientes";
import Facturacion from "./pages/Facturacion";
import UnidadesMoviles from "./pages/UnidadesMoviles";
import Informes from "./pages/Informes";
import IntelligenceLayout from "./pages/inteligencia/IntelligenceLayout";
import OiResumen from "./pages/inteligencia/Resumen";
import OiTiempoReal from "./pages/inteligencia/TiempoReal";
import OiDemanda from "./pages/inteligencia/Demanda";
import OiProveedores from "./pages/inteligencia/Proveedores";
import OiFlota from "./pages/inteligencia/Flota";
import OiCalidad from "./pages/inteligencia/Calidad";
import OiEconomico from "./pages/inteligencia/Economico";
import OiRecomendaciones from "./pages/inteligencia/Recomendaciones";
import OiAlertas from "./pages/inteligencia/AlertasInteligentes";
import OiInformes from "./pages/inteligencia/InformesIA";
import OiConfiguracion from "./pages/inteligencia/ConfiguracionIA";

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
            <Route path="asistencias/:id" element={<FichaAsistencia />} />
            <Route path="nueva" element={<NuevaAsistencia />} />
            <Route path="ofertas" element={<Ofertas />} />
            <Route path="centro" element={<CentroControl />} />
            <Route path="mapa" element={<MapaOperativo />} />
            <Route path="incidencias" element={<Incidencias />} />
            <Route path="estadisticas" element={<Estadisticas />} />
            <Route path="sla" element={<Alertas />} />
            <Route path="clientes" element={<Clientes />} />
            <Route path="facturacion" element={<Facturacion />} />
            <Route path="unidades" element={<UnidadesMoviles />} />
            <Route path="informes" element={<Informes />} />
            {/* Centro de Inteligencia Operacional: subsección con navegación propia */}
            <Route path="inteligencia" element={<IntelligenceLayout />}>
              <Route index element={<OiResumen />} />
              <Route path="tiempo-real" element={<OiTiempoReal />} />
              <Route path="demanda" element={<OiDemanda />} />
              <Route path="proveedores" element={<OiProveedores />} />
              <Route path="flota" element={<OiFlota />} />
              <Route path="calidad" element={<OiCalidad />} />
              <Route path="economico" element={<OiEconomico />} />
              <Route path="recomendaciones" element={<OiRecomendaciones />} />
              <Route path="alertas" element={<OiAlertas />} />
              <Route path="informes" element={<OiInformes />} />
              <Route path="configuracion" element={<OiConfiguracion />} />
            </Route>
            <Route path="empresas" element={<Empresas />} />
            <Route path="talleres" element={<Talleres />} />
            <Route path="integraciones" element={<Integraciones />} />
            <Route path="usuarios" element={<Usuarios />} />
            <Route path="auditoria" element={<Auditoria />} />
            <Route path="configuracion" element={<Configuracion />} />
            <Route path="*" element={<Home />} />
          </Route>
        </Routes>
      </ConnectAccessGate>
    </ConnectAuthProvider>
  );
}
