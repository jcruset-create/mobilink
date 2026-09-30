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
/*
 * El trabajo lo hace `reemitirJornadasAnuladas`, el MISMO servicio que el botón
 * de Central. Dos copias de esto se habrían separado en cuanto una de las dos
 * cambiara, y la que se quedara vieja repararía mal sin decirlo.
 */
import { reemitirJornadasAnuladas } from "../server/cash/service.ts";

const APLICAR = process.argv.includes("--aplicar");

/*
 * La fecha de un `DATE` de pg NO se saca con String().slice(0,10): eso da
 * «Thu Aug 27». Ya mordió una vez en este módulo.
 */
const fechaIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? null : String(v).slice(0, 10);

async function main(): Promise<void> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { rows } = await pool.query<any>(
    `SELECT s.id, s.empresa_id, s.register_id, s.fecha,
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

  // Una empresa por vuelta: el servicio filtra por la del contexto.
  const empresas = [...new Set(rows.map((s) => String(s.empresa_id)))];
  let total = 0;
  for (const empresaId of empresas) {
    const x = await reemitirJornadasAnuladas({ empresaId, userId: null, ip: null } as any);
    total += x.reenviadas;
  }
  console.log(`\n      ${total} reenviada(s). Central avisada.`);
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
