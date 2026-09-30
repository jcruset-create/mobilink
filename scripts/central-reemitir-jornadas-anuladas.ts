/**
 * Reenvía a MC Central las jornadas que la caja tiene ANULADAS y Central sigue
 * teniendo por abiertas.
 *
 * ── Por qué hace falta ────────────────────────────────────────────────────
 *
 * Anular una jornada no emitía ningún evento, así que Central nunca se
 * enteraba y la dejaba ABIERTA para siempre. El síntoma que lo destapó: la red
 * decía ocho jornadas abiertas con dos cajas, cuando la base de datos de la
 * caja impide que una caja tenga más de una abierta a la vez.
 *
 * Desde ahora `anularJornada` emite `SESSION_VOIDED`, pero desplegar no repara
 * lo ya ocurrido: esas jornadas se anularon sin evento y no hay nada que
 * reproyectar. Esto lo emite ahora, con la fecha y el motivo que la caja
 * guardó en su momento.
 *
 * Esto NO cambia ni un dato de la caja. Solo vuelve a contar lo que la caja ya
 * dice, para que las dos digan lo mismo.
 *
 *   npx tsx scripts/central-reemitir-jornadas-anuladas.ts             # mirar
 *   npx tsx scripts/central-reemitir-jornadas-anuladas.ts --aplicar   # hacerlo
 *
 * Por defecto NO cambia nada: enseña lo que haría.
 */

import pool from "../server/db.ts";
import { centroDeCaja, emitirEvento } from "../server/cash/events/emitter.ts";

const APLICAR = process.argv.includes("--aplicar");

/*
 * La fecha de un `DATE` de pg NO se saca con String().slice(0,10): eso da
 * «Thu Aug 27». Ya mordió una vez en este módulo.
 */
const fechaIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? null : String(v).slice(0, 10);

async function main(): Promise<void> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  /*
   * Solo las que están DESCUADRADAS entre las dos: anuladas en la caja y
   * abiertas en Central. Reenviar las que ya cuadran no haría daño —el evento
   * es idempotente por su clave— pero llenaría la cola de ruido y escondería
   * en el listado las que de verdad hay que reparar.
   */
  const { rows } = await pool.query<any>(
    `SELECT s.id, s.empresa_id, s.register_id, s.fecha, s.notas,
            c.estado AS dice_central,
            COALESCE(r.centro || ' · ', '') || r.nombre AS caja
       FROM cash_sessions s
       JOIN central_sessions c ON c.session_id = s.id
       LEFT JOIN cash_registers r ON r.id = s.register_id
      WHERE s.estado = 'CANCELLED'
        AND c.estado IN ('OPEN','REOPENED')
      ORDER BY s.id`
  );

  if (rows.length === 0) {
    console.log("No hay ninguna jornada anulada que Central tenga por abierta.");
    return;
  }

  console.log(`${rows.length} jornada(s) anulada(s) que Central sigue contando como abiertas:\n`);
  for (const s of rows) {
    console.log(
      `  #${s.id}  ${fechaIso(s.fecha)}  ${s.caja ?? `caja ${s.register_id}`}` +
        `  · Central dice ${s.dice_central}`
    );
  }

  if (!APLICAR) {
    console.log("\nNada cambiado. Vuelve a lanzarlo con --aplicar para reenviarlas.");
    return;
  }

  let hechas = 0;
  for (const s of rows) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await emitirEvento(client, {
        empresaId: String(s.empresa_id),
        centroId: await centroDeCaja(client, Number(s.register_id)),
        registerId: Number(s.register_id),
        sessionId: Number(s.id),
        agregado: { tipo: "SESSION", id: Number(s.id) },
        tipo: "SESSION_VOIDED",
        ocurridoEnMs: Date.now(),
        actorUserId: null,
        // El motivo vive en las notas de la jornada, que es donde lo dejó
        // `anularJornada`. Se manda tal cual: inventarlo sería peor que nada.
        datos: { fecha: fechaIso(s.fecha), motivo: s.notas ?? null },
      });
      await client.query("COMMIT");
      hechas++;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  console.log(`\n      ${hechas} reenviada(s). Central avisada.`);
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
