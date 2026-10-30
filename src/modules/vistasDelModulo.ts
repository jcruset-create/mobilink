import type { AppView } from "./permissions";

/**
 * Qué vistas del panel puede abrir WorkPlanner, y qué hacer si no.
 *
 * ── El fallo que arregla ────────────────────────────────────────────────────
 *
 * El menú de WorkPlanner ofrece «Agenda», «Pantalla técnicos» y «Personal» a
 * todo el mundo, pero esas pantallas son del panel y el panel las protege con
 * su propio permiso. Cuando el permiso faltaba, la rama `if (view === … &&
 * canView(…))` no entraba y la ejecución seguía hasta la pantalla operativa
 * de abajo: salía media pantalla —el bloque de entradas rápidas y nada más—
 * sin un solo mensaje. Parecía la agenda rota.
 *
 * Aquí está en un sitio qué permiso pide cada una, para que la pantalla y el
 * menú no puedan discrepar.
 */

/** Las vistas que WorkPlanner incrusta, y el permiso que pide cada una. */
export const VISTAS_INCRUSTADAS: Record<string, AppView[]> = {
  // La agenda del módulo es «agenda2», pero quien tenga la clásica también
  // entra: es la misma pantalla.
  agenda2: ["agenda2", "agenda"],
  operarios: ["operarios"],
  tecnicos: ["tecnicos"],
};

/**
 * ¿Se puede abrir esta vista incrustada?
 *
 * `operativo2` no está en la lista a propósito: sin su permiso no se queda a
 * medias, cae a la pantalla operativa de siempre, que es una pantalla
 * completa. Quitársela ahora dejaría sin nada a quien hoy ve algo.
 */
export function puedeAbrirVistaIncrustada(
  vista: string,
  puede: (v: AppView) => boolean
): boolean {
  const exigidas = VISTAS_INCRUSTADAS[vista];
  if (!exigidas) return true;
  return exigidas.some((v) => puede(v));
}

/**
 * Las secciones del menú que hay que esconder.
 *
 * Sin lista de vistas —un administrador— no se esconde nada: es el mismo
 * criterio que usa `canView`, y dos reglas para lo mismo acaban discrepando.
 */
export function seccionVisible(
  vistaDeLaSeccion: string | null,
  vistasPermitidas: string[] | null
): boolean {
  if (!vistaDeLaSeccion) return true;
  if (!vistasPermitidas || vistasPermitidas.length === 0) return true;

  const exigidas = VISTAS_INCRUSTADAS[vistaDeLaSeccion] ?? [vistaDeLaSeccion];
  return exigidas.some((v) => vistasPermitidas.includes(v));
}

/**
 * ¿La sección está marcada en Core (Administración → Usuarios → WorkPlanner)?
 *
 * Es la segunda cerradura del menú, además de las vistas del panel: lo que se
 * desmarca allí desaparece de aquí. Sin lista (null o vacía) está todo marcado,
 * que es lo que Core guarda cuando se marcan todas las pantallas.
 */
export function seccionMarcadaEnCore(key: string, pantallas: string[] | null | undefined): boolean {
  if (!pantallas || pantallas.length === 0) return true;
  return pantallas.includes(key);
}
