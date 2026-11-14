/**
 * De dónde se viene y a dónde se vuelve.
 *
 * La ficha de un vehículo se abre desde media docena de pantallas: el listado
 * general, el ranking de kilómetros, el control de tacógrafos, las
 * incidencias… Y su botón de volver llevaba siempre al listado general, que
 * desde una lista filtrada no es volver: es acabar en otro sitio y tener que
 * rehacer el filtro.
 *
 * La solución es que quien enlaza diga a dónde se vuelve. Eso viaja en el
 * `state` del enlace, que NO es la URL, así que se pierde al recargar la
 * página o al entrar por una dirección escrita a mano. Por eso siempre hay un
 * destino de reserva, y por eso el destino lleva sus filtros dentro de la
 * propia dirección: la lista a la que se vuelve tiene que ser la misma que se
 * dejó, no una parecida.
 */

/** Lo que una pantalla puede contar de sí misma al enlazar a otra. */
export interface DeDondeVengo {
  /** Ruta completa, con sus filtros. */
  volverA?: string;
  /** Lo que pone el botón. Sin esto, el enlace no se usa: un botón «← volver» sin nombre no dice a dónde. */
  volverEtiqueta?: string;
}

/**
 * Una ruta con sus filtros, saltándose los vacíos.
 *
 * Los vacíos se quitan en vez de dejar `?q=`: la dirección tiene que decir lo
 * que de verdad hay puesto, porque se guarda y se manda por correo.
 *
 * `toString()` y no `size`, que es de 2023 y no está en los Safari que
 * todavía andan por los talleres.
 */
export function rutaConFiltros(base: string, filtros: Record<string, string | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [clave, valor] of Object.entries(filtros)) {
    if (valor) p.set(clave, valor);
  }
  const cola = p.toString();
  return cola ? `${base}?${cola}` : base;
}

/**
 * A dónde lleva el botón de volver, y qué pone.
 *
 * Se exigen las DOS cosas para usar el origen. Con la ruta pero sin nombre el
 * botón diría «← Vehículos» y llevaría a otro sitio, que es peor que no tener
 * botón: el que lo pulsa cree saber dónde acaba.
 */
export function destinoVolver(
  origen: DeDondeVengo | null | undefined,
  reserva: { ruta: string; etiqueta: string },
): { ruta: string; etiqueta: string } {
  if (origen?.volverA && origen.volverEtiqueta) {
    return { ruta: origen.volverA, etiqueta: origen.volverEtiqueta };
  }
  return reserva;
}
