/**
 * Therefore — punto de entrada del módulo en el panel.
 *
 * Misma forma que `CashApp` y `TacografosApp`: proveedor de estado, layout y
 * rutas hijas bajo `/therefore/*`. Si el usuario no tiene acceso al módulo, el
 * backend contesta 403 y aquí se explica en lugar de dejar la pantalla en
 * blanco, que es lo que hace pensar que la aplicación está rota.
 */

import { Navigate, Route, Routes } from "react-router-dom";
import { ThereforeProvider, useTherefore } from "./contexts/ThereforeContext";
import ThereforeLayout from "./layouts/ThereforeLayout";
import Bandeja from "./pages/Bandeja";
import Expediente from "./pages/Expediente";
import Revision from "./pages/Revision";
import Configuracion from "./pages/Configuracion";

function Contenido() {
  const { cargando, error, permisos } = useTherefore();

  if (cargando) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-sm text-slate-400">
        Cargando Therefore…
      </div>
    );
  }

  if (error || permisos.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 p-6">
        <div className="max-w-md rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6 text-sm text-amber-200">
          <p className="mb-1 font-bold">No se ha podido abrir Therefore</p>
          <p>{error || "Tu usuario no tiene acceso al módulo. Pídeselo a un administrador."}</p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route element={<ThereforeLayout />}>
        <Route index element={<Navigate to="/therefore/bandeja" replace />} />
        <Route path="bandeja" element={<Bandeja />} />
        <Route path="expedientes/:id" element={<Expediente />} />
        <Route path="revision" element={<Revision />} />
        <Route path="configuracion" element={<Configuracion />} />
        <Route path="*" element={<Navigate to="/therefore/bandeja" replace />} />
      </Route>
    </Routes>
  );
}

export default function ThereforeApp() {
  return (
    <ThereforeProvider>
      <Contenido />
    </ThereforeProvider>
  );
}
