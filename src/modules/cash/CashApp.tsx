/**
 * Mobilink Cash — punto de entrada del módulo en el panel.
 *
 * Misma forma que `AdministracionApp`: proveedor de estado, layout y rutas
 * hijas bajo `/cash/*`. La autenticación es la de siempre (sesión unificada de
 * Supabase); si el usuario no tiene acceso al módulo, el backend contesta 403 y
 * aquí se explica en lugar de dejar la pantalla en blanco.
 */

import { Routes, Route, Navigate } from "react-router-dom";
import { CashProvider, useCash } from "./contexts/CashContext";
import CashLayout from "./layouts/CashLayout";
import JornadaActual from "./pages/JornadaActual";
import Cobros from "./pages/Cobros";
import Pagos from "./pages/Pagos";
import Movimientos from "./pages/Movimientos";
import StockCaja from "./pages/StockCaja";
import Arqueo from "./pages/Arqueo";
import Cierre from "./pages/Cierre";
import Historico from "./pages/Historico";
import IntegracionErp from "./pages/IntegracionErp";

function Contenido() {
  const { cargando, error, permisos } = useCash();

  if (cargando) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-sm text-slate-400">
        Cargando Mobilink Cash…
      </div>
    );
  }

  // Sin permiso de lectura no hay nada que enseñar. Se dice claramente en vez
  // de redirigir en silencio, que deja al usuario sin saber qué ha pasado.
  if (error || permisos.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 p-6">
        <div className="max-w-md rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6 text-sm text-amber-200">
          <p className="mb-1 font-bold">No se ha podido abrir Mobilink Cash</p>
          <p>
            {error ||
              "Tu usuario no tiene acceso al módulo de caja. Pídeselo a un administrador."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route element={<CashLayout />}>
        <Route index element={<Navigate to="/cash/jornada" replace />} />
        <Route path="jornada" element={<JornadaActual />} />
        <Route path="cobros" element={<Cobros />} />
        <Route path="pagos" element={<Pagos />} />
        <Route path="movimientos" element={<Movimientos />} />
        <Route path="stock" element={<StockCaja />} />
        <Route path="arqueo" element={<Arqueo />} />
        <Route path="cierre" element={<Cierre />} />
        <Route path="historico" element={<Historico />} />
        <Route path="erp" element={<IntegracionErp />} />
      </Route>
      <Route path="*" element={<Navigate to="/cash/jornada" replace />} />
    </Routes>
  );
}

export default function CashApp() {
  return (
    <CashProvider>
      <Contenido />
    </CashProvider>
  );
}
