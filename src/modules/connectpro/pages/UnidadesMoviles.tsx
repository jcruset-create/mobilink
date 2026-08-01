/**
 * Connect Pro — Unidades móviles (vista transversal): todas las unidades de
 * la red en vivo. La tabla vive en components/TablaUnidades y se reutiliza en
 * las fichas de empresa y de taller.
 */

import { PageTitle } from "../components/ui";
import TablaUnidades from "../components/TablaUnidades";

export default function UnidadesMoviles() {
  return (
    <div>
      <PageTitle
        title="Unidades móviles"
        subtitle="Estado en vivo derivado de las asistencias del taller y de Webfleet. El estado manual del operador tiene prioridad."
      />
      <TablaUnidades endpoint="/mobile-units" />
    </div>
  );
}
