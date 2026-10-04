/**
 * Protección de datos: las transcripciones no se guardan salvo que la empresa
 * lo active, y las que se guardan se borran pasados los días de retención
 * (`call_center.transcript_retention_days`). Si la empresa desactiva el
 * guardado, se borran TODAS las que tenga. La llamada (motivo, resultado,
 * resumen) se conserva: es el registro de la atención, no la conversación.
 *
 * El audio no se graba (`call_center.store_audio` sólo admite «no»).
 */

import { pool } from "../../shared/db.ts";
import { leerAjuste } from "../../shared/settings.ts";

export async function purgarTranscripciones(): Promise<{ empresas: number; borradas: number }> {
  const { rows: empresas } = await pool.query(`SELECT DISTINCT empresa_id FROM self_storage_calls WHERE transcript IS NOT NULL`);
  let borradas = 0;
  for (const { empresa_id: empresaId } of empresas) {
    const guardar = await leerAjuste(pool, empresaId, null, "call_center.store_transcripts");
    const dias = await leerAjuste(pool, empresaId, null, "call_center.transcript_retention_days");
    const { rowCount } = await pool.query(
      `UPDATE self_storage_calls SET transcript = NULL
        WHERE empresa_id = $1 AND transcript IS NOT NULL AND ($2::boolean = false OR started_at < now() - make_interval(days => $3))`,
      [empresaId, guardar, dias]
    );
    borradas += rowCount ?? 0;
  }
  return { empresas: empresas.length, borradas };
}
