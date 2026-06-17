import type { ReactNode } from "react";
import { Routes, Route } from "react-router-dom";

import SeaTarragonaV1 from "./SeaTarragonaV1";
import RoadsideOperatorPage from "./pages/RoadsideOperatorPage";
import WorkshopOperatorPage from "./pages/WorkshopOperatorPage";
import RoadsideTrackingPage from "./pages/RoadsideTrackingPage";
import RoadsideReportPage from "./pages/RoadsideReportPage";

import CobrosDashboard from "./modules/cobros/pages/CobrosDashboard";
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
import MobileAlmacen from "./modules/almacen-neumaticos/pages/MobileAlmacen";
import MobileAuditoria from "./modules/almacen-neumaticos/pages/MobileAuditoria";
import MobileTraspasoDetalle from "./modules/almacen-neumaticos/pages/MobileTraspasoDetalle";

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
      <Route path="/operario/asistencias" element={<RoadsideOperatorPage />} />
      <Route path="/operario/taller" element={<WorkshopOperatorPage />} />
      <Route path="/seguimiento/:token" element={<RoadsideTrackingPage />} />
      <Route path="/track/:token" element={<RoadsideTrackingPage />} />
      <Route path="/informe/:token" element={<RoadsideReportPage />} />
      <Route path="/login" element={<Login />} />

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
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
