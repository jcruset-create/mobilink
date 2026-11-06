/**
 * Pedir una consulta por páginas.
 *
 * PostgREST corta cualquier respuesta en su tope de filas —mil, en esta
 * instalación— y no lo dice: el que pregunta recibe menos de lo que hay y
 * sigue adelante como si estuviera completo. Así se imprimió un informe de
 * 56 páginas diciendo «sin mediciones de neumático guardadas» cuando las
 * mediciones estaban todas: no faltaba el dato, faltaba la petición.
 *
 * Esta flota ya va por 751 vehículos. El día que pase de mil, un informe sin
 * paginar enseñaría menos vehículos de los que hay sin un solo error a la
 * vista, que es la peor forma de equivocarse.
 *
 * Quien use esto tiene que pedir con un ORDEN FIJO. Sin él, dos páginas
 * pueden repetir filas y saltarse otras, porque la base no promete el mismo
 * orden en dos consultas distintas.
 */

/** Filas por página. Por debajo de cualquier tope razonable de PostgREST. */
export const PAGINA = 500;

/**
 * Tope de vueltas POR DEFECTO. No es un límite de negocio: es el seguro para
 * que un error de paginación no se convierta en un bucle contra la base. 40
 * páginas son 20.000 filas, muy por encima de cualquier flota que tengamos.
 *
 * Hay lecturas que sí pasan de ahí sin que nada vaya mal: las mediciones de
 * un mes son seis por vehículo revisado, y un mes bueno de Plana son 23.000
 * filas. Para esas se pasa un tope mayor a `paginar`, a propósito y por
 * escrito, en vez de subir este número para todo el mundo.
 */
export const MAX_PAGINAS = 40;

type Respuesta = { data: unknown; error: { message: string } | null };

/** Pide páginas hasta que una venga incompleta. */
export async function paginar<T>(
  pedir: (desde: number, hasta: number) => PromiseLike<Respuesta>,
  maxPaginas: number = MAX_PAGINAS,
): Promise<T[]> {
  const out: T[] = [];
  for (let p = 0; p < maxPaginas; p += 1) {
    const desde = p * PAGINA;
    const { data, error } = await pedir(desde, desde + PAGINA - 1);
    if (error) throw new Error(error.message);
    const pagina = (data ?? []) as T[];
    out.push(...pagina);
    if (pagina.length < PAGINA) return out;
  }
  // Se queda corto en silencio solo si se supera el tope; si eso pasa, es
  // mejor saberlo por una excepción que por un informe a medias.
  throw new Error(`Demasiadas filas: se han leído ${maxPaginas * PAGINA} y aún hay más`);
}
