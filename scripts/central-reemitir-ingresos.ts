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
import { reemitirIngresos } from "../server/cash/bankdeposits.ts";

const APLICAR = process.argv.includes("--aplicar");
const arg = (n: string): string | null => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : null;
};
const CAJA = arg("--caja");

/*
 * La fecha de un `DATE` de pg NO se saca con String().slice(0,10): eso da
 * «Thu Aug 27». Ya mordió una vez en este módulo y la conciliación dejó de
 * casar nada en silencio.
 */
const fechaIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? null : String(v).slice(0, 10);

const eur = (c: number) =>
  new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2 }).format(c / 100);

/*
 * El trabajo lo hace `reemitirIngresos`, el MISMO servicio que el botón de
 * Central. Dos copias de esto se habrían separado en cuanto una de las dos
 * cambiara, y la que se quedara vieja repararía mal sin decirlo.
 */
async function main(): Promise<void> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { rows } = await pool.query<any>(
    `SELECT d.id, d.numero, d.estado, d.fecha_ingreso, d.importe_centimos, d.empresa_id,
            COALESCE(r.centro || ' · ', '') || r.nombre AS caja, r.id AS register_id
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

  for (const d of rows) {
    const fecha = fechaIso(d.fecha_ingreso);
    console.log(
      `  ↻ ${d.numero ?? `#${d.id}`} · ${d.caja} · ${eur(Number(d.importe_centimos))} € · ` +
        `${d.estado}${fecha ? ` · ${fecha}` : " · sin fecha"}`
    );
  }

  if (!APLICAR) return;

  // Una empresa por vuelta: el servicio filtra por la del contexto.
  const empresas = [...new Set(rows.map((d) => String(d.empresa_id)))];
  let total = 0;
  let repuestos = 0;
  for (const empresaId of empresas) {
    const registerId = CAJA ? Number(rows[0].register_id) : null;
    const r = await reemitirIngresos(
      { empresaId, userId: null, ip: null } as any,
      { registerId }
    );
    total += r.reenviados;
    repuestos += r.reposiciones;
  }
  console.log(
    `      ${total} ingreso(s) y ${repuestos} reposicion(es) del fondo reenviados. Central avisada.`
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
