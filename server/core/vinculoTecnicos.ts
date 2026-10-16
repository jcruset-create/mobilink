/**
 * Emparejar los técnicos del taller (`techs`, clavados por `name`) con las
 * personas de Core (`sea_employees`, con uuid).
 *
 * Paso 2 de la unificación de usuarios. El histórico del taller —partes,
 * pausas, cobros, asistencias— apunta por nombre en siete tablas y **no se
 * toca**: esto solo establece el vínculo para las lecturas nuevas y para dejar
 * de dar de alta a la misma persona dos veces.
 *
 * El emparejado se PROPONE, no se aplica solo: "José" puede ser José García o
 * José Martín, y meter la pata aquí significa atribuirle a alguien el trabajo
 * de otro. Por eso cada propuesta lleva su grado de certeza y las dudosas las
 * confirma una persona.
 */

/**
 * Normaliza un nombre para compararlo: sin tildes, sin signos, en minúsculas y
 * con los espacios colapsados.
 *
 * La ñ se convierte en n, igual que las tildes. Es deliberado: así "Muñoz" y
 * "Munoz" emparejan, que es justo lo que pasa cuando el mismo nombre se teclea
 * en dos sitios distintos.
 */
export function normalizarNombre(valor: unknown): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // marcas diacríticas (tildes, diéresis, ~ de la ñ)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type EmpleadoCore = {
  id: string;
  nombre: string | null;
  apellidos: string | null;
  codigo_operario?: string | null;
};

export type Certeza = "exacta" | "unica" | "parecida" | "ambigua" | "sin_candidato";

export type Propuesta = {
  /** Nombre del técnico en `techs` (su clave hoy). */
  tech: string;
  employeeId: string | null;
  /** Nombre completo del empleado propuesto, para enseñarlo al revisar. */
  employeeNombre: string | null;
  certeza: Certeza;
  /** Más de un empleado encaja: hay que elegir a mano. */
  candidatos: { id: string; nombre: string }[];
};

function nombreCompleto(e: EmpleadoCore): string {
  return [e.nombre, e.apellidos].filter(Boolean).join(" ").trim();
}

/**
 * Propone un empleado para cada técnico.
 *
 * Criterio, de más a menos fiable:
 *  1. `exacta`  — el nombre del técnico coincide con el nombre completo.
 *  2. `unica`   — coincide solo con el nombre de pila, y **un único** empleado
 *                 lo lleva. Es el caso normal en el taller, donde los técnicos
 *                 se apuntan por el nombre de pila.
 *  3. `ambigua` — varios empleados comparten ese nombre de pila. No se propone
 *                 ninguno: lo resuelve una persona.
 *  4. `sin_candidato` — nadie encaja.
 */
/** Distancia de edición, cortando en cuanto pasa de `max`. */
function distancia(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export function proponerVinculos(
  techs: string[],
  empleados: EmpleadoCore[]
): Propuesta[] {
  const porCompleto = new Map<string, EmpleadoCore[]>();
  const porPila = new Map<string, EmpleadoCore[]>();

  for (const e of empleados) {
    const completo = normalizarNombre(nombreCompleto(e));
    const pila = normalizarNombre(e.nombre);
    if (completo) {
      porCompleto.set(completo, [...(porCompleto.get(completo) ?? []), e]);
    }
    // El de pila es la primera palabra: en Core muchas fichas llevan el nombre
    // entero en `nombre` («Albert Belles Bertran») y los apellidos vacíos.
    // Se guarda también el campo entero, para los nombres compuestos.
    const primera = pila.split(" ")[0];
    for (const clave of new Set([pila, primera])) {
      if (clave) porPila.set(clave, [...(porPila.get(clave) ?? []), e]);
    }
  }

  const aCandidato = (e: EmpleadoCore) => ({ id: e.id, nombre: nombreCompleto(e) });

  return techs.map((tech) => {
    const clave = normalizarNombre(tech);
    const vacia: Propuesta = {
      tech,
      employeeId: null,
      employeeNombre: null,
      certeza: "sin_candidato",
      candidatos: [],
    };
    if (!clave) return vacia;

    const exactos = porCompleto.get(clave) ?? [];
    if (exactos.length === 1) {
      return {
        tech,
        employeeId: exactos[0].id,
        employeeNombre: nombreCompleto(exactos[0]),
        certeza: "exacta",
        candidatos: exactos.map(aCandidato),
      };
    }
    if (exactos.length > 1) {
      return { ...vacia, certeza: "ambigua", candidatos: exactos.map(aCandidato) };
    }

    const porNombre = porPila.get(clave) ?? [];
    if (porNombre.length === 1) {
      return {
        tech,
        employeeId: porNombre[0].id,
        employeeNombre: nombreCompleto(porNombre[0]),
        certeza: "unica",
        candidatos: porNombre.map(aCandidato),
      };
    }
    if (porNombre.length > 1) {
      return { ...vacia, certeza: "ambigua", candidatos: porNombre.map(aCandidato) };
    }

    // Una letra de diferencia en el nombre de pila («Anthoni» / «Anthony»).
    // Solo con nombres de 5 letras o más y un único parecido: con nombres
    // cortos una letra ya es otra persona («Iván» / «Ivet»). Lo confirma
    // alguien, como el resto.
    if (clave.length >= 5 && !clave.includes(" ")) {
      const parecidos = [...porPila.entries()]
        .filter(([k]) => !k.includes(" ") && k.length >= 5 && distancia(k, clave, 1) <= 1)
        .flatMap(([, lista]) => lista);
      const unicos = [...new Map(parecidos.map((e) => [e.id, e])).values()];
      if (unicos.length === 1) {
        return {
          tech,
          employeeId: unicos[0].id,
          employeeNombre: nombreCompleto(unicos[0]),
          certeza: "parecida",
          candidatos: unicos.map(aCandidato),
        };
      }
      if (unicos.length > 1) {
        return { ...vacia, certeza: "ambigua", candidatos: unicos.map(aCandidato) };
      }
    }

    return vacia;
  });
}
