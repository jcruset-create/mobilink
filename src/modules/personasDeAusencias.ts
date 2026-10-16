import { esTecnicoDePrueba } from "./tecnicosDePrueba";
import {
  TODOS_LOS_TALLERES,
  tecnicosDelTaller,
  type TecnicoConTaller,
} from "./tecnicosPorTaller";
import { getWorkshopById, normalizeWorkshopId, type WorkshopId } from "./workshops";

/**
 * Quién sale en Ausencias y en Planning: TODOS los empleados, no solo técnicos.
 *
 * Los técnicos salen como siempre, por su nombre de técnico, que es la clave
 * con la que están guardadas sus ausencias. Los empleados de Core que no son
 * técnicos (oficina, almacén…) se añaden por su nombre completo.
 *
 * Un empleado vinculado a un técnico NO sale dos veces: ya está como técnico.
 * Tampoco el que se llama exactamente igual que un técnico, aunque nadie los
 * haya vinculado todavía.
 *
 * Su taller sale del centro de trabajo de Core: si el nombre del centro dice
 * Reus o Tarragona, de ese; si no dice ninguno, sale en los dos.
 */

export type EmpleadoCore = {
  id: string;
  nombre: string;
  centro?: string | null;
  /** Técnico vinculado, si lo hay. */
  techName?: string | null;
  /** Técnico que casa por nombre aunque nadie lo haya vinculado todavía. */
  techPropuesto?: string | null;
};

type FichaDeTecnico = {
  name?: string | null;
  activo?: boolean;
  workshopId?: unknown;
  employeeId?: string | null;
};

export type PersonaConTaller = TecnicoConTaller & {
  esTecnico: boolean;
  /** Dado de baja en la empresa (ficha desactivada). Solo sale si se pide. */
  deBaja?: boolean;
};

export function normalizarNombre(valor: unknown): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function tallerDeCentro(centro: unknown): WorkshopId | null {
  const c = normalizarNombre(centro);
  if (c.includes("reus")) return "sea-reus";
  if (c.includes("tarragona")) return "sea-tarragona";
  return null;
}

/** Empleados de Core que no están ya en la lista como técnicos. */
export function empleadosSinFicha(
  fichas: FichaDeTecnico[],
  empleados: EmpleadoCore[]
): { nombre: string; workshopId: WorkshopId | null }[] {
  const conFicha = fichas.filter((t) => t?.name);
  const idsVinculados = new Set(conFicha.map((t) => t.employeeId).filter(Boolean) as string[]);
  const nombresDeTecnico = new Set(conFicha.map((t) => normalizarNombre(t.name)));
  const vistos = new Set<string>();

  const salida: { nombre: string; workshopId: WorkshopId | null }[] = [];
  for (const e of empleados) {
    const nombre = String(e?.nombre ?? "").trim();
    if (!nombre || esTecnicoDePrueba(nombre)) continue;
    if (e.techName || e.techPropuesto || idsVinculados.has(e.id)) continue;
    const clave = normalizarNombre(nombre);
    if (nombresDeTecnico.has(clave) || vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push({ nombre, workshopId: tallerDeCentro(e.centro) });
  }
  return salida;
}

/**
 * Técnicos del taller y, detrás, el resto de empleados de Core.
 *
 * Por defecto solo los de alta. Con `incluirBajas`, al final se añaden los
 * técnicos dados de baja de ese taller, marcados.
 */
export function personasDelTaller(
  fichas: FichaDeTecnico[],
  empleados: EmpleadoCore[],
  tallerId: string,
  { incluirBajas = false }: { incluirBajas?: boolean } = {}
): PersonaConTaller[] {
  const tecnicos = tecnicosDelTaller(fichas, tallerId).map((t) => ({ ...t, esTecnico: true }));
  const resto = empleadosSinFicha(fichas, empleados)
    .filter(
      (e) =>
        tallerId === TODOS_LOS_TALLERES ||
        e.workshopId === null ||
        e.workshopId === normalizeWorkshopId(tallerId)
    )
    .map((e) => ({
      nombre: e.nombre,
      taller: e.workshopId ? getWorkshopById(e.workshopId).shortName : "—",
      esTecnico: false,
    }));
  if (!incluirBajas) return [...tecnicos, ...resto];

  const deBaja = fichas
    .filter((t) => t?.name && t.activo === false && !esTecnicoDePrueba(t.name))
    .filter(
      (t) =>
        tallerId === TODOS_LOS_TALLERES ||
        normalizeWorkshopId(t.workshopId) === normalizeWorkshopId(tallerId)
    )
    .map((t) => ({
      nombre: String(t.name),
      taller: getWorkshopById(normalizeWorkshopId(t.workshopId)).shortName,
      esTecnico: true,
      deBaja: true,
    }));
  return [...tecnicos, ...resto, ...deBaja];
}
