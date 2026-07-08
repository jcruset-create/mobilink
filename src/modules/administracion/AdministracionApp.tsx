import { Routes, Route, Navigate } from "react-router-dom";
import { AdminAuthProvider } from "./contexts/AdminAuthContext";
import { ProtectedRoute, RoleRoute } from "./components/Guards";
import AdminLayout from "./layouts/AdminLayout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import CobrosDia from "./pages/CobrosDia";
import Seguimiento from "./pages/Seguimiento";
import Recobros from "./pages/Recobros";
import Clientes from "./pages/Clientes";
import ClienteFicha from "./pages/ClienteFicha";
import FormasPago from "./pages/FormasPago";
import Informes from "./pages/Informes";
import EstadoOts from "./pages/EstadoOts";
import UsuariosApp from "./pages/UsuariosApp";

export default function AdministracionApp() {
  return (
    <AdminAuthProvider>
      <Routes>
        <Route path="login" element={<Login />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AdminLayout />}>
            <Route index element={<Navigate to="/administracion/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />

            {/* Técnico: solo estado de OTs (sin importes) */}
            <Route path="estado-ots" element={<EstadoOts />} />

            {/* Recepción y superiores */}
            <Route element={<RoleRoute roles={["administracion", "recepcion", "supervisor"]} />}>
              <Route path="cobros-dia" element={<CobrosDia />} />
            </Route>

            {/* Administración y supervisor (lectura) */}
            <Route element={<RoleRoute roles={["administracion", "supervisor"]} />}>
              <Route path="seguimiento" element={<Seguimiento />} />
              <Route path="recobros" element={<Recobros />} />
              <Route path="clientes" element={<Clientes />} />
              <Route path="clientes/:id" element={<ClienteFicha />} />
              <Route path="informes" element={<Informes />} />
            </Route>

            {/* Solo administración/admin */}
            <Route element={<RoleRoute roles={["administracion"]} />}>
              <Route path="formas-pago" element={<FormasPago />} />
            </Route>

            {/* Solo admin: gestión de usuarios de toda la aplicación */}
            <Route element={<RoleRoute roles={[]} />}>
              <Route path="usuarios" element={<UsuariosApp />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/administracion/dashboard" replace />} />
      </Routes>
    </AdminAuthProvider>
  );
}
