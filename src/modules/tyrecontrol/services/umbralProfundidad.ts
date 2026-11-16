/**
 * A qué profundidad hay que cambiar una goma, según su llanta.
 *
 *   llanta 22.5 y mayores  →  ≤ 4 mm
 *   llanta 19.5 y 17.5     →  ≤ 3 mm
 *   llanta 16 e inferiores →  ≤ 2 mm
 *
 * ── Esto es un PUERTO, y hay que decirlo ───────────────────────────────────
 *
 * La regla vive en la base, en `tc_profundidad_minima_por_llanta`
 * (`supabase/migrations/tyrecontrol_profundidad_minima_por_llanta.sql`), que
 * es la que usa el informe de alertas de toda la empresa. Aquí se repite
 * porque la ficha del vehículo tiene que pintar la rueda en rojo SIN pedirle
 * al servidor el informe entero de la flota: son 103 filas de «sin revisar» y
 * 91 de «cambiar ya» para contestar por un camión.
 *
 * Es el mismo trato que `utils/profundidad.ts` tiene con la APK: si se cambia
 * aquí hay que cambiarlo allí. Las pruebas de este fichero usan EXACTAMENTE la
 * misma tabla de casos que trae la migración en su comprobación, así que una
 * discrepancia sale en cuanto se toca cualquiera de los dos.
 *
 * ── Las bandas, y por qué son bandas ───────────────────────────────────────
 *
 * Se piden tres casos (22.5 / 19.5-17.5 / 16 e inferiores) pero en la flota
 * hay además R15, R17, R18 y R19. Tres valores sueltos dejarían a ésos sin
 * umbral; tres bandas los cubren sin inventar nada.
 */

/** Las bandas, en pulgadas de llanta. Mismo orden que en la base. */
const BANDAS: Array<{ desde: number; mm: number }> = [
  { desde: 20, mm: 4 },
  { desde: 17, mm: 3 },
  { desde: 0, mm: 2 },
];

/**
 * El diámetro de llanta que diga la medida. «295/80R22.5» → 22.5.
 *
 * Dos cifras y como mucho un decimal, a propósito y no por capricho: medido
 * contra las 24 medidas reales de la flota, buscar «dígitos tras la R» sin
 * acotar devuelve 22.5154 para «295/80R22.5 154/149M», que lleva el índice de
 * carga pegado.
 *
 * `null` cuando la medida no dice el diámetro: falta, está a «0», o viene
 * escrita de una forma que no se reconoce. Null no es cero.
 */
export function llantaDeMedida(medida: string | null | undefined): number | null {
  const m = /R\s?(\d{2}(?:[.,]\d)?)/i.exec(medida ?? "");
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * La profundidad mínima de esa medida, o `null` si no se sabe la llanta.
 *
 * Sin llanta no se devuelve un valor por defecto a propósito: quien llame
 * tiene que poder distinguir «esta goma está para cambiar» de «de esta goma no
 * se sabe», y un 2 por defecto diría lo primero cuando pasa lo segundo.
 */
export function profundidadMinimaPorLlanta(medida: string | null | undefined): number | null {
  const d = llantaDeMedida(medida);
  if (d == null) return null;
  return BANDAS.find((b) => d >= b.desde)?.mm ?? null;
}

/**
 * Los mínimos que una empresa se ha puesto a sí misma en la pantalla de
 * umbrales: uno general y, si quiere, uno por medida.
 */
export interface MinimosDeEmpresa {
  /** El general de la empresa, o null si no tiene. */
  empresa: number | null;
  /** Por medida, con la clave ya normalizada (`claveDeMedida`). */
  porMedida: Record<string, number>;
}

export const SIN_MINIMOS: MinimosDeEmpresa = { empresa: null, porMedida: {} };

/** «295/80 r22.5» → «295/80R22.5». La misma cuenta que `tc_norm_medida`. */
export function claveDeMedida(medida: string | null | undefined): string {
  return (medida ?? "").toUpperCase().replace(/\s/g, "");
}

/**
 * El mínimo que rige para una goma: el de su medida en la empresa, si no el
 * general de la empresa, y si la empresa no ha puesto ninguno, el de la llanta.
 *
 * Es el mismo orden que usan los informes en la base
 * (`tc_profundidad_vigente`). Sin esto la ficha juzgaba siempre contra la
 * llanta y una empresa con su mínimo a 3 mm veía en la ficha «para cambiar»
 * una goma de 3,5 mm que no salía en ninguna alerta.
 *
 * Falta aquí el escalón por categoría que sí tiene la base
 * (`tc_config_umbrales_categoria`): hoy no lo usa ninguna empresa.
 */
export function minimoDeLaGoma(
  medida: string | null | undefined,
  minimos: MinimosDeEmpresa | null | undefined,
): number | null {
  const suyo = minimos?.porMedida[claveDeMedida(medida)] ?? minimos?.empresa ?? null;
  return suyo ?? profundidadMinimaPorLlanta(medida);
}

/**
 * ¿Hay que cambiar esta goma ya?
 *
 * Falso cuando falta la profundidad o no se sabe la llanta: en los dos casos
 * lo que pasa es que no hay dato, y pintar de rojo una rueda por falta de
 * datos convierte el rojo en ruido. Un vehículo sin medir ya sale en el
 * informe por «sin revisar», que es su problema de verdad.
 */
export function hayQueCambiar(
  profundidadMm: number | null | undefined,
  medida: string | null | undefined,
): boolean {
  if (profundidadMm == null || !Number.isFinite(profundidadMm)) return false;
  const minimo = profundidadMinimaPorLlanta(medida);
  if (minimo == null) return false;
  return profundidadMm <= minimo;
}

/** «4 mm (≤ 4 de una llanta 22.5)», o `null` si no toca cambiarla. */
export function textoDeCambio(
  profundidadMm: number | null | undefined,
  medida: string | null | undefined,
): string | null {
  if (!hayQueCambiar(profundidadMm, medida)) return null;
  return `${profundidadMm} mm (≤ ${profundidadMinimaPorLlanta(medida)} de una llanta ${llantaDeMedida(medida)})`;
}
