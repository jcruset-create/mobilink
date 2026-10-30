/**
 * Responsable o apoyo: el papel de cada operario en un trabajo.
 *
 * La regla es la que ya usa la asignación en todo el panel: el PRIMERO de la
 * lista de asignados es el responsable y los demás, apoyo. Quien va solo es
 * responsable, también en una asistencia en carretera. Se pone al lado del
 * nombre («José - Responsable») y decide el rojo de su fila: subido para el
 * responsable, claro para el apoyo.
 */

export type Papel = "responsable" | "apoyo";

export function papelDelOperario(nombre: string, assignedNames: string[] | undefined | null): Papel | null {
  const i = (assignedNames ?? []).indexOf(nombre);
  if (i < 0) return null;
  return i === 0 ? "responsable" : "apoyo";
}

export function etiquetaDePapel(p: Papel | null): string {
  return p === "responsable" ? "Responsable" : p === "apoyo" ? "Apoyo" : "";
}

/** «José - Responsable»; sin papel, solo el nombre. */
export function nombreConPapel(nombre: string, p: Papel | null): string {
  const e = etiquetaDePapel(p);
  return e ? `${nombre} - ${e}` : nombre;
}
