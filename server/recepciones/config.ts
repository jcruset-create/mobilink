/**
 * Los números y textos que se pueden cambiar sin desplegar.
 *
 * Misma forma que `therefore/config.ts`: clave/valor por empresa en
 * `rcp_config`, y lectores que **nunca lanzan**: que no se pueda leer la
 * configuración no puede impedir que se procese un correo.
 */

import pool from "../db.ts";

export const CLAVES = {
  /**
   * El instante de la primera pasada del buzón. Pone el suelo: lo que ya
   * estaba en el buzón antes no se procesa nunca solo. Se escribe una vez.
   */
  buzonActivadoEl: "buzon.activado_el",
  /**
   * Cuando el correo de albarán no detalla líneas ni cantidad, ¿se da por
   * expedido todo lo pendiente del pedido? Por defecto sí: es lo que hace
   * Soledad en la práctica (un albarán por pedido) y el operario corrige en
   * el muelle si no cuadra. En «0» el albarán queda pendiente de revisión.
   */
  asumirExpedicionCompleta: "correo.asumir_expedicion_completa",
  /**
   * Hasta qué UID se ha mirado ya en cada carpeta, con su UIDVALIDITY. Es la
   * marca de progreso del buzón, y sustituye a marcar los correos como
   * leídos: ver la cabecera de `buzon.ts`.
   */
  progresoBuzon: "buzon.progreso",
} as const;

export async function leerTextoConfig(empresaId: string, clave: string): Promise<string | null> {
  try {
    const r = await pool.query<{ valor: string | null }>(`SELECT valor FROM rcp_config WHERE empresa_id = $1 AND clave = $2`, [empresaId, clave]);
    return r.rows[0]?.valor ?? null;
  } catch {
    return null;
  }
}

export async function guardarTextoConfig(empresaId: string, clave: string, valor: string): Promise<void> {
  await pool.query(
    `INSERT INTO rcp_config (empresa_id, clave, valor, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (empresa_id, clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = now()`,
    [empresaId, clave, valor]
  );
}

export async function asumirExpedicionCompleta(empresaId: string): Promise<boolean> {
  const v = await leerTextoConfig(empresaId, CLAVES.asumirExpedicionCompleta);
  return v === null || v === "" ? true : v !== "0" && v.toLowerCase() !== "false";
}

export type ProgresoBuzon = { uidValidity: number | null; ultimoUid: number };

const SIN_PROGRESO: ProgresoBuzon = { uidValidity: null, ultimoUid: 0 };

const claveProgreso = (carpeta: string) => `${CLAVES.progresoBuzon}.${carpeta.toLowerCase()}`;

/**
 * Hasta dónde se miró la última vez en esta carpeta. Nunca lanza: sin marca
 * (o con una ilegible) se empieza por el suelo de la activación, y lo que ya
 * se procesó se reconoce por su Message-ID.
 */
export async function leerProgresoBuzon(empresaId: string, carpeta: string): Promise<ProgresoBuzon> {
  const crudo = await leerTextoConfig(empresaId, claveProgreso(carpeta));
  if (!crudo) return SIN_PROGRESO;
  try {
    const v = JSON.parse(crudo) as Partial<ProgresoBuzon>;
    const ultimoUid = Number(v.ultimoUid);
    return {
      uidValidity: v.uidValidity == null ? null : Number(v.uidValidity),
      ultimoUid: Number.isFinite(ultimoUid) && ultimoUid > 0 ? ultimoUid : 0,
    };
  } catch {
    return SIN_PROGRESO;
  }
}

export async function guardarProgresoBuzon(empresaId: string, carpeta: string, progreso: ProgresoBuzon): Promise<void> {
  await guardarTextoConfig(empresaId, claveProgreso(carpeta), JSON.stringify(progreso));
}

/**
 * La fecha de activación del buzón. Si no existe, se fija AHORA y se devuelve.
 * Es el único sitio que la escribe, y sólo cuando falta: un reinicio no
 * «reactiva» el buzón y se traga meses de correo.
 */
export async function fechaDeActivacion(empresaId: string, ahora = new Date()): Promise<Date> {
  const guardada = await leerTextoConfig(empresaId, CLAVES.buzonActivadoEl);
  if (guardada && !Number.isNaN(new Date(guardada).getTime())) return new Date(guardada);
  await guardarTextoConfig(empresaId, CLAVES.buzonActivadoEl, ahora.toISOString());
  return ahora;
}
