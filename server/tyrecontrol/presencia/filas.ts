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
