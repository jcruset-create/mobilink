/**
 * De qué telemática es un vehículo, para la columna de la lista.
 *
 * ── Por qué esto no es «tiene Webfleet o no» ────────────────────────────────
 *
 * La columna nació cuando Webfleet era la única telemática, y decía «SIN
 * WEBFLEET» a un autobús que lleva Movertis desde hace meses. Ahora hay dos
 * proveedores y habrá más, así que lo que se enseña es CUÁL, no si es el que
 * había primero.
 *
 * ── Cómo se entera de un proveedor nuevo ────────────────────────────────────
 *
 * Solo hay que enlazar vehículos con él. El backend devuelve el `connectorKey`
 * sin traducir y aquí se busca su nombre en una lista corta; lo que no esté en
 * la lista se enseña con la inicial en mayúscula. Un conector nuevo aparece en
 * la columna sin tocar nada, y ponerle el nombre bonito es añadir una línea.
 *
 * ── El enlace antiguo de Webfleet ───────────────────────────────────────────
 *
 * Antes del Integration Hub, Webfleet se ataba con `tc_vehiculos.webfleet_vehicle_id`
 * y esos enlaces siguen ahí, sin fila en `integration_mappings`. Cuentan igual:
 * un vehículo con ese campo relleno TIENE telemática, y decir lo contrario
 * sería mentir sobre lo que hay montado en el camión.
 */

import type { Vehiculo } from "../types";

/** Enlace activo entre un vehículo y una cuenta de telemática. */
export interface EnlaceTelematica {
  empresaId: string;
  vehiculoId: string;
  connectorKey: string;
  accountKey: string;
}

/** Nombres de los conectores que conocemos. Los demás salen capitalizados. */
export const NOMBRE_CONECTOR: Record<string, string> = {
  movertis: "Movertis",
  webfleet: "Webfleet",
};

export function nombreConector(clave: string): string {
  const conocido = NOMBRE_CONECTOR[clave.toLowerCase()];
  if (conocido) return conocido;
  const limpio = clave.trim();
  return limpio ? limpio.charAt(0).toUpperCase() + limpio.slice(1) : "—";
}

/** Los enlaces por vehículo, listos para consultar por id. */
export function porVehiculo(enlaces: EnlaceTelematica[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const e of enlaces) {
    const clave = e.connectorKey?.trim();
    if (!e.vehiculoId || !clave) continue;
    const lista = m.get(e.vehiculoId) ?? [];
    if (!lista.includes(clave)) lista.push(clave);
    m.set(e.vehiculoId, lista);
  }
  return m;
}

/**
 * Los conectores de un vehículo, en orden estable y sin repetir.
 *
 * Se ordenan alfabéticamente para que la columna no baile entre recargas: el
 * orden en que la base devuelve los enlaces no está garantizado, y una lista
 * que cambia de orden sola parece que ha cambiado de contenido.
 */
export function conectoresDe(v: Vehiculo, porVeh: Map<string, string[]>): string[] {
  const claves = new Set(porVeh.get(v.id) ?? []);
  // El enlace antiguo de Webfleet, el que vive en la ficha del vehículo.
  if ((v.webfleet_vehicle_id ?? "").trim()) claves.add("webfleet");
  return [...claves].sort();
}

/** Lo que se lee en la columna. Sin telemática se dice, no se deja en blanco. */
export function etiquetaTelematica(conectores: string[]): string {
  if (conectores.length === 0) return "Sin telemática";
  return conectores.map(nombreConector).join(" · ");
}
