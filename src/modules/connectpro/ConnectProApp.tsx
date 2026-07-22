/**
 * Mobilink Assist Connect Pro — sub-aplicación del backoffice (/connect/*).
 * Estructura y lenguaje visual: patrón TyreControl (layout oscuro + sidebar).
 */

import { Navigate, Route, Routes } from "react-router-dom";
import { ConnectAuthProvider, ConnectAccessGate } from "./contexts/ConnectAuthContext";
import ConnectLayout from "./layouts/ConnectLayout";
import Dashboard from "./pages/Dashboard";
import Asistencias from "./pages/Asistencias";
import Empresas from "./pages/Empresas";
import Talleres from "./pages/Talleres";
import Integraciones from "./pages/Integraciones";
import Usuarios from "./pages/Usuarios";
import Auditoria from "./pages/Auditoria";
import Configuracion from "./pages/Configuracion";

export default function ConnectProApp() {
  return (
    <ConnectAuthProvider>
      <ConnectAccessGate>
        <Routes>
          <Route element={<ConnectLayout />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="asistencias" element={<Asistencias />} />
            <Route path="empresas" element={<Empresas />} />
            <Route path="talleres" element={<Talleres />} />
            <Route path="integraciones" element={<Integraciones />} />
            <Route path="usuarios" element={<Usuarios />} />
            <Route path="auditoria" element={<Auditoria />} />
            <Route path="configuracion" element={<Configuracion />} />
            <Route path="*" element={<Navigate to="dashboard" replace />} />
          </Route>
        </Routes>
      </ConnectAccessGate>
    </ConnectAuthProvider>
  );
}
