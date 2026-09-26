/**
 * La configuración de ejes en el alta en lote de vehículos.
 *
 * El enlace entre un tipo de vehículo y su configuración de ejes NO es una
 * clave ajena: `tipos.configuracion_ejes` es texto libre y `config_ejes` son
 * filas con id. Se cruzan por nombre, y un cruce por nombre falla —un tipo que
 * nombra una configuración que nadie ha dado de alta, o dada de alta con otra
 * grafía—.
 *
 * Mientras la configuración se rellenaba a escondidas, ese fallo salía por el
 * peor sitio posible: el vehículo se creaba sin configuración y sin que nadie
 * se enterara, y aparecía semanas después como una ficha que no sabe desglosar
 * medidas por eje. Con el desplegable a la vista, lo que hace falta es que el
 * hueco se vea y se diga por qué.
 *
 * Todo puro: entran los catálogos y lo elegido, sale el id y el aviso.
 */

export interface TipoConConfig {
  id: string;
  nombre?: string;
  configuracion_ejes?: string | null;
}

export interface ConfigConNombre {
  id: string;
  nombre: string;
}

/** Compara nombres como los teclean las personas: sin mayúsculas ni bordes. */
function mismoNombre(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** La configuración que declara un tipo, o `null` si no se puede casar. */
export function configDelTipo(
  tipoId: string,
  tipos: TipoConConfig[],
  configs: ConfigConNombre[],
): ConfigConNombre | null {
  if (!tipoId) return null;
  const nombre = tipos.find((t) => t.id === tipoId)?.configuracion_ejes;
  if (!nombre || !nombre.trim()) return null;
  return configs.find((c) => c.nombre && mismoNombre(c.nombre, nombre)) ?? null;
}

/**
 * Qué decirle a quien mira el desplegable. `null` = no hay nada que añadir.
 *
 * Tres casos, y el primero es el que antes se tragaba en silencio.
 */
export function avisoDeConfig(
  elegido: { tipoVehiculoId: string; configEjesId: string },
  tipos: TipoConConfig[],
  configs: ConfigConNombre[],
): string | null {
  if (!elegido.tipoVehiculoId) return null;
  const tipo = tipos.find((t) => t.id === elegido.tipoVehiculoId);
  const delTipo = configDelTipo(elegido.tipoVehiculoId, tipos, configs);

  if (tipo?.configuracion_ejes?.trim() && !delTipo) {
    return (
      `El tipo dice «${tipo.configuracion_ejes.trim()}» y no hay ninguna configuración con ` +
      "ese nombre en el catálogo. Elígela a mano."
    );
  }
  if (!delTipo) return null;
  if (elegido.configEjesId === delTipo.id) return "La que dice el tipo elegido.";
  if (elegido.configEjesId) {
    return `Distinta de la del tipo, que es «${delTipo.nombre}». Se creará con la elegida.`;
  }
  return `Sin configuración. La del tipo es «${delTipo.nombre}».`;
}
