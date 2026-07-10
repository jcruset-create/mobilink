import { Routes, Route, Navigate } from "react-router-dom";
import { TyreAuthProvider } from "./contexts/TyreAuthContext";
import { ProtectedRoute, RoleRoute } from "./components/Guards";
import TyreLayout from "./layouts/TyreLayout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Usuarios from "./pages/Usuarios";
import Empresas from "./pages/Empresas";
import EmpresaDetalle from "./pages/EmpresaDetalle";
import Delegaciones from "./pages/Delegaciones";
import Vehiculos from "./pages/Vehiculos";
import VehiculoDetalle from "./pages/VehiculoDetalle";
import Neumaticos from "./pages/Neumaticos";
import NeumaticoDetalle from "./pages/NeumaticoDetalle";
import MontajesActuales from "./pages/MontajesActuales";
import Operaciones from "./pages/Operaciones";
import RevisionVehiculo from "./pages/RevisionVehiculo";
import Autorizaciones from "./pages/Autorizaciones";
import EnlaceAlmacen from "./pages/EnlaceAlmacen";
import MedidasNeumaticos from "./pages/MedidasNeumaticos";
import CatalogoNeumaticos from "./pages/CatalogoNeumaticos";
import SondaTLGX from "./pages/SondaTLGX";
import MiEmpresa from "./pages/MiEmpresa";
import MisDelegaciones from "./pages/MisDelegaciones";
import MisVehiculos from "./pages/MisVehiculos";
import MisNeumaticos from "./pages/MisNeumaticos";
import Perfil from "./pages/Perfil";
import Configuracion from "./pages/Configuracion";
import Importar from "./pages/Importar";
import InformesLayout from "./pages/informes/InformesLayout";
import InformeAlertas from "./pages/informes/InformeAlertas";
import InformeInventario from "./pages/informes/InformeInventario";
import InformeEstadoFlota from "./pages/informes/InformeEstadoFlota";
import InformeHistorialNeumatico from "./pages/informes/InformeHistorialNeumatico";
import InformeHistorialVehiculo from "./pages/informes/InformeHistorialVehiculo";
import InformeEconomico from "./pages/informes/InformeEconomico";
import InformeRankings from "./pages/informes/InformeRankings";
import InformeDesgaste from "./pages/informes/InformeDesgaste";
import InformePresiones from "./pages/informes/InformePresiones";
import InformeProductividad from "./pages/informes/InformeProductividad";

export default function TyreControlApp() {
  return (
    <TyreAuthProvider>
      <Routes>
        <Route path="login" element={<Login />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<TyreLayout />}>
            <Route index element={<Navigate to="/tyrecontrol/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="perfil" element={<Perfil />} />
            {/* Montajes/Operaciones: admin y cliente (la pantalla ajusta acciones por rol) */}
            <Route path="montajes" element={<MontajesActuales />} />
            <Route path="operaciones" element={<Operaciones />} />
            <Route path="revision-vehiculo" element={<RevisionVehiculo />} />

            {/* Informes: admin y cliente (RLS acota los datos por empresa) */}
            <Route path="informes" element={<InformesLayout />}>
              <Route index element={<Navigate to="/tyrecontrol/informes/alertas" replace />} />
              <Route path="alertas" element={<InformeAlertas />} />
              <Route path="estado-flota" element={<InformeEstadoFlota />} />
              <Route path="inventario" element={<InformeInventario />} />
              <Route path="historial-neumatico" element={<InformeHistorialNeumatico />} />
              <Route path="historial-vehiculo" element={<InformeHistorialVehiculo />} />
              <Route path="economico" element={<InformeEconomico />} />
              <Route path="rankings" element={<InformeRankings />} />
              <Route path="desgaste" element={<InformeDesgaste />} />
              <Route path="presiones" element={<InformePresiones />} />
              <Route path="productividad" element={<InformeProductividad />} />
            </Route>

            {/* Cliente */}
            <Route element={<RoleRoute roles={["cliente"]} />}>
              <Route path="mi-empresa" element={<MiEmpresa />} />
              <Route path="mis-delegaciones" element={<MisDelegaciones />} />
              <Route path="mis-vehiculos" element={<MisVehiculos />} />
              <Route path="mis-neumaticos" element={<MisNeumaticos />} />
            </Route>

            {/* Administrador / super-admin */}
            <Route element={<RoleRoute roles={["administrador"]} />}>
              <Route path="empresas" element={<Empresas />} />
              <Route path="empresas/:id" element={<EmpresaDetalle />} />
              <Route path="delegaciones" element={<Delegaciones />} />
              <Route path="usuarios" element={<Usuarios />} />
              <Route path="vehiculos" element={<Vehiculos />} />
              <Route path="vehiculos/:id" element={<VehiculoDetalle />} />
              <Route path="neumaticos" element={<Neumaticos />} />
              <Route path="neumaticos/:id" element={<NeumaticoDetalle />} />
              <Route path="autorizaciones" element={<Autorizaciones />} />
              <Route path="enlace-almacen" element={<EnlaceAlmacen />} />
              <Route path="medidas-neumaticos" element={<MedidasNeumaticos />} />
              <Route path="catalogo-neumaticos" element={<CatalogoNeumaticos />} />
              <Route path="sonda" element={<SondaTLGX />} />
              <Route path="configuracion" element={<Configuracion />} />
              <Route path="importar" element={<Importar />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/tyrecontrol/dashboard" replace />} />
      </Routes>
    </TyreAuthProvider>
  );
}
