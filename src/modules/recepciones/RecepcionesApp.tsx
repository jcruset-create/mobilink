/**
 * Recepciones — punto de entrada del módulo en el panel.
 *
 * Misma forma que `ThereforeApp` y `CashApp`: proveedor de estado, layout y
 * rutas hijas bajo `/recepciones/*`. Si el usuario no tiene acceso al módulo,
 * se explica en lugar de dejar la pantalla en blanco.
 */

import { Navigate, Route, Routes } from "react-router-dom";
import { RecepcionesProvider, useRecepciones } from "./contexts/RecepcionesContext";
import RecepcionesLayout from "./layouts/RecepcionesLayout";
import Bandeja from "./pages/Bandeja";
import Pedidos from "./pages/Pedidos";
import Pedido from "./pages/Pedido";
import AlbaranDetalle from "./pages/AlbaranDetalle";
import Recepcion from "./pages/Recepcion";
import RecepcionDetalle from "./pages/RecepcionDetalle";
import Incidencias from "./pages/Incidencias";
import Operarios from "./pages/Operarios";
import Proveedores from "./pages/Proveedores";
import Correo from "./pages/Correo";
import Avisos from "./pages/Avisos";

function Contenido() {
  const { cargando, error, permisos } = useRecepciones();

  if (cargando) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-900 text-sm text-slate-400">Cargando Recepciones…</div>;
  }

  if (error || permisos.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 p-6">
        <div className="max-w-md rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6 text-sm text-amber-200">
          <p className="mb-1 font-bold">No se ha podido abrir Recepciones</p>
          <p>{error || "Tu usuario no tiene acceso al módulo. Pídeselo a un administrador."}</p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route element={<RecepcionesLayout />}>
        <Route index element={<Navigate to="/recepciones/bandeja" replace />} />
        <Route path="bandeja" element={<Bandeja />} />
        <Route path="pedidos" element={<Pedidos />} />
        <Route path="pedidos/:id" element={<Pedido />} />
        <Route path="albaranes/:id" element={<AlbaranDetalle />} />
        <Route path="recibir/:albaranId" element={<Recepcion />} />
        <Route path="recepciones/:id" element={<RecepcionDetalle />} />
        <Route path="incidencias" element={<Incidencias />} />
        <Route path="proveedores" element={<Proveedores />} />
        <Route path="operarios" element={<Operarios />} />
        <Route path="correo" element={<Correo />} />
        <Route path="avisos" element={<Avisos />} />
        <Route path="*" element={<Navigate to="/recepciones/bandeja" replace />} />
      </Route>
    </Routes>
  );
}

export default function RecepcionesApp() {
  return (
    <RecepcionesProvider>
      <Contenido />
    </RecepcionesProvider>
  );
}
