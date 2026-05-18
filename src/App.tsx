import { Routes, Route } from "react-router-dom";

import SeaTarragonaV1 from "./SeaTarragonaV1";
import AlmacenDashboard from "./modules/almacen-neumaticos/pages/AlmacenDashboard";
import StockOperativo from "./modules/almacen-neumaticos/pages/StockOperativo";
import CobrosDashboard from "./modules/cobros/pages/CobrosDashboard";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<SeaTarragonaV1 />} />

      <Route path="/almacen-neumaticos" element={<AlmacenDashboard />} />

      <Route path="/almacen-neumaticos/stock" element={<StockOperativo />} />

      <Route path="/cobros" element={<CobrosDashboard />} />
    </Routes>
  );
}