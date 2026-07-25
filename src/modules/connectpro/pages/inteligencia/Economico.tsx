/** Centro de Inteligencia Operacional — Análisis económico. */

import CategoriaAnalitica from "./CategoriaAnalitica";

export default function Economico() {
  return (
    <CategoriaAnalitica
      category="economic"
      reportKind="economico"
      title="Análisis económico"
      description="Facturación, coste medio por servicio, desviaciones frente a tarifa y pendientes de facturar."
    />
  );
}
