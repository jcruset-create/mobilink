/**
 * `npm run satisfaction:cobertura` — ¿a cuánta gente podríamos preguntar?
 *
 * Es la consulta que 1B dejó pendiente, hecha comando. Responde a lo único que
 * decide si Satisfaction puede encenderse: si hay teléfonos, de quién son, y
 * cuántas veces el del conductor y el del cliente son el mismo.
 *
 * ── Solo lectura, y sin enseñar un teléfono ─────────────────────────────────
 *
 * Ni un UPDATE. Se cuentan filas y se miran formas —cuántos dígitos, cuántas
 * veces se repite un número—, nunca el número. Los repetidos se identifican por
 * un hash corto: sirve para decir «este mismo aparece en 40 clientes» sin que
 * el número aparezca en ningún sitio.
 *
 * Uso:
 *   DATABASE_URL=... npm run satisfaction:cobertura -- [días]
 *
 * Por defecto, 90 días.
 */

import { createHash } from "crypto";

import pool from "../server/db.ts";

const DIAS = Math.max(1, Number(process.argv[2] ?? 90));
const DESDE = Date.now() - DIAS * 86_400_000;

/** Los últimos 9 dígitos, que es como se compara un teléfono en el módulo. */
const NORMALIZA = `NULLIF(RIGHT(REGEXP_REPLACE(COALESCE($COL, ''), '\\D', '', 'g'), 9), '')`;

const pct = (parte: number, total: number) =>
  total > 0 ? `${((parte / total) * 100).toFixed(1)} %` : "—";

const huella = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 8);

