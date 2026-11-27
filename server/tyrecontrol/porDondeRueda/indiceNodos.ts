/**
 * El índice de nodos de la carga de una región: ids ordenados en un
 * Float64Array y búsqueda binaria. Puro y aparte de cargaRegion.ts para poder
 * probarlo sin la base (importar supabase.ts exige sus variables de entorno).
 */

/** Búsqueda binaria en un Float64Array ordenado; -1 si no está. */
export function buscar(ordenados: Float64Array, id: number): number {
  let a = 0, b = ordenados.length - 1;
  while (a <= b) {
    const m = (a + b) >> 1;
    const v = ordenados[m];
    if (v === id) return m;
    if (v < id) a = m + 1; else b = m - 1;
  }
  return -1;
}

/** Ordena y quita repetidos. */
export function unicos(ids: number[]): Float64Array {
  const f = Float64Array.from(ids).sort();
  let n = 0;
  for (let i = 0; i < f.length; i++) if (i === 0 || f[i] !== f[i - 1]) f[n++] = f[i];
  return f.slice(0, n);
}
