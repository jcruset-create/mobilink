/** Centro de Inteligencia Operacional — Flota y recursos. */

import CategoriaAnalitica from "./CategoriaAnalitica";

export default function Flota() {
  return (
    <CategoriaAnalitica
      category="fleet"
      reportKind="flota"
      title="Flota y recursos"
      description="Disponibilidad, utilización y actividad de las unidades móviles."
    />
  );
}
