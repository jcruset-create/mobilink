/**
 * Numeradores correlativos por empresa, serie y año.
 *
 * Un único INSERT … ON CONFLICT DO UPDATE … RETURNING: la fila del numerador
 * queda bloqueada hasta el COMMIT de la transacción que pidió el número, así
 * que dos emisiones simultáneas se ponen en fila y nunca comparten número. Si
 * la transacción hace ROLLBACK, el incremento también se deshace: no quedan
 * huecos por errores (requisito de las facturas). Hay que llamarlo DENTRO de
 * la transacción que guarda el documento numerado.
 */

import type { Ejecutor } from "./db.ts";
import { formatearNumero } from "../domain/facturacion.ts";

export async function siguienteNumero(c: Ejecutor, empresaId: string, serie: string, anio: number): Promise<{ numero: string; valor: number }> {
  const { rows } = await c.query(
    `INSERT INTO self_storage_sequences (empresa_id, series, year, last_value)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (empresa_id, series, year) DO UPDATE SET last_value = self_storage_sequences.last_value + 1
     RETURNING last_value`,
    [empresaId, serie, anio]
  );
  const valor = Number(rows[0].last_value);
  return { numero: formatearNumero(serie, anio, valor), valor };
}

/** Año de una fecha 'YYYY-MM-DD'. */
export const anioDe = (fecha: string) => Number(fecha.slice(0, 4));

/** Hoy, como fecha de calendario de Madrid (donde se emiten las facturas). */
export function hoyMadrid(ahora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora);
}
