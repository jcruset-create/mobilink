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
 * ── Las lecturas siguen a la posición ──────────────────────────────────────
 *
 * A un neumático montado le valen las lecturas guardadas a su nombre Y las de
 * su posición con fecha POSTERIOR a su fecha de montaje, estén a nombre de
 * otro neumático o de ninguno.
 *
 * El caso: el 4310JYJ salía con el eje 1 sin profundidades y el arco las mide
 * a diario. Sus gomas se dieron de alta el 10/11 con su fecha de montaje real,
 * 05/08, y todas las lecturas desde agosto estaban a nombre de las anteriores.
 * Había 358 gomas así.
 *
 * POSTERIOR y no «desde»: la lectura del mismo día del montaje suele ser la de
 * la goma VIEJA, medida justo antes de cambiarla. Heredarla le pondría un
 * «cambiar ya» a un neumático recién estrenado (pasaba en el 9232HMK).
 *
 * Antes las filas sin `neumatico_id` se atribuían por posición SIN mirar la
 * fecha. Ahora pasan por la misma regla: una lectura anterior al montaje no es
 * de esta goma, tenga nombre o no. Son 16 gomas que dejan de enseñar un número
 * que era de la anterior.
 *
 * La misma regla está en `tc_informes_alertas_vehiculos`
 * (tyrecontrol_lecturas_siguen_a_la_posicion.sql), que es la que
 * contesta por toda la flota. Se repite porque la ficha no va a pedir el
 * informe de las 800 para pintar un camión, igual que pasa con el umbral por
 * llanta.
 */

import { valorDeLaGoma, type LecturaDeSerie } from "./protocoloProfundidad";

export interface RevisionParaMedicion {
  id: string;
  created_at?: string | null;
  fecha_revision?: string | null;
  /** Con técnico, la revisión es A MANO; las del arco no lo tienen. */
  tecnico_id?: string | null;
}

export interface DetalleParaMedicion {
  revision_id: string;
  neumatico_id?: string | null;
  posicion_id?: string | null;
  profundidad_mm?: number | null;
  presion_bar?: number | null;
}

/** Quién está montado en una posición, y desde cuándo. */
export interface MontajeEnPosicion {
  neumatico_id: string;
  /** Fecha ISO. En la base no es nula; si faltase, no se puede acotar. */
  fecha_montaje: string | null;
}

/**
 * Si una lectura de la posición es de la goma que hoy está montada en ella:
 * solo las de días POSTERIORES al del montaje.
 *
 * Sin fecha de montaje no hay con qué acotar y se hereda, que es lo que se
 * hacía siempre; sin fecha de la lectura no se puede saber, y no se hereda.
 */
export function esPosteriorAlMontaje(fechaLectura: string | null | undefined, fechaMontaje: string | null | undefined): boolean {
  if (!fechaMontaje) return true;
  if (!fechaLectura) return false;
  return fechaLectura.slice(0, 10) > fechaMontaje.slice(0, 10);
}

export interface Medicion {
  /** La profundidad que se da por buena: la del protocolo, no la última. */
  profundidad_mm: number | null;
  presion_bar: number | null;
  /** La fecha de la revisión de la que sale la PROFUNDIDAD. */
  medido_en: string | null;
  /** Si otra lectura, o un técnico, respalda esa profundidad. */
  confirmada: boolean;
  /** La última lectura, cuando NO es la que se ha dado por buena. */
  pendiente_mm: number | null;
  pendiente_en: string | null;
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
 * `montajePorPosicion` dice qué goma hay hoy en cada posición y desde cuándo:
 * con eso una fila de la posición se le apunta también a ella si es posterior
 * a su montaje.
 */
export function mapaUltimasMediciones(
  revisiones: RevisionParaMedicion[],
  detalles: DetalleParaMedicion[],
  montajePorPosicion: Map<string, MontajeEnPosicion>,
  /**
   * El mínimo de cada goma (por su llanta). El protocolo solo entra cuando la
   * última lectura lo toca; sin mínimo conocido vale la última, tal cual.
   */
  minimoDe: (neumaticoId: string) => number | null = () => null,
): Record<string, Medicion> {
  const completas = revisionesConTodasLasRuedas(detalles);

  const orden = new Map(revisiones.map((r, i) => [r.id, i]));
  const sello = new Map(revisiones.map((r) => [r.id, (r.created_at ?? r.fecha_revision ?? null) as string | null]));
  // El día de la revisión, que es con lo que se compara el montaje. Es
  // `fecha_revision` y no `created_at`: el arco entra en la base al día
  // siguiente de pasar, y con el sello de entrada una lectura del mismo día
  // del montaje parecería posterior.
  const dia = new Map(revisiones.map((r) => [r.id, (r.fecha_revision ?? r.created_at ?? null) as string | null]));
  // Una fila de una revisión que no está en la lista no se puede ordenar: se
  // queda al final en vez de colarse la primera con un índice 0.
  const enOrden = [...detalles].sort(
    (a, b) => (orden.get(a.revision_id) ?? Number.MAX_SAFE_INTEGER) - (orden.get(b.revision_id) ?? Number.MAX_SAFE_INTEGER),
  );

  const esManual = new Map(revisiones.map((r) => [r.id, !!r.tecnico_id]));

  // De cada goma, sus lecturas de profundidad válidas de la más reciente a la
  // más antigua —hacen falta tres para el protocolo— y su última presión.
  const series = new Map<string, LecturaDeSerie[]>();
  const presiones = new Map<string, number>();
  for (const d of enOrden) {
    // Una fila de una revisión que no está en la lista —una anulada, por
    // ejemplo— no se puede fechar ni ordenar: no entra en la serie.
    if (!orden.has(d.revision_id)) continue;
    // A quién se le apunta la fila: a su neumático, y a la goma que hoy ocupa
    // esa posición si la lectura es posterior a su montaje.
    const destinatarios: string[] = [];
    if (d.neumatico_id) destinatarios.push(d.neumatico_id);
    const montado = d.posicion_id ? montajePorPosicion.get(d.posicion_id) : undefined;
    if (montado && montado.neumatico_id !== d.neumatico_id
        && esPosteriorAlMontaje(dia.get(d.revision_id), montado.fecha_montaje)) {
      destinatarios.push(montado.neumatico_id);
    }

    for (const nid of destinatarios) {
      if (d.profundidad_mm != null && completas.has(d.revision_id)) {
        const serie = series.get(nid) ?? [];
        if (serie.length < 3) {
          serie.push({ mm: d.profundidad_mm, manual: esManual.get(d.revision_id) ?? false, fecha: sello.get(d.revision_id) ?? null });
          series.set(nid, serie);
        }
      }
      if (d.presion_bar != null && !presiones.has(nid)) presiones.set(nid, d.presion_bar);
    }
  }

  const mapa: Record<string, Medicion> = {};
  for (const nid of new Set([...series.keys(), ...presiones.keys()])) {
    // La última lectura, salvo que deje la goma en el mínimo: entonces decide
    // el protocolo, con la última como pendiente si no está confirmada.
    const valor = valorDeLaGoma(series.get(nid) ?? [], minimoDe(nid));
    mapa[nid] = {
      profundidad_mm: valor?.mm ?? null,
      presion_bar: presiones.get(nid) ?? null,
      medido_en: valor?.fecha ?? null,
      confirmada: valor?.confirmada ?? false,
      pendiente_mm: valor?.pendiente?.mm ?? null,
      pendiente_en: valor?.pendiente?.fecha ?? null,
    };
  }
  return mapa;
}
