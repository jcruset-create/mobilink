/**
 * ¿Es creíble esta bajada de profundidad con los kilómetros que se han hecho?
 *
 * ── El caso que lo destapó ──────────────────────────────────────────────────
 *
 * El 2651JRM, delantera izquierda, nueva desde agosto:
 *
 *     13/11   776.307 km   12,2 mm
 *     14/11   776.502 km    1,6 mm      ← 195 km después
 *     16/11                 2,2 mm
 *
 * A su ritmo —0,16 mm cada 1.000 km— en 195 km tocaban 0,03 mm, no 10,6. Y
 * salió en rojo como «cambiar»: el protocolo contra los falsos desgastes
 * (`protocoloProfundidad.ts`) da por buena una lectura cuando otra la
 * respalda, y aquí el arco falló dos veces seguidas. Dos disparates que
 * coinciden se confirman entre ellos.
 *
 * Lo que el protocolo no mira, y esto sí, es si la bajada CABE en los
 * kilómetros recorridos.
 *
 * ── La regla ────────────────────────────────────────────────────────────────
 *
 * Con las lecturas de la goma desde que se montó, de la más reciente a la más
 * antigua:
 *
 *   · En duda están las tres últimas (la ventana del protocolo). Su mediana
 *     es el valor que se iba a dar por bueno.
 *   · La BASE es la mediana de las tres anteriores: cómo estaba la goma antes
 *     de las lecturas en duda. Mediana, para que un pico suelto no la mueva.
 *   · El RITMO es el de la propia goma: lo que ha bajado desde sus primeras
 *     lecturas hasta la base, por cada 1.000 km. Si no tiene recorrido
 *     bastante para calcularlo, vale el ritmo medio de las demás ruedas del
 *     vehículo.
 *   · Lo que PODÍA bajar: el doble de su ritmo en los kilómetros hechos desde
 *     la base, más 1 mm por lo que baila el arco de un día a otro.
 *
 * Si ha bajado más que eso, la lectura no es creíble: no se da por buena, la
 * goma se queda en su base y la lectura pasa a «por confirmar», para medirla
 * con sonda. No se borra ni se calla: puede ser un fallo del arco o una rueda
 * que alguien cambió sin apuntarlo, y las dos cosas hay que ir a mirarlas.
 *
 * ── Cuándo NO se juzga ──────────────────────────────────────────────────────
 *
 * Sin datos no se acusa a una lectura de mentir. Se deja como estaba cuando:
 *
 *   · hay menos de seis lecturas (no hay base);
 *   · alguna de las tres últimas la midió un técnico: la sonda manda;
 *   · no se sabe cuántos kilómetros ha hecho el vehículo en ese tramo;
 *   · no hay ritmo, ni el suyo ni el de las demás ruedas.
 *
 * ── Los kilómetros de una lectura ───────────────────────────────────────────
 *
 * Las revisiones del arco nacen sin kilómetros y la telemática se los pone de
 * madrugada, así que la de hoy casi nunca los tiene. Cuando faltan se estiman
 * por la fecha, con los kilómetros de las demás revisiones del vehículo
 * (`kmEnFecha`).
 *
 * Es código puro: sin base de datos ni navegador, para poder probarlo con los
 * números de verdad.
 */

/** Los mm que baila el arco de un día a otro y que no son desgaste. */
export const MARGEN_ARCO_MM = 1;
/** Cuántas veces su ritmo se le tolera a una goma. */
export const VECES_EL_RITMO = 2;
/** Con menos recorrido que esto, el ritmo de una goma es ruido. */
export const KM_MINIMOS_PARA_RITMO = 3000;

export interface LecturaConKm {
  mm: number;
  /** Día de la revisión, ISO. */
  fecha: string | null;
  /** Kilómetros del vehículo ese día, si se saben. */
  km: number | null;
  /** La midió un técnico, no el arco. */
  manual: boolean;
}

/** Un punto del cuentakilómetros del vehículo. */
export interface PuntoKm { fecha: string; km: number }

const diaDe = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86400000;

/**
 * Los kilómetros del vehículo un día, a partir de los que sí se saben.
 *
 * Entre dos puntos, en línea recta. Después del último, con el ritmo de los
 * últimos 30 días; antes del primero, con el del primer tramo. Con menos de
 * dos puntos no hay ritmo y devuelve null.
 */
