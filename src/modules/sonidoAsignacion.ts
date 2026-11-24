/**
 * Sonido en Pantalla técnicos cuando se asigna un trabajo nuevo.
 *
 * La parte pura: qué trabajos son nuevos respecto a la última vuelta. La
 * primera vuelta no suena (son los que ya estaban al encender la tele).
 * El sonido en sí lo pone el componente, porque el navegador solo deja
 * sonar tras un gesto de la persona.
 */

export type TrabajoAsignado = { id: number | string; plate?: string | null; assignedNames?: string[] | null };

export function nuevasAsignaciones(
  anteriores: ReadonlySet<string> | null,
  actuales: ReadonlyArray<TrabajoAsignado>
): { nuevos: TrabajoAsignado[]; vistos: Set<string> } {
  const vistos = new Set<string>();
  const nuevos: TrabajoAsignado[] = [];
  for (const t of actuales) {
    const clave = `${t.id}|${(t.assignedNames ?? []).join("+")}`;
    vistos.add(clave);
    if (anteriores && !anteriores.has(clave) && (t.assignedNames ?? []).length > 0) nuevos.push(t);
  }
  return { nuevos, vistos };
}

/** «Nuevo trabajo para José y Alejandro: 9328KBN.» */
export function fraseDeAviso(t: TrabajoAsignado): string {
  const nombres = (t.assignedNames ?? []).filter(Boolean);
  const quien = nombres.length === 0 ? "" : nombres.length === 1 ? nombres[0] : `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
  const matricula = String(t.plate ?? "").replace(/(\d)(?=[A-Z])/g, "$1 ").split("").join(" ").replace(/\s+/g, " ").trim();
  return quien ? `Nuevo trabajo para ${quien}: ${matricula}.` : `Nuevo trabajo: ${matricula}.`;
}
