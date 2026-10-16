/**
 * Vincular cada técnico con su empleado de Core.
 *
 * El servidor propone (por nombre) y una persona confirma. Aquí solo se decide
 * qué se enseña preseleccionado y qué filas hay que guardar: nada se escribe
 * sin que alguien pulse «Guardar».
 */

export type Certeza = "exacta" | "unica" | "parecida" | "ambigua" | "sin_candidato";

export type PropuestaVinculo = {
  tech: string;
  employeeId: string | null;
  employeeNombre: string | null;
  certeza: Certeza;
  candidatos: { id: string; nombre: string }[];
  /** Empleado con el que YA está vinculado, o null. */
  vinculadoA: string | null;
};

/** Lo vinculado manda; si no hay vínculo, se sugiere lo que propone el servidor. */
export function eleccionInicial(p: PropuestaVinculo): string {
  return p.vinculadoA ?? p.employeeId ?? "";
}

/** Filas cuya elección difiere de lo guardado. "" significa desvincular. */
export function cambiosPendientes(
  propuestas: PropuestaVinculo[],
  eleccion: Record<string, string>
): { tech: string; employeeId: string | null }[] {
  const cambios: { tech: string; employeeId: string | null }[] = [];
  for (const p of propuestas) {
    const elegido = eleccion[p.tech] ?? eleccionInicial(p);
    const guardado = p.vinculadoA ?? "";
    if (elegido !== guardado) cambios.push({ tech: p.tech, employeeId: elegido || null });
  }
  return cambios;
}

/** Empleados elegidos para más de un técnico: el servidor lo rechazaría (409). */
export function empleadosRepetidos(
  propuestas: PropuestaVinculo[],
  eleccion: Record<string, string>
): Set<string> {
  const vistos = new Map<string, number>();
  for (const p of propuestas) {
    const id = eleccion[p.tech] ?? eleccionInicial(p);
    if (id) vistos.set(id, (vistos.get(id) ?? 0) + 1);
  }
  return new Set([...vistos].filter(([, n]) => n > 1).map(([id]) => id));
}

export function etiquetaDeCerteza(p: PropuestaVinculo): { texto: string; clase: string } {
  if (p.vinculadoA) return { texto: "Vinculado", clase: "bg-emerald-100 text-emerald-800" };
  switch (p.certeza) {
    case "exacta":
      return { texto: "Propuesta: nombre completo", clase: "bg-sky-100 text-sky-800" };
    case "unica":
      return { texto: "Propuesta: nombre de pila", clase: "bg-sky-100 text-sky-800" };
    case "parecida":
      return { texto: "Propuesta: nombre parecido, revísalo", clase: "bg-amber-100 text-amber-800" };
    case "ambigua":
      return { texto: "Varios posibles: elige", clase: "bg-amber-100 text-amber-800" };
    default:
      return { texto: "Sin candidato", clase: "bg-slate-100 text-slate-600" };
  }
}
