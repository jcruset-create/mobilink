/** Centro de Inteligencia Operacional — Calidad del servicio. */

import CategoriaAnalitica from "./CategoriaAnalitica";

export default function Calidad() {
  return (
    <CategoriaAnalitica
      category="quality"
      reportKind="calidad"
      title="Calidad del servicio"
      description="Incidencias, reclamaciones, documentación y tiempos de resolución."
    />
  );
}
