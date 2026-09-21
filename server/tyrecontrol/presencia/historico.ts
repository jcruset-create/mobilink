/**
 * Qué hacer con el histórico en cada barrido: alargar la estancia o abrir otra.
 *
 * El porqué de la tabla está en su migración. Aquí solo está la decisión, y
 * está aparte de `bases.ts` por lo mismo que `filas.ts`: ahí dentro se importa
 * el cliente de Supabase, que lanza al cargarse sin `SUPABASE_URL`.
 *
 * ── La regla que importa: un hueco corta, no alarga ─────────────────────────
 *
 * Si el barrido deja de correr —un despliegue, el proveedor caído, el servidor
 * dormido— y al volver el autobús sigue donde estaba, la tentación es alargar
 * la estancia. Sería mentir: durante esas horas no se le vio, y una estancia
 * que las incluya afirma una observación que no existe.
 *
 * Se cierra la anterior en su última muestra y se abre una nueva. Así el hueco
 * queda como hueco, y el informe puede decir «94 % medido sobre 110 horas» en
 * vez de un 94 % sobre 120 que nadie observó. Es el mismo criterio que se usó
 * al calcular esto a mano: topar los huecos en vez de rellenarlos.
 *
 * El umbral sale del intervalo del barrido, no de un número suelto: si mañana
 * se barre cada 30 minutos, el corte se mueve solo.
 */

/** Cuántos barridos seguidos se pueden perder sin cortar la estancia. */
export const BARRIDOS_DE_GRACIA = 3;

/** Lo que hace falta saber de la estancia que estaba abierta. */
export interface EstanciaAbierta {
  id: string;
  estado: string;
  delegacion_id: string | null;
  visto_at: string;
}

/** Lo que el barrido acaba de ver de un vehículo. */
export interface Visto {
  vehiculoId: string;
  empresaId: string;
  estado: string;
  delegacionId: string | null;
}

export type Accion =
  /** Sigue igual y sin hueco: se alarga la fila abierta. */
  | { accion: "extender"; id: string; vistoAt: string }
  /** Cambió de estado o de base: se cierra la abierta y se abre otra. */
  | { accion: "cortar"; cerrar: string; hasta: string; motivo: "cambio" | "hueco" }
  /** No había ninguna abierta: se abre la primera. */
  | { accion: "abrir" };

/**
 * Decide qué hacer con un vehículo en este barrido.
 *
 * `ahora` es el instante del barrido, no la fecha de la posición: lo que se
 * está fechando es CUÁNDO SE MIRÓ, que es lo único que se ha observado de
 * verdad. Un equipo con la posición de hace dos horas sigue siendo un vehículo
 * al que se ha visto ahora en ese estado.
 */
export function decidirEstancia(
  visto: Visto,
  abierta: EstanciaAbierta | undefined,
  ahora: string,
  intervaloMin: number,
): Accion {
  if (!abierta) return { accion: "abrir" };

  const huecoMaxMs = Math.max(1, intervaloMin) * BARRIDOS_DE_GRACIA * 60_000;
  const desdeLaUltima = Date.parse(ahora) - Date.parse(abierta.visto_at);

  // Un hueco largo corta aunque no haya cambiado nada. Ver la cabecera.
  if (Number.isFinite(desdeLaUltima) && desdeLaUltima > huecoMaxMs) {
    return { accion: "cortar", cerrar: abierta.id, hasta: abierta.visto_at, motivo: "hueco" };
  }

  const mismo =
    abierta.estado === visto.estado &&
    (abierta.delegacion_id ?? null) === (visto.delegacionId ?? null);
  if (mismo) return { accion: "extender", id: abierta.id, vistoAt: ahora };

  // `hasta` es la última muestra de la estancia vieja, no este instante: entre
  // una y otra el vehículo ya estaba en lo nuevo, y no se sabe desde cuándo.
  return { accion: "cortar", cerrar: abierta.id, hasta: abierta.visto_at, motivo: "cambio" };
}

/** Lo que se inserta al abrir una estancia. */
export function filaNueva(visto: Visto, ahora: string) {
  return {
    empresa_id: visto.empresaId,
    vehiculo_id: visto.vehiculoId,
    estado: visto.estado,
    delegacion_id: visto.delegacionId ?? null,
    desde: ahora,
    visto_at: ahora,
    hasta: null,
    muestras: 1,
    actualizado_at: ahora,
  };
}
