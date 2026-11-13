/**
 * La última medición de cada neumático de un vehículo.
 *
 * ── La profundidad solo cuenta si la revisión midió todas sus ruedas ───────
 *
 * El caso que lo destapó, el 4300GZD en su rueda E2_IZQ_INT:
 *
 *     30/10/2026   12,7 mm   revisión con las seis ruedas medidas
 *     05/11/2026    1,9 mm   revisión con UNA sola rueda medida
 *
 * En seis días no se gastan 11 mm. La lectura del 05/11 es del arco y ese día
 * llovía: el láser no lee la goma mojada. Quedándose con la última lectura de
 * cada neumático, la ficha daba por buena la mala.
 *
 * No es un caso suelto. Comparando cada lectura con la anterior de la misma
 * goma, desde septiembre: las de revisión completa se mueven −0,01 mm de media
 * y un 0,9 % cae más de 2 mm; las de revisión parcial, −0,50 mm de media y un
 * 9,3 % cae más de 2 mm. Diez veces más desplomes.
 *
 * Así que una revisión vale para la profundidad cuando TODAS sus filas traen
 * profundidad. Si le falta una, no se usa ninguna de las suyas y el vehículo se
 * queda con su última revisión completa.
 *
 * La PRESIÓN no se toca: el arco la mide bien con lluvia —el 03/11 sacó las
 * seis presiones de cada vehículo y ninguna profundidad—, así que la presión
 * sigue saliendo de la última revisión que la traiga, completa o no.
 *
 * La misma regla está en `tc_informes_alertas_vehiculos`
 * (tyrecontrol_profundidad_solo_de_revisiones_completas.sql), que es la que
 * contesta por toda la flota. Se repite porque la ficha no va a pedir el
 * informe de las 800 para pintar un camión, igual que pasa con el umbral por
 * llanta.
 */

export interface RevisionParaMedicion {
  id: string;
  created_at?: string | null;
  fecha_revision?: string | null;
}

export interface DetalleParaMedicion {
  revision_id: string;
  neumatico_id?: string | null;
  posicion_id?: string | null;
  profundidad_mm?: number | null;
  presion_bar?: number | null;
}

export interface Medicion {
  profundidad_mm: number | null;
  presion_bar: number | null;
  /** La fecha de la revisión de la que sale la PROFUNDIDAD. */
  medido_en: string | null;
}

/**
 * Las revisiones cuyas filas traen TODAS profundidad.
 *
 * Se miran todas las filas y no solo las que tienen `neumatico_id`. De las dos
 * formas de contarlo solo se diferencian 8 revisiones de 11.461, y ésta no tira
 * las 967 cuyo detalle se guardó sin `neumatico_id` y se atribuye por posición
 * más abajo.
 */
export function revisionesConTodasLasRuedas(detalles: DetalleParaMedicion[]): Set<string> {
  const filas = new Map<string, { total: number; conProfundidad: number }>();
  for (const d of detalles) {
    const cuenta = filas.get(d.revision_id) ?? { total: 0, conProfundidad: 0 };
    cuenta.total += 1;
    if (d.profundidad_mm != null) cuenta.conProfundidad += 1;
    filas.set(d.revision_id, cuenta);
  }
  const completas = new Set<string>();
  for (const [id, c] of filas) if (c.total > 0 && c.total === c.conProfundidad) completas.add(id);
  return completas;
}

/**
 * El mapa `neumatico_id → última medición`.
 *
 * `revisiones` tiene que venir ordenada de la MÁS RECIENTE a la más antigua:
 * es el orden en que se recorre para quedarse con la primera lectura de cada
 * neumático.
 *
 * `neumaticoPorPosicion` sirve para las filas guardadas sin `neumatico_id`
 * (p. ej. la posición aún no tenía montaje al crear la revisión): se atribuyen
 * al neumático que hoy está montado en esa posición, para no perder la
 * medición en el plano.
 */
export function mapaUltimasMediciones(
  revisiones: RevisionParaMedicion[],
  detalles: DetalleParaMedicion[],
  neumaticoPorPosicion: Map<string, string>,
): Record<string, Medicion> {
  const completas = revisionesConTodasLasRuedas(detalles);

  const orden = new Map(revisiones.map((r, i) => [r.id, i]));
  const fecha = new Map(revisiones.map((r) => [r.id, (r.created_at ?? r.fecha_revision ?? null) as string | null]));
  // Una fila de una revisión que no está en la lista no se puede ordenar: se
  // queda al final en vez de colarse la primera con un índice 0.
  const enOrden = [...detalles].sort(
    (a, b) => (orden.get(a.revision_id) ?? Number.MAX_SAFE_INTEGER) - (orden.get(b.revision_id) ?? Number.MAX_SAFE_INTEGER),
  );

  const mapa: Record<string, Medicion> = {};
  for (const d of enOrden) {
    const nid = d.neumatico_id ?? (d.posicion_id ? neumaticoPorPosicion.get(d.posicion_id) : null);
    if (!nid) continue;
    const actual = mapa[nid] ?? { profundidad_mm: null, presion_bar: null, medido_en: null };
    if (actual.profundidad_mm == null && d.profundidad_mm != null && completas.has(d.revision_id)) {
      actual.profundidad_mm = d.profundidad_mm;
      actual.medido_en = fecha.get(d.revision_id) ?? null;
    }
    if (actual.presion_bar == null && d.presion_bar != null) actual.presion_bar = d.presion_bar;
    mapa[nid] = actual;
  }
  return mapa;
}
