import { Routes, Route, Navigate } from "react-router-dom";
import { TyreAuthProvider } from "./contexts/TyreAuthContext";
import { ProtectedRoute, RoleRoute, InicioSegunRol } from "./components/Guards";
import TyreLayout from "./layouts/TyreLayout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Usuarios from "./pages/Usuarios";
import Empresas from "./pages/Empresas";
import EmpresaDetalle from "./pages/EmpresaDetalle";
import Delegaciones from "./pages/Delegaciones";
import Vehiculos from "./pages/Vehiculos";
import VehiculoDetalle from "./pages/VehiculoDetalle";
import DisponiblesRevisar from "./pages/DisponiblesRevisar";
import PlanificacionRevisiones from "./pages/PlanificacionRevisiones";
import Incidencias from "./pages/Incidencias";
import HistoricoRevisiones from "./pages/HistoricoRevisiones";
import PlantillasMantenimiento from "./pages/PlantillasMantenimiento";
import LotesRevision from "./pages/LotesRevision";
import Neumaticos from "./pages/Neumaticos";
import AlmacenUsados from "./pages/AlmacenUsados";
import NeumaticoDetalle from "./pages/NeumaticoDetalle";
import MontajesActuales from "./pages/MontajesActuales";
import Operaciones from "./pages/Operaciones";
import Intervenciones from "./pages/Intervenciones";
import InformeIntervencion from "./pages/InformeIntervencion";
import Ayuda from "./pages/Ayuda";
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
import TiposIncidencia from "./pages/TiposIncidencia";
import Importar from "./pages/Importar";
import InformesLayout from "./pages/informes/InformesLayout";
import InformeEjecutivo from "./pages/informes/InformeEjecutivo";
import InformeAlertas from "./pages/informes/InformeAlertas";
import InformeInventario from "./pages/informes/InformeInventario";
import InformeEstadoFlota from "./pages/informes/InformeEstadoFlota";
import InformeControlRevisiones from "./pages/informes/InformeControlRevisiones";
import InformeHistorialNeumatico from "./pages/informes/InformeHistorialNeumatico";
import InformeHistorialVehiculo from "./pages/informes/InformeHistorialVehiculo";
import InformeEconomico from "./pages/informes/InformeEconomico";
import InformeRankings from "./pages/informes/InformeRankings";
import InformeDesgaste from "./pages/informes/InformeDesgaste";
import InformePresiones from "./pages/informes/InformePresiones";
import InformeProductividad from "./pages/informes/InformeProductividad";
import InformeOperaciones from "./pages/informes/InformeOperaciones";

export default function TyreControlApp() {
  return (
    <TyreAuthProvider>
      <Routes>
        <Route path="login" element={<Login />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<TyreLayout />}>
            <Route index element={<InicioSegunRol />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="perfil" element={<Perfil />} />
            <Route path="ayuda" element={<Ayuda />} />
            {/* Montajes/Operaciones: admin y cliente (la pantalla ajusta acciones por rol) */}
            {/* La ficha del vehículo la comparten admin y cliente: la propia
                pantalla desactiva toda edición con `esCliente` y la RLS impide
                leer un vehículo de otra empresa aunque se teclee el id a mano.
                Se listan los dos roles a propósito: dejarla abierta a todos
                daría al OPERADOR permiso de edición sobre ficha técnica, ITV y
                plan de mantenimiento, que hoy no tiene desde el panel. */}
            <Route element={<RoleRoute roles={["administrador", "cliente"]} />}>
              <Route path="vehiculos/:id" element={<VehiculoDetalle />} />
            </Route>
            <Route path="montajes" element={<MontajesActuales />} />
            <Route path="operaciones" element={<Operaciones />} />
            <Route path="intervenciones" element={<Intervenciones />} />
            <Route path="intervenciones/:id" element={<InformeIntervencion />} />
            <Route path="revision-vehiculo" element={<RevisionVehiculo />} />

            {/* Informes: admin y cliente (RLS acota los datos por empresa) */}
            <Route path="informes" element={<InformesLayout />}>
              <Route index element={<Navigate to="/tyrecontrol/informes/ejecutivo" replace />} />
              <Route path="ejecutivo" element={<InformeEjecutivo />} />
              <Route path="alertas" element={<InformeAlertas />} />
              <Route path="estado-flota" element={<InformeEstadoFlota />} />
              <Route path="control-revisiones" element={<InformeControlRevisiones />} />
              <Route path="inventario" element={<InformeInventario />} />
              <Route path="historial-vehiculo" element={<InformeHistorialVehiculo />} />
              <Route path="desgaste" element={<InformeDesgaste />} />
              <Route path="presiones" element={<InformePresiones />} />
              {/* Informes INTERNOS: costes, productividad de técnicos y códigos
                  internos. Un cliente no los ve en pestañas (InformesLayout) y
                  tampoco por URL directa — este RoleRoute es la barrera real.
                  Misma lista que TABS con `interna: true`: mantener en espejo. */}
              <Route element={<RoleRoute roles={["administrador"]} />}>
                <Route path="economico" element={<InformeEconomico />} />
                <Route path="rankings" element={<InformeRankings />} />
                <Route path="productividad" element={<InformeProductividad />} />
                <Route path="operaciones-informe" element={<InformeOperaciones />} />
                <Route path="historial-neumatico" element={<InformeHistorialNeumatico />} />
              </Route>
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
              <Route path="disponibles-revisar" element={<DisponiblesRevisar />} />
              <Route path="planificacion" element={<PlanificacionRevisiones />} />
              <Route path="incidencias" element={<Incidencias />} />
              <Route path="tipos-incidencia" element={<TiposIncidencia />} />
              <Route path="historico-revisiones" element={<HistoricoRevisiones />} />
              <Route path="plantillas-mantenimiento" element={<PlantillasMantenimiento />} />
              <Route path="lotes-revision" element={<LotesRevision />} />
              <Route path="neumaticos" element={<Neumaticos />} />
              <Route path="neumaticos/:id" element={<NeumaticoDetalle />} />
              <Route path="almacen-usados" element={<AlmacenUsados />} />
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
