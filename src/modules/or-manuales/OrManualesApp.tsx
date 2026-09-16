/**
 * OR Manuales — punto de entrada del módulo en el panel.
 *
 * Misma forma que `RecepcionesApp` y `ThereforeApp`: proveedor de estado,
 * layout y rutas hijas bajo `/or-manuales/*`. Si el usuario no tiene acceso al
 * módulo, se explica en lugar de dejar la pantalla en blanco.
 */

import { Navigate, Route, Routes } from "react-router-dom";
import { OrManualesProvider, useOrManuales } from "./contexts/OrManualesContext";
import OrManualesLayout from "./layouts/OrManualesLayout";
import Panel from "./pages/Panel";
import Blocs from "./pages/Blocs";
import NuevoBloc from "./pages/NuevoBloc";
import Bloc from "./pages/Bloc";
import Escanear from "./pages/Escanear";
import Pendientes from "./pages/Pendientes";
import Avisos from "./pages/Avisos";
import Historico from "./pages/Historico";
import Configuracion from "./pages/Configuracion";

function Contenido() {
  const { cargando, error, permisos } = useOrManuales();

  if (cargando) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-sm text-slate-400">
        Cargando OR Manuales…
      </div>
    );
  }

  if (error || permisos.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 p-6">
        <div className="max-w-md rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6 text-sm text-amber-200">
          <p className="mb-1 font-bold">No se ha podido abrir OR Manuales</p>
          <p>{error || "Tu usuario no tiene acceso al módulo. Pídeselo a un administrador."}</p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route element={<OrManualesLayout />}>
        <Route index element={<Navigate to="/or-manuales/panel" replace />} />
        <Route path="panel" element={<Panel />} />
        <Route path="blocs" element={<Blocs />} />
        <Route path="blocs/nuevo" element={<NuevoBloc />} />
        <Route path="blocs/:id" element={<Bloc />} />
        <Route path="escanear" element={<Escanear />} />
        <Route path="pendientes" element={<Pendientes />} />
        <Route path="avisos" element={<Avisos />} />
        <Route path="historico" element={<Historico />} />
        <Route path="configuracion" element={<Configuracion />} />
        <Route path="*" element={<Navigate to="/or-manuales/panel" replace />} />
      </Route>
    </Routes>
  );
}

export default function OrManualesApp() {
  return (
    <OrManualesProvider>
      <Contenido />
    </OrManualesProvider>
  );
}
