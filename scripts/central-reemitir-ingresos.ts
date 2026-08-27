/**
 * Reenvía a MC Central los ingresos bancarios que ya existen en la caja.
 *
 * ── Por qué hace falta ────────────────────────────────────────────────────
 *
 * Central se alimenta SOLO de eventos. Un ingreso creado antes de que Central
 * existiera —o mientras su cola estuvo parada— nunca emitió `BANK_DEPOSIT_
 * CREATED`, así que para Central no existe, o existe a medias: sin fecha, sin
 * estado, o sin aparecer en la lista aunque en la caja esté ahí.
 *
 * Esto NO cambia ni un dato de la caja. Solo vuelve a contar lo que la caja ya
 * dice, para que las dos digan lo mismo.
 *
 *   npx tsx scripts/central-reemitir-ingresos.ts                    # mirar todo
 *   npx tsx scripts/central-reemitir-ingresos.ts --caja TAR1        # una caja
 *   npx tsx scripts/central-reemitir-ingresos.ts --aplicar          # hacerlo
 *
 * Por defecto NO cambia nada: enseña lo que haría.
 *
 * Reemite también los ANULADOS, y en dos pasos —creado y luego anulado— porque
 * es como ocurrieron: la proyección de Central da de alta con el primero y
 * marca con el segundo. Mandar solo el segundo dejaría una fila que no existe.
 */

import pool from "../server/db.ts";
import { emitirEvento } from "../server/cash/events/emitter.ts";

const APLICAR = process.argv.includes("--aplicar");
const arg = (n: string): string | null => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : null;
};
const CAJA = arg("--caja");

const eur = (c: number) =>
  new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2 }).format(c / 100);

/** La fecha de un `DATE` de pg, sin pasar por `String()`, que da «Fri May 03». */
const fechaIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? null : String(v).slice(0, 10);

async function main(): Promise<void> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { rows } = await pool.query(
    `SELECT d.id, d.empresa_id, d.register_id, d.numero, d.estado,
            d.fecha_ingreso, d.referencia, d.importe_centimos,
            d.total_cierres_centimos, d.remanente_anterior_centimos,
            d.remanente_nuevo_centimos, d.anulado_motivo, d.creado_at_ms,
            r.centro_id, COALESCE(r.centro || ' · ', '') || r.nombre AS caja
       FROM cash_bank_deposits d
       JOIN cash_registers r ON r.id = d.register_id
      ${CAJA ? "WHERE r.codigo = $1" : ""}
      ORDER BY d.id`,
    CAJA ? [CAJA] : []
  );

  if (rows.length === 0) {
    console.log("No hay ningún ingreso con ese criterio.");
    return;
  }
  console.log(APLICAR ? "" : "── SIMULACIÓN, no se cambia nada ──");

  for (const d of rows as any[]) {
    const fecha = fechaIso(d.fecha_ingreso);
    console.log(
      `  ↻ ${d.numero ?? `#${d.id}`} · ${d.caja} · ${eur(Number(d.importe_centimos))} € · ` +
        `${d.estado}${fecha ? ` · ${fecha}` : " · sin fecha"}`
    );
    if (APLICAR) await reenviar(d, fecha);
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
async function reenviar(d: any, fecha: string | null): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const comun = {
      empresaId: d.empresa_id as string,
      centroId: (d.centro_id ?? null) as string | null,
      registerId: Number(d.register_id),
      agregado: { tipo: "REGISTER" as const, id: Number(d.register_id) },
      actorUserId: null,
    };

    await emitirEvento(client, {
      ...comun,
      tipo: "BANK_DEPOSIT_CREATED",
      ocurridoEnMs: Number(d.creado_at_ms ?? Date.now()),
      datos: {
        depositId: Number(d.id),
        numero: d.numero ?? null,
        importeCentimos: Number(d.importe_centimos),
        totalCierresCentimos: Number(d.total_cierres_centimos ?? 0),
        remanenteAnteriorCentimos: Number(d.remanente_anterior_centimos ?? 0),
        remanenteNuevoCentimos: Number(d.remanente_nuevo_centimos ?? 0),
        referencia: d.referencia ?? null,
        fecha,
      },
    });

    // Y si estaba anulado, el segundo hecho. En este orden: el alta primero.
    if (d.estado === "ANULADO") {
      await emitirEvento(client, {
        ...comun,
        tipo: "BANK_DEPOSIT_VOIDED",
        ocurridoEnMs: Date.now(),
        datos: {
          depositId: Number(d.id),
          importeCentimos: Number(d.importe_centimos),
          motivo: d.anulado_motivo ?? null,
        },
      });
    }

    await client.query("COMMIT");
    console.log("      Central avisada.");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
