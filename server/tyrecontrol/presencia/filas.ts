/**
 * Qué fila se escribe en cada barrido, y desde cuándo lleva el vehículo ahí.
 *
 * Vive aparte de `bases.ts` porque ahí dentro se importa el cliente de
 * Supabase, que LANZA al cargarse si no hay `SUPABASE_URL`: cualquier prueba
 * de esta lógica arrastraría media configuración de producción. Aquí no hay
 * ni red ni base, así que la decisión se puede comprobar tal cual.
 */

import type { FilaPresencia } from "../../integration-hub/application/services/BasePresenceService.ts";

/** Lo que hacía falta saber de la fila anterior para no perder la estancia. */
export interface Anterior {
  estado: string;
  delegacion_id: string | null;
  entrada_base_at: string | null;
  // Y lo demás que se compara para saber si la fila cambia. Opcional porque
  // `mismaEstancia` solo necesita las tres de arriba y se llama desde sitios
  // que no leen el resto.
  es_su_base?: boolean | null;
  distancia_m?: number | null;
  lat?: number | null;
  lng?: number | null;
  velocidad_kmh?: number | null;
  posicion_at?: string | null;
  proveedor?: string | null;
  cuenta?: string | null;
  externo?: boolean | null;
  motivo?: string | null;
}

/**
 * ── `entrada_base_at`: desde cuándo lleva ahí ───────────────────────────────
 *
 * Se conserva mientras el vehículo siga en la MISMA base. Es lo que contesta
 * «¿cuánto lleva parado aquí?», y es el dato que necesita el arco del
 * CheckPoint: si el autobús entró antes de la medición y no se ha ido, el
 * odómetro de ahora vale para entonces.
 *
 * `STALE_POSITION` dentro de una base cuenta como seguir en la misma estancia:
 * un equipo que se duerme al aparcar es lo normal en esta flota, y reiniciar la
 * entrada cada vez que se calla convertiría «lleva tres días en la base» en
 * «acaba de llegar», que es justo lo contrario de la verdad.
 *
 * Lo que no se hace es inventar el instante: si no hay posición fechada,
 * `entrada_base_at` se queda nula en vez de apuntar la hora del barrido, que
 * sería la hora de la consulta y no la de la llegada.
 */

/** ¿Sigue el vehículo en la MISMA estancia que la última vez que se miró? */
export function mismaEstancia(baseId: string | undefined, prev: Anterior | undefined): boolean {
  if (!baseId || !prev) return false;
  if (prev.delegacion_id !== baseId) return false;
  // `STALE_POSITION` dentro de la base cuenta como seguir ahí: ver la cabecera.
  return prev.estado === "IN_BASE" || prev.estado === "STALE_POSITION";
}

/** Una fila del barrido, ya en columnas de Supabase. Pura: se puede probar. */
export function filaDePresencia(
  f: FilaPresencia,
  prev: Anterior | undefined,
  ahora: string,
): Record<string, unknown> {
  const sigue = mismaEstancia(f.baseId, prev);
  const posicionAt = f.posicionAt ? f.posicionAt.toISOString() : null;

  return {
      vehiculo_id: f.vehiculoId,
      empresa_id: f.tenantId,
      estado: f.estado,
      delegacion_id: f.baseId ?? null,
      es_su_base: f.baseId ? f.esSuBase === true : null,
      distancia_m: f.distanciaM == null ? null : Math.round(f.distanciaM),
      antiguedad_min: f.antiguedadMin ?? null,
      lat: f.lat ?? null,
      lng: f.lng ?? null,
      velocidad_kmh: f.velocidadKmh ?? null,
      posicion_at: posicionAt,
      entrada_base_at: !f.baseId
        ? null
        : sigue
          ? (prev?.entrada_base_at ?? posicionAt)
          : posicionAt,
      proveedor: f.proveedor || null,
      cuenta: f.cuenta || null,
      externo: f.externo,
      motivo: f.motivo ?? null,
      calculado_at: f.calculadoAt.toISOString(),
      updated_at: ahora,
  };
}

/**
 * ── Qué cuenta como «ha cambiado» ───────────────────────────────────────────
 *
 * El barrido escribía las 717 filas en cada vuelta. Medido el 10/11/2026, solo
 * 356 de los 717 vehículos traen posición más fresca que el intervalo de diez
 * minutos: los otros 361 —155 de ellos dormidos, con posición de hace más de
 * una hora— se reescribían para no decir nada nuevo.
 *
 * Lo que sí cambiaba en TODAS eran tres columnas que no son el dato sino la
 * contabilidad del barrido: `calculado_at` y `updated_at` son la hora de la
 * vuelta, y `antiguedad_min` es «cuánto hace de la posición», que crece sola
 * aunque no llegue nada nuevo. Por eso las tres quedan fuera de la
 * comparación: `antiguedad_min` se recalcula al LEER (`frescura.ts`) y el
 * instante del barrido se guarda una vez por vuelta en `tc_presencia_barrido`,
 * en vez de 717 veces aquí.
 *
 * `vehiculo_id` y `empresa_id` tampoco se comparan: son la identidad de la
 * fila, iguales por definición.
 */
export const COLUMNAS_COMPARABLES = [
  "estado",
  "delegacion_id",
  "es_su_base",
  "distancia_m",
  "lat",
  "lng",
  "velocidad_kmh",
  "posicion_at",
  "entrada_base_at",
  "proveedor",
  "cuenta",
  "externo",
  "motivo",
] as const;

/**
 * Las que son instantes.
 *
 * Importa: lo que escribimos es `toISOString()` —«…T16:21:12.315Z»— y lo que
 * devuelve Supabase es «…T16:21:12.315+00:00». Es el MISMO instante escrito de
 * dos formas, y compararlo como texto daría «ha cambiado» siempre, con lo que
 * no se saltaría ni una fila y todo esto no serviría de nada.
 */
const INSTANTES: ReadonlySet<string> = new Set(["posicion_at", "entrada_base_at"]);

function comparable(columna: string, valor: unknown): string {
  if (valor == null) return "";
  if (INSTANTES.has(columna)) {
    const t = Date.parse(String(valor));
    return Number.isNaN(t) ? String(valor) : String(t);
  }
  return String(valor);
}

/** ¿Hay que escribir esta fila, o dice exactamente lo mismo que la guardada? */
export function filaCambia(
  nueva: Record<string, unknown>,
  prev: Anterior | undefined,
): boolean {
  if (!prev) return true; // No había fila: hay que crearla.
  return COLUMNAS_COMPARABLES.some(
    (c) => comparable(c, nueva[c]) !== comparable(c, (prev as unknown as Record<string, unknown>)[c]),
  );
}
