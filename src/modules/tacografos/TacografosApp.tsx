/**
 * Módulo Tacógrafos — punto de entrada en el panel.
 *
 * Misma forma que `CashApp`: proveedor de estado, layout y rutas hijas bajo
 * `/tacografos/*`. Si el usuario no tiene acceso al módulo, el backend contesta
 * 403 y aquí se explica en lugar de dejar la pantalla en blanco.
 */

import { Navigate, Route, Routes } from "react-router-dom";
import { TacografosProvider, useTacografos } from "./contexts/TacografosContext";
import TacografosLayout from "./layouts/TacografosLayout";
import Expedientes from "./pages/Expedientes";
import Expediente from "./pages/Expediente";
import ConfiguracionCentro from "./pages/ConfiguracionCentro";

function Contenido() {
  const { cargando, error, permisos } = useTacografos();

  if (cargando) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-sm text-slate-400">
        Cargando el módulo de Tacógrafos…
      </div>
    );
  }

  if (error || permisos.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 p-6">
        <div className="max-w-md rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6 text-sm text-amber-200">
          <p className="mb-1 font-bold">No se ha podido abrir el módulo de Tacógrafos</p>
          <p>
            {error ||
              "Tu usuario no tiene acceso al módulo. Pídeselo a un administrador."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route element={<TacografosLayout />}>
        <Route index element={<Navigate to="/tacografos/expedientes" replace />} />
        <Route path="expedientes" element={<Expedientes />} />
        <Route path="expedientes/nuevo" element={<Expediente nuevo />} />
        <Route path="expedientes/:id" element={<Expediente />} />
        <Route path="centro" element={<ConfiguracionCentro />} />
        <Route path="*" element={<Navigate to="/tacografos/expedientes" replace />} />
      </Route>
    </Routes>
  );
}

export default function TacografosApp() {
  return (
    <TacografosProvider>
      <Contenido />
    </TacografosProvider>
  );
}
