/**
 * Los ajustes del cierre automático, sin tocar la base.
 *
 * Están aparte del pase que cierra —`cierreAutomatico.ts`— por la misma razón
 * que `permissions.ts` está aparte del router: es política, se puede leer de
 * una vez y se puede probar sin levantar PostgreSQL.
 *
 * La regla que sostiene el fichero: **de fábrica está apagado, y solo se
 * enciende con un `true` explícito**. Nada de valores que "parecen sí".
 * Encender esto cierra tarifas de forma irreversible, así que tiene que
 * haberlo puesto alguien a propósito.
 */

export interface AjustesCierre {
  activo: boolean;
  esperaMin: number;
}

/**
 * 24 horas. La etapa de cierre es inmutable: si se cierra a los cinco minutos
 * y el taller comunica un neumático dos horas después, ese neumático ya no
 * entra en la tarifa y hay que meterlo como ajuste manual auditado.
 */
export const ESPERA_POR_DEFECTO_MIN = 24 * 60;

function objeto(settings: unknown): Record<string, any> {
  if (settings == null) return {};
  if (typeof settings !== "string") return (settings as Record<string, any>) ?? {};
  try { return JSON.parse(settings) ?? {}; } catch { return {}; }
}

/**
 * Cero es válido —cerrar al momento es una opción— pero "sin poner" no es
 * cero.
 *
 * `Number(null)` vale 0, así que sin este filtro un `cierreAutomaticoEsperaMin`
 * a null significaría "cerrar al momento" en lugar de "usa el valor por
 * defecto". Con un cierre irreversible de por medio, ese es exactamente el
 * defecto que no se quiere.
 */
export function normalizarEspera(v: unknown): number {
  if (v == null || v === "") return ESPERA_POR_DEFECTO_MIN;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : ESPERA_POR_DEFECTO_MIN;
}

export function leerAjustesCierre(settings: unknown): AjustesCierre {
  const p = objeto(settings)?.pricing ?? {};
  return {
    activo: p.cierreAutomatico === true,
    esperaMin: normalizarEspera(p.cierreAutomaticoEsperaMin),
  };
}