async function main() {
  console.log(`\nCobertura telefónica · asistencias finalizadas de los últimos ${DIAS} días\n`);

  const base = `
    WITH fin AS (
      SELECT a.id, a."clienteFacturacionId",
             ${NORMALIZA.replace("$COL", 'r."conductorTelefono"')} AS conductor,
             ${NORMALIZA.replace("$COL", 'c."contactPhone"')}      AS cliente
        FROM roadside_assistances a
        LEFT JOIN roadside_backoffice r ON r."assistanceId" = a.id
        LEFT JOIN connect_clients c ON c.id = a."clienteFacturacionId"
       WHERE a."finishedAtMs" IS NOT NULL AND a."finishedAtMs" >= $1
    )`;

  const g = await pool.query(`${base}
    SELECT COUNT(*)::int AS finalizadas,
           COUNT(*) FILTER (WHERE conductor IS NOT NULL)::int AS con_tel_conductor,
           COUNT(*) FILTER (WHERE cliente IS NOT NULL)::int   AS con_tel_cliente,
           COUNT(*) FILTER (WHERE conductor IS NOT NULL AND cliente IS NOT NULL)::int AS con_ambos,
           COUNT(*) FILTER (WHERE conductor IS NOT NULL AND cliente IS NOT NULL
                              AND conductor = cliente)::int AS ambos_iguales,
           COUNT(*) FILTER (WHERE conductor IS NOT NULL AND cliente IS NOT NULL
                              AND conductor <> cliente)::int AS ambos_distintos,
           COUNT(*) FILTER (WHERE conductor IS NULL AND cliente IS NULL)::int AS sin_ningun_telefono
      FROM fin`, [DESDE]);
  const r = g.rows[0];
  const total = Number(r.finalizadas);

  const linea = (t: string, n: unknown) =>
    console.log(`  ${t.padEnd(28, ".")} ${String(n).padStart(7)}   ${pct(Number(n), total)}`);

  console.log("── Global ────────────────────────────────────────────────");
  console.log(`  ${"finalizadas_90d".padEnd(28, ".")} ${String(total).padStart(7)}`);
  linea("con_tel_conductor", r.con_tel_conductor);
  linea("con_tel_cliente", r.con_tel_cliente);
  linea("con_ambos", r.con_ambos);
  linea("ambos_iguales", r.ambos_iguales);
  linea("ambos_distintos", r.ambos_distintos);
  linea("sin_ningun_telefono", r.sin_ningun_telefono);

  console.log("\n── Por cliente (los 20 con más servicios) ────────────────");
  const porCliente = await pool.query(`${base}
    SELECT f."clienteFacturacionId" AS id, c.name AS nombre,
           COUNT(*)::int AS finalizadas,
           COUNT(*) FILTER (WHERE conductor IS NOT NULL)::int AS driver,
           COUNT(*) FILTER (WHERE cliente IS NOT NULL)::int AS customer,
           COUNT(*) FILTER (WHERE conductor IS NOT NULL AND conductor = cliente)::int AS iguales
      FROM fin f LEFT JOIN connect_clients c ON c.id = f."clienteFacturacionId"
     GROUP BY 1, 2 ORDER BY finalizadas DESC LIMIT 20`, [DESDE]);
  console.log(`  ${"cliente".padEnd(30)} ${"serv".padStart(6)} ${"driver".padStart(8)} ` +
    `${"cliente".padStart(9)} ${"iguales".padStart(9)}`);
  for (const f of porCliente.rows) {
    const n = Number(f.finalizadas);
    console.log(`  ${String(f.nombre ?? `#${f.id ?? "sin cliente"}`).slice(0, 30).padEnd(30)} ` +
      `${String(n).padStart(6)} ${pct(Number(f.driver), n).padStart(8)} ` +
      `${pct(Number(f.customer), n).padStart(9)} ${pct(Number(f.iguales), n).padStart(9)}`);
  }

  /* ── Calidad, no solo presencia ────────────────────────────────────────── */

  console.log("\n── Números con mala pinta ────────────────────────────────");
  const malos = await pool.query(`${base}
    SELECT
      COUNT(*) FILTER (WHERE conductor IS NOT NULL AND LENGTH(conductor) < 9)::int AS driver_corto,
      COUNT(*) FILTER (WHERE cliente   IS NOT NULL AND LENGTH(cliente)   < 9)::int AS customer_corto,
      COUNT(*) FILTER (WHERE conductor ~ '^(\\d)\\1+$')::int AS driver_repetitivo,
      COUNT(*) FILTER (WHERE cliente   ~ '^(\\d)\\1+$')::int AS customer_repetitivo,
      COUNT(*) FILTER (WHERE conductor IS NOT NULL AND LEFT(conductor,1) NOT IN ('6','7','8','9'))::int
        AS driver_prefijo_raro
      FROM fin`, [DESDE]);
  const m = malos.rows[0];
  console.log(`  conductor con menos de 9 dígitos .. ${m.driver_corto}`);
  console.log(`  cliente con menos de 9 dígitos .... ${m.customer_corto}`);
  console.log(`  conductor todo el mismo dígito .... ${m.driver_repetitivo}`);
  console.log(`  cliente todo el mismo dígito ...... ${m.customer_repetitivo}`);
  console.log(`  conductor con prefijo no español .. ${m.driver_prefijo_raro}`);

  /*
   * Un `contactPhone` genérico repetido en muchos clientes es la trampa clásica:
   * el teléfono de la centralita puesto en cincuenta fichas. Mandarle encuestas
   * sería mandárselas todas a la misma persona.
   */
  console.log("\n── Teléfonos de cliente repetidos en varias fichas ───────");
  const repes = await pool.query(
    `SELECT ${NORMALIZA.replace("$COL", '"contactPhone"')} AS tel, COUNT(*)::int AS clientes
       FROM connect_clients
      WHERE ${NORMALIZA.replace("$COL", '"contactPhone"')} IS NOT NULL
      GROUP BY 1 HAVING COUNT(*) > 1 ORDER BY clientes DESC LIMIT 10`);
  if (!repes.rows.length) console.log("  Ninguno.");
  for (const f of repes.rows) {
    console.log(`  huella ${huella(String(f.tel))} ....... en ${f.clientes} clientes`);
  }

  console.log("\nNingún teléfono se ha impreso: los repetidos van por huella.\n");
  await pool.end();
}

main().catch(async (e) => {
  console.error("No se ha podido calcular la cobertura:", (e as Error)?.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
