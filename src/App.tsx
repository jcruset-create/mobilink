import type { ReactNode } from "react";
import { Routes, Route } from "react-router-dom";

import SeaTarragonaV1 from "./SeaTarragonaV1";
import RoadsideOperatorPage from "./pages/RoadsideOperatorPage";
import WorkshopOperatorPage from "./pages/WorkshopOperatorPage";
import RoadsideTrackingPage from "./pages/RoadsideTrackingPage";
import RoadsideReportPage from "./pages/RoadsideReportPage";
import FlotaMapPage from "./pages/FlotaMapPage";
import OtfPage from "./pages/OtfPage";
import OtfTvPage from "./pages/OtfTvPage";
import VehiculoHistorialPage from "./pages/VehiculoHistorialPage";
import DashboardPage from "./pages/DashboardPage";

import CobrosDashboard from "./modules/cobros/pages/CobrosDashboard";

import SafetyDashboard from "./modules/safety/pages/SafetyDashboard";
import Epis from "./modules/safety/pages/Epis";
import Entregas from "./modules/safety/pages/Entregas";
import StockEpis from "./modules/safety/pages/Stock";
import Documentos from "./modules/safety/pages/Documentos";
import Reuniones from "./modules/safety/pages/Reuniones";
import Formacion from "./modules/safety/pages/Formacion";
import Inspecciones from "./modules/safety/pages/Inspecciones";

import ToolControlDashboard from "./modules/toolcontrol/pages/ToolControlDashboard";
import Herramientas from "./modules/toolcontrol/pages/Herramientas";
import Maquinas from "./modules/toolcontrol/pages/Maquinas";
import Movimientos from "./modules/toolcontrol/pages/Movimientos";
import Mantenimiento from "./modules/toolcontrol/pages/Mantenimiento";
import InventarioTC from "./modules/toolcontrol/pages/Inventario";
import IncidenciasTC from "./modules/toolcontrol/pages/Incidencias";
import Ubicaciones from "./modules/toolcontrol/pages/Ubicaciones";
import CategoriasTC from "./modules/toolcontrol/pages/Categorias";
import PaymentResult from "./modules/cobros/pages/PaymentResult";

import Login from "./modules/almacen-neumaticos/pages/Login";
import RequireAuth from "./modules/almacen-neumaticos/components/RequireAuth";
import RequireRole from "./modules/almacen-neumaticos/components/RequireRole";

import AlmacenDashboard from "./modules/almacen-neumaticos/pages/AlmacenDashboard";
import StockOperativo from "./modules/almacen-neumaticos/pages/StockOperativo";
import EntradasStock from "./modules/almacen-neumaticos/pages/EntradasStock";
import SalidasMontajes from "./modules/almacen-neumaticos/pages/SalidasMontajes";
import HistorialMovimientos from "./modules/almacen-neumaticos/pages/HistorialMovimientos";
import Traspasos from "./modules/almacen-neumaticos/pages/Traspasos";
import Reposiciones from "./modules/almacen-neumaticos/pages/Reposiciones";
import Inventarios from "./modules/almacen-neumaticos/pages/Inventarios";
import Incidencias from "./modules/almacen-neumaticos/pages/Incidencias";
import ProductosNeumaticos from "./modules/almacen-neumaticos/pages/ProductosNeumaticos";
import ClientesAlmacen from "./modules/almacen-neumaticos/pages/ClientesAlmacen";
import VehiculosAlmacen from "./modules/almacen-neumaticos/pages/VehiculosAlmacen";
import CentrosAlmacen from "./modules/almacen-neumaticos/pages/CentrosAlmacen";
import UsuariosAlmacen from "./modules/almacen-neumaticos/pages/UsuariosAlmacen";
import AuditoriaAlmacen from "./modules/almacen-neumaticos/pages/AuditoriaAlmacen";
import SistemaAlmacen from "./modules/almacen-neumaticos/pages/SistemaAlmacen";
import NotFound from "./pages/NotFound";
import SeaHub from "./pages/SeaHub";
import QrScan from "./pages/QrScan";
import PortalLogin from "./pages/PortalLogin";
import PortalFicha from "./pages/PortalFicha";
import MobileAlmacen from "./modules/almacen-neumaticos/pages/MobileAlmacen";
import MobileAuditoria from "./modules/almacen-neumaticos/pages/MobileAuditoria";
import MobileTraspasoDetalle from "./modules/almacen-neumaticos/pages/MobileTraspasoDetalle";

import PresenciaDashboard from "./modules/presencia/pages/PresenciaDashboard";
import Fichajes from "./modules/presencia/pages/Fichajes";

