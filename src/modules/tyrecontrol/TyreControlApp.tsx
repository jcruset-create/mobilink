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
import MiEmpresa from "./pages/MiEmpresa";
import MisDelegaciones from "./pages/MisDelegaciones";
import Perfil from "./pages/Perfil";
import Configuracion from "./pages/Configuracion";

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

            {/* Cliente */}
            <Route element={<RoleRoute roles={["cliente"]} />}>
              <Route path="mi-empresa" element={<MiEmpresa />} />
              <Route path="mis-delegaciones" element={<MisDelegaciones />} />
            </Route>

            {/* Administrador / super-admin */}
            <Route element={<RoleRoute roles={["administrador"]} />}>
              <Route path="empresas" element={<Empresas />} />
              <Route path="empresas/:id" element={<EmpresaDetalle />} />
              <Route path="delegaciones" element={<Delegaciones />} />
              <Route path="usuarios" element={<Usuarios />} />
              <Route path="configuracion" element={<Configuracion />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/tyrecontrol/dashboard" replace />} />
      </Routes>
    </TyreAuthProvider>
  );
}
