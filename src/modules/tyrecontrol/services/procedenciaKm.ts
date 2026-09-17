/**
 * Cómo se cuenta en el panel de dónde salió un kilometraje.
 *
 * Función pura, y a propósito: el mismo criterio lo usan la ficha del vehículo
 * y el histórico de revisiones, y si cada pantalla lo redactara a su manera el
 * mismo dato se leería distinto según dónde se mirara.
 *
 * Abrir una ficha NO consulta al proveedor —esa regla ya está escrita en
 * `kilometrajeMensual/router.ts` y no se toca—, así que esto solo interpreta
 * lo que ya está guardado.
 */

import { ORIGEN_KM_LABELS, type OrigenKm } from "../types";

/** Cuánto tiempo hace, dicho como lo diría una persona. */
export function hace(desde: Date, ahora = new Date()): string {
  // Se trunca, no se redondea: 30 segundos no son «hace 1 min». Nunca se
  // exagera el tiempo transcurrido, que es lo que haría dudar de un dato
  // recién leído.
  const min = Math.max(0, Math.floor((ahora.getTime() - desde.getTime()) / 60_000));
  if (min < 1) return "hace menos de un minuto";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return h === 1 ? "hace 1 hora" : `hace ${h} horas`;
  const d = Math.floor(h / 24);
  return d === 1 ? "hace 1 día" : `hace ${d} días`;
}

/**
 * La línea que explica un kilometraje, o `null` si no hay nada que añadir.
 *
 * Se calla cuando no consta la procedencia: un «origen desconocido» no informa
 * y siembra dudas sobre un dato que puede ser perfectamente bueno.
 */
export function explicarKm(params: {
  origen?: string | null;
  capturadoAt?: string | null;
  ahora?: Date;
}): string | null {
  const clave = (params.origen ?? "").trim();
  if (!clave) return null;
  const nombre = ORIGEN_KM_LABELS[clave as OrigenKm] ?? clave;
  if (!params.capturadoAt) return nombre;
  const d = new Date(params.capturadoAt);
  if (Number.isNaN(d.getTime())) return nombre;
  return `${nombre} · lectura de ${hace(d, params.ahora)}`;
}
