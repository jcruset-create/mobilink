import { Routes, Route, Navigate } from "react-router-dom";
import { TyreAuthProvider } from "./contexts/TyreAuthContext";
import { ProtectedRoute, RoleRoute } from "./components/Guards";
import TyreLayout from "./layouts/TyreLayout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Usuarios from "./pages/Usuarios";
import Empresas from "./pages/Empresas";
import Perfil from "./pages/Perfil";
import Configuracion from "./pages/Configuracion";

export default function TyreControlApp() {
  return (
    <TyreAuthProvider>
      <Routes>
        <Route path="login" element={<Login />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<TyreLayout />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="perfil" element={<Perfil />} />
            <Route element={<RoleRoute roles={["administrador"]} />}>
              <Route path="usuarios" element={<Usuarios />} />
              <Route path="empresas" element={<Empresas />} />
              <Route path="configuracion" element={<Configuracion />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Routes>
    </TyreAuthProvider>
  );
}
