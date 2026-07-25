/** Centro de Inteligencia Operacional — Rendimiento de proveedores. */

import CategoriaAnalitica from "./CategoriaAnalitica";

export default function Proveedores() {
  return (
    <CategoriaAnalitica
      category="provider"
      reportKind="proveedores"
      title="Rendimiento de proveedores"
      description="Volumen, aceptación, tiempos, cumplimiento de SLA y score inteligente por taller."
    />
  );
}
