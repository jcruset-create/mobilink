/**
 * Recorrer un listado paginado hasta agotarlo o llegar a un tope.
 *
 * Vive fuera de data.ts a propósito: aquí no se importa el cliente de Supabase,
 * así que se puede probar sin credenciales ni red. Los tres casos que importan
 * —cabe entero, lo corta el tope, la última página viene a medias— son de
 * aritmética, y son justo donde es fácil equivocarse en uno.
 */
export async function recorrerPaginas<T>(
  traer: (pagina: number, tamano: number) => Promise<{ filas: T[]; total: number }>,
  maximo: number,
  bloque = 1000,
): Promise<{ filas: T[]; total: number; truncado: boolean }> {
  const filas: T[] = [];
  let total = 0;
  for (let pagina = 0; filas.length < maximo; pagina++) {
    const cabe = Math.min(bloque, maximo - filas.length);
    const r = await traer(pagina, cabe);
    if (pagina === 0) total = r.total;
    filas.push(...r.filas);
    // Página incompleta = no hay más, aunque el total dijera otra cosa.
    if (r.filas.length < cabe || filas.length >= total) break;
  }
  return { filas, total, truncado: filas.length < total };
}
