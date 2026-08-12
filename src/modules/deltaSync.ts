/**
 * Envío incremental de colecciones al backend.
 *
 * Varias pantallas guardaban su lista completa en cada cambio. Con más de una
 * pestaña abierta eso significa que la última en guardar impone su copia:
 * los cambios hechos desde otra pestaña se revierten sin que nadie los borre.
 *
 * `elementosCambiados` compara la colección con la última versión que se dio
 * por guardada y devuelve sólo lo que ha cambiado, para subir eso y nada más.
 */

export type ConId = { id: string | number };

export type Delta<T> = {
  /** Altas y modificaciones desde la última sincronización. */
  cambiados: T[];
  /** Ids que estaban y ya no están (borrados locales). */
  eliminados: string[];
  /** Instantánea nueva, que el llamante guarda si el envío va bien. */
  instantanea: Map<string, string>;
};

function clave(item: ConId) {
  return String(item.id);
}

export function elementosCambiados<T extends ConId>(
  items: T[],
  anterior: Map<string, string>
): Delta<T> {
  const instantanea = new Map<string, string>();
  const cambiados: T[] = [];

  for (const item of items) {
    if (item == null || item.id == null) continue;

    const id = clave(item);
    const serializado = JSON.stringify(item);
    instantanea.set(id, serializado);

    if (anterior.get(id) !== serializado) {
      cambiados.push(item);
    }
  }

  const eliminados: string[] = [];
  for (const id of anterior.keys()) {
    if (!instantanea.has(id)) eliminados.push(id);
  }

  return { cambiados, eliminados, instantanea };
}

/** Instantánea inicial a partir de lo que viene del backend. */
export function instantaneaDe<T extends ConId>(items: T[]): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const item of items) {
    if (item == null || item.id == null) continue;
    mapa.set(clave(item), JSON.stringify(item));
  }
  return mapa;
}
