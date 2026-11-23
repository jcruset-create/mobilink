/**
 * ¿Ha cambiado el estado Webfleet de un vehículo desde la última pasada?
 *
 * La sincronización reescribía los 717 vehículos cada 5 minutos aunque
 * estuvieran aparcados: `updated_at` cambiaba siempre, así que cada fila era
 * una escritura. En Supabase eso fueron 24 millones de actualizaciones, la
 * tabla que más disco gastaba de toda la base. Ahora solo se escribe la fila
 * que trae algo distinto.
 *
 * Se comparan solo las columnas que trae la fila nueva: una fila de «sin
 * conexión» no trae posición, y el upsert deja la que había; no es un cambio.
 * `updated_at` no cuenta: pasa a ser «cuándo cambió», no «cuándo se miró».
 *
 * Sin base ni red: se prueba en `webfleetCambios.test.ts`.
 */

/** Columnas que son fechas: Supabase las devuelve como `…+00:00` y aquí se generan como `…Z`. */
const FECHAS = new Set(["pos_time", "entrada_base_at"]);

function igual(campo: string, antes: unknown, ahora: unknown): boolean {
  if (antes == null || ahora == null) return antes == null && ahora == null;
  if (FECHAS.has(campo)) {
    const a = new Date(String(antes)).getTime();
    const b = new Date(String(ahora)).getTime();
    return Number.isFinite(a) && a === b;
  }
  if (typeof ahora === "number" || typeof antes === "number") return Number(antes) === Number(ahora);
  return String(antes) === String(ahora);
}

export function estadoWebfleetCambia(
  antes: Record<string, unknown> | undefined,
  fila: Record<string, unknown>
): boolean {
  if (!antes) return true;
  for (const [campo, valor] of Object.entries(fila)) {
    if (campo === "updated_at" || campo === "vehiculo_id") continue;
    if (!igual(campo, antes[campo], valor)) return true;
  }
  return false;
}
