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

export default function AdministracionApp() {
  return (
    <AdminAuthProvider>
      <Routes>
        <Route path="login" element={<Login />} />
        {/* Los usuarios se gestionan ahora desde «Empresas y licencias», dentro
            de cada empresa. La ruta vieja redirige: hay marcadores y hay
            costumbre, y un 404 no explica nada. Va FUERA de ProtectedRoute a
            propósito: quien la siga no tiene por qué tener sesión en
            Administración, y dentro se quedaba esperando un perfil que no iba
            a llegar. */}
        <Route path="usuarios" element={<Navigate to="/admin/empresas" replace />} />
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

          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/administracion/dashboard" replace />} />
      </Routes>
    </AdminAuthProvider>
  );
}
