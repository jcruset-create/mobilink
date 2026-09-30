/**
 * Quién ve las tarjetas propias del hub (Asistencias y Panel de taller).
 *
 * Tienen tarjeta aparte porque llevan botones y rutas que no siguen el patrón
 * de los demás módulos, pero el derecho a verlas se gana igual que el resto:
 * acceso del usuario cruzado con licencia vigente de su empresa, que es lo que
 * ya devuelve `app_mis_modulos()`.
 *
 * Antes eran dos constantes a `true` en la propia página, así que se las veía
 * TODO el mundo: un cliente entraba en su hub y ahí estaban, sin haberlas
 * contratado y sin que nadie se las hubiera dado.
 */
export const CON_TARJETA_PROPIA = ["assist", "taller"] as const;

export function tarjetasPropiasVisibles(
  modulosDelUsuario: Iterable<string>,
  esSuperadmin: boolean
): Set<string> {
  const tiene = new Set(modulosDelUsuario);
  // El superadmin de Mobilink las ve siempre: es quien da soporte y quien
  // vende la licencia, y si no las viera no podría comprobar nada.
  return new Set(CON_TARJETA_PROPIA.filter((k) => esSuperadmin || tiene.has(k)));
}
