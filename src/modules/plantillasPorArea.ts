import type { QuickTemplate } from "./workshopTypes";

/**
 * Las plantillas que caben en un área.
 *
 * En recepción, el desplegable de operación sacaba las del taller entero:
 * con el área en «tacógrafo» salían «Pinchazo camión» o «Cambiar 2
 * neumáticos de turismo». Treinta opciones para elegir entre cinco. Sin área
 * elegida se devuelven todas, que es lo único que se puede hacer.
 *
 * La que ya esté elegida se conserva aunque no sea del área: un desplegable
 * que no muestra su propio valor enseña «— elegir —» con algo guardado detrás.
 */
export function plantillasParaArea<T extends Pick<QuickTemplate, "key" | "area">>(
  plantillas: T[],
  area: string | null | undefined,
  elegidaKey?: string | null
): T[] {
  if (!area) return plantillas;
  return plantillas.filter((p) => p.area === area || (elegidaKey && p.key === elegidaKey));
}