import CoreDashboard from "./modules/sea-core/pages/CoreDashboard";
import Empleados from "./modules/sea-core/pages/Empleados";
import EmpleadoDetalle from "./modules/sea-core/pages/EmpleadoDetalle";
import Empresas from "./modules/sea-core/pages/Empresas";
import CentrosTrabajo from "./modules/sea-core/pages/CentrosTrabajo";
import CoreCompetencias from "./modules/sea-core/pages/Competencias";
import CoreAutorizaciones from "./modules/sea-core/pages/Autorizaciones";

import TyreControlApp from "./modules/tyrecontrol/TyreControlApp";
import AdministracionApp from "./modules/administracion/AdministracionApp";
import AccesoPage from "./pages/AccesoPage";
import InicioPage from "./pages/InicioPage";

type RolAlmacen = "admin" | "responsable" | "operario";

function Protegida({ children }: { children: ReactNode }) {
  return <RequireAuth>{children}</RequireAuth>;
}

function ProtegidaPorRol({
  roles,
  children,
}: {
  roles: RolAlmacen[];
  children: ReactNode;
}) {
  return (
    <RequireAuth>
      <RequireRole roles={roles}>{children}</RequireRole>
    </RequireAuth>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<SeaTarragonaV1 />} />
      <Route path="/sea" element={<SeaHub />} />
      <Route path="/qr/:tipo/:id" element={<QrScan />} />
      <Route path="/portal" element={<PortalLogin />} />
      <Route path="/portal/mi-ficha" element={<PortalFicha />} />
      <Route path="/operario/asistencias" element={<RoadsideOperatorPage />} />
      <Route path="/operario/taller" element={<WorkshopOperatorPage />} />
      <Route path="/seguimiento/:token" element={<RoadsideTrackingPage />} />
      <Route path="/track/:token" element={<RoadsideTrackingPage />} />
      <Route path="/informe/:token" element={<RoadsideReportPage />} />
      <Route path="/flota" element={<FlotaMapPage />} />
      <Route path="/otf" element={<OtfPage />} />
      <Route path="/otf-tv" element={<OtfTvPage />} />
      <Route path="/vehiculo" element={<VehiculoHistorialPage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/operativo2" element={<SeaTarragonaV1 initialView="operativo2" />} />
      <Route path="/login" element={<Login />} />
      <Route path="/almacen-neumaticos/login" element={<Login />} />

      <Route
        path="/almacen-neumaticos"
        element={
          <Protegida>
            <AlmacenDashboard />
          </Protegida>
        }
      />

      <Route
        path="/almacen-neumaticos/stock"
        element={
          <Protegida>
            <StockOperativo />
          </Protegida>
        }
      />

      <Route
        path="/almacen-neumaticos/entradas"
        element={
          <ProtegidaPorRol roles={["admin", "responsable"]}>
            <EntradasStock />
          </ProtegidaPorRol>
        }
      />

      <Route
        path="/almacen-neumaticos/salidas"
        element={
          <Protegida>
            <SalidasMontajes />
          </Protegida>
        }
      />

      <Route
        path="/almacen-neumaticos/historial"
        element={
          <Protegida>
            <HistorialMovimientos />
          </Protegida>
        }
      />

      <Route
        path="/almacen-neumaticos/traspasos"
        element={
          <Protegida>
            <Traspasos />
          </Protegida>
        }
      />

      <Route
        path="/almacen-neumaticos/reposiciones"
        element={
          <ProtegidaPorRol roles={["admin", "responsable"]}>
            <Reposiciones />
          </ProtegidaPorRol>
        }
      />

      <Route
        path="/almacen-neumaticos/inventarios"
        element={
          <Protegida>
            <Inventarios />
          </Protegida>
        }
      />

      <Route
        path="/almacen-neumaticos/incidencias"
        element={
          <Protegida>
            <Incidencias />
          </Protegida>
        }
      />

      <Route
        path="/almacen-neumaticos/productos"
        element={
          <ProtegidaPorRol roles={["admin"]}>
            <ProductosNeumaticos />
          </ProtegidaPorRol>
        }
      />

      <Route
        path="/almacen-neumaticos/clientes"
        element={
          <ProtegidaPorRol roles={["admin"]}>
            <ClientesAlmacen />
          </ProtegidaPorRol>
        }
      />

      <Route
        path="/almacen-neumaticos/vehiculos"
        element={
          <ProtegidaPorRol roles={["admin"]}>
            <VehiculosAlmacen />
          </ProtegidaPorRol>
        }
      />

      <Route
        path="/almacen-neumaticos/centros"
        element={
          <ProtegidaPorRol roles={["admin"]}>
            <CentrosAlmacen />
          </ProtegidaPorRol>
        }
      />

      <Route
        path="/almacen-neumaticos/usuarios"
        element={
          <ProtegidaPorRol roles={["admin"]}>
            <UsuariosAlmacen />
          </ProtegidaPorRol>
        }
      />

      <Route
        path="/almacen-neumaticos/auditoria"
        element={
          <ProtegidaPorRol roles={["admin"]}>
            <AuditoriaAlmacen />
          </ProtegidaPorRol>
        }
      />

      <Route
        path="/almacen-neumaticos/sistema"
        element={
          <ProtegidaPorRol roles={["admin"]}>
            <SistemaAlmacen />
          </ProtegidaPorRol>
        }
      />

      {/* SEA Safety Manager */}
      <Route path="/safety" element={<Protegida><SafetyDashboard /></Protegida>} />
      <Route path="/safety/epis" element={<Protegida><Epis /></Protegida>} />
      <Route path="/safety/entregas" element={<Protegida><Entregas /></Protegida>} />
      <Route path="/safety/stock" element={<Protegida><StockEpis /></Protegida>} />
      <Route path="/safety/documentos" element={<Protegida><Documentos /></Protegida>} />
      <Route path="/safety/reuniones" element={<Protegida><Reuniones /></Protegida>} />
      <Route path="/safety/formacion" element={<Protegida><Formacion /></Protegida>} />
      <Route path="/safety/inspecciones" element={<Protegida><Inspecciones /></Protegida>} />

      {/* SEA ToolControl */}
      <Route path="/toolcontrol" element={<Protegida><ToolControlDashboard /></Protegida>} />
      <Route path="/toolcontrol/herramientas" element={<Protegida><Herramientas /></Protegida>} />
      <Route path="/toolcontrol/maquinas" element={<Protegida><Maquinas /></Protegida>} />
      <Route path="/toolcontrol/movimientos" element={<Protegida><Movimientos /></Protegida>} />
      <Route path="/toolcontrol/mantenimiento" element={<Protegida><Mantenimiento /></Protegida>} />
      <Route path="/toolcontrol/inventario" element={<Protegida><InventarioTC /></Protegida>} />
      <Route path="/toolcontrol/incidencias" element={<Protegida><IncidenciasTC /></Protegida>} />
      <Route path="/toolcontrol/ubicaciones" element={<Protegida><Ubicaciones /></Protegida>} />
      <Route path="/toolcontrol/categorias" element={<Protegida><CategoriasTC /></Protegida>} />

      <Route path="/cobros" element={<CobrosDashboard />} />
      <Route path="/payment-success" element={<PaymentResult type="success" />} />
      <Route
        path="/payment-cancelled"
        element={<PaymentResult type="cancelled" />}
      />
      <Route path="/almacen-neumaticos/mobile" element={<MobileAlmacen />} />
      <Route
        path="/almacen-neumaticos/mobile/auditoria"
        element={<MobileAuditoria />}
      />
      <Route
        path="/almacen-neumaticos/mobile/traspaso/:id"
        element={<MobileTraspasoDetalle />}
      />
      {/* SEA Presencia */}
      <Route path="/presencia" element={<Protegida><PresenciaDashboard /></Protegida>} />
      <Route path="/presencia/fichajes" element={<Protegida><Fichajes /></Protegida>} />

      {/* SEA Core routes */}
      <Route path="/sea-core" element={<Protegida><CoreDashboard /></Protegida>} />
      <Route path="/sea-core/empleados" element={<Protegida><Empleados /></Protegida>} />
      <Route path="/sea-core/empleados/:id" element={<Protegida><EmpleadoDetalle /></Protegida>} />
      <Route path="/sea-core/empresas" element={<Protegida><Empresas /></Protegida>} />
      <Route path="/sea-core/centros" element={<Protegida><CentrosTrabajo /></Protegida>} />
      <Route path="/sea-core/competencias" element={<Protegida><CoreCompetencias /></Protegida>} />
      <Route path="/sea-core/autorizaciones" element={<Protegida><CoreAutorizaciones /></Protegida>} />

      {/* SEA TyreControl */}
      <Route path="/tyrecontrol/*" element={<TyreControlApp />} />

      {/* Login unificado por usuario y contraseña + hub de módulos */}
      <Route path="/acceso" element={<AccesoPage />} />
      <Route path="/inicio" element={<InicioPage />} />

      {/* SEA Administración (cobros, seguimiento de pagos y recobros) */}
      <Route path="/administracion/*" element={<AdministracionApp />} />

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