export function kmEnFecha(puntos: PuntoKm[], fecha: string | null): number | null {
  if (!fecha) return null;
  const orden = [...puntos].filter((p) => Number.isFinite(p.km) && p.km > 0 && p.fecha)
    .sort((a, b) => diaDe(a.fecha) - diaDe(b.fecha));
  if (orden.length === 0) return null;
  const d = diaDe(fecha);
  const exacto = orden.filter((p) => diaDe(p.fecha) === d).pop();
  if (exacto) return exacto.km;
  if (orden.length < 2) return null;

  const ritmo = (a: PuntoKm, b: PuntoKm) => {
    const dias = diaDe(b.fecha) - diaDe(a.fecha);
    return dias > 0 ? Math.max(0, (b.km - a.km) / dias) : 0;
  };
  const primero = orden[0];
  const ultimo = orden[orden.length - 1];
  if (d > diaDe(ultimo.fecha)) {
    const desde = orden.find((p) => diaDe(ultimo.fecha) - diaDe(p.fecha) <= 30) ?? primero;
    const r = ritmo(desde === ultimo ? orden[orden.length - 2] : desde, ultimo);
    return Math.round(ultimo.km + r * (d - diaDe(ultimo.fecha)));
  }
  if (d < diaDe(primero.fecha)) {
    return Math.round(primero.km - ritmo(primero, orden[1]) * (diaDe(primero.fecha) - d));
  }
  for (let i = 1; i < orden.length; i += 1) {
    const a = orden[i - 1];
    const b = orden[i];
    if (d <= diaDe(b.fecha)) return Math.round(a.km + ritmo(a, b) * (d - diaDe(a.fecha)));
  }
  return null;
}

/** La lectura de en medio de tres (o la única, o la más baja de dos). */
function mediana(l: LecturaConKm[]): LecturaConKm {
  const enOrden = [...l].sort((a, b) => a.mm - b.mm);
  return enOrden[Math.floor((enOrden.length - 1) / 2)];
}

/**
 * El ritmo de desgaste de una goma, en mm cada 1.000 km: de sus primeras
 * lecturas a su base. Null si no tiene recorrido bastante.
 *
 * Las lecturas, de la más reciente a la más antigua. Se deja fuera la ventana
 * en duda (las tres últimas): un ritmo calculado con la lectura que se está
 * juzgando le daría la razón siempre.
 */
export function ritmoDeLaGoma(lecturas: LecturaConKm[]): number | null {
  if (lecturas.length < 9) return null;
  const base = mediana(lecturas.slice(3, 6));
  const primeras = mediana(lecturas.slice(-3));
  if (base.km == null || primeras.km == null) return null;
  const km = base.km - primeras.km;
  if (km < KM_MINIMOS_PARA_RITMO) return null;
  // Una goma no crece: si la base sale por encima de las primeras lecturas es
  // ruido, y su ritmo es cero —no negativo—.
  return Math.max(0, (primeras.mm - base.mm) / km * 1000);
}

export interface JuicioDesgaste {
  /** true: cabe. false: no cabe. null: no hay con qué juzgar. */
  creible: boolean | null;
  /** Por qué no se ha juzgado, o la cuenta hecha. */
  explicacion: string;
  /** Cómo estaba la goma antes de las lecturas en duda. */
  base: { mm: number; fecha: string | null } | null;
  bajadaMm: number | null;
  km: number | null;
  ritmo: number | null;
  permitidoMm: number | null;
}

const num = (n: number, d = 1) => n.toFixed(d).replace(".", ",");
const miles = (n: number) => Math.round(n).toLocaleString("es-ES");

/**
 * El juicio de la bajada.
 *
 * `lecturas`: las de la goma desde su montaje, de la más reciente a la más
 * antigua, YA con sus kilómetros (o null donde no se sepan ni se puedan
 * estimar). `ritmoDeReserva`: el medio de las demás ruedas del vehículo, para
 * la goma que no tiene recorrido propio.
 */
export function juzgarDesgaste(lecturas: LecturaConKm[], ritmoDeReserva: number | null = null): JuicioDesgaste {
  const sin = (explicacion: string): JuicioDesgaste =>
    ({ creible: null, explicacion, base: null, bajadaMm: null, km: null, ritmo: null, permitidoMm: null });

  if (lecturas.length < 6) return sin("Pocas lecturas para comparar.");
  const ventana = lecturas.slice(0, 3);
  if (ventana.some((l) => l.manual)) return sin("La midió un técnico.");

  const valor = mediana(ventana);
  const base = mediana(lecturas.slice(3, 6));
  const ultima = lecturas[0];
  if (ultima.km == null || base.km == null) return sin("No se saben los kilómetros de ese tramo.");
  const km = Math.max(0, ultima.km - base.km);

  const ritmo = ritmoDeLaGoma(lecturas) ?? ritmoDeReserva;
  if (ritmo == null) return sin("No hay recorrido bastante para saber su ritmo de desgaste.");

  const bajadaMm = base.mm - valor.mm;
  const permitidoMm = VECES_EL_RITMO * ritmo * km / 1000 + MARGEN_ARCO_MM;
  const creible = bajadaMm <= permitidoMm;
  const cuenta = `Ha bajado ${num(bajadaMm)} mm en ${miles(km)} km; a su ritmo, ${num(ritmo, 2)} mm cada 1.000 km, `
    + `le tocaban ${num(ritmo * km / 1000)} mm`;
  return {
    creible,
    explicacion: creible ? `${cuenta}.` : `${cuenta}. No es desgaste: medir con sonda.`,
    base: { mm: base.mm, fecha: base.fecha },
    bajadaMm, km, ritmo, permitidoMm,
  };
}

/** El ritmo medio de las gomas que sí tienen el suyo. Null si ninguna. */
export function ritmoMedio(ritmos: Array<number | null>): number | null {
  const validos = ritmos.filter((r): r is number => r != null);
  return validos.length ? validos.reduce((s, r) => s + r, 0) / validos.length : null;
}
