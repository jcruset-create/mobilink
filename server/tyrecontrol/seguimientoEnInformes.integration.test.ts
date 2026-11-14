/**
 * El bloque que enchufa `en_seguimiento` en los informes, contra PostgreSQL.
 *
 * Esa migración no copia los doce cuerpos: los lee de la base, les aplica la
 * sustitución y los vuelve a crear. Es lo que evita duplicar 1.200 líneas,
 * pero mete un riesgo propio —un `replace` sobre algo que ya no tiene la forma
 * que se supone—, y por eso el bloque CUENTA las apariciones y se niega si no
 * cuadran.
 *
 * Aquí se prueba justo eso: que sustituye donde debe, que no toca lo que no
 * debe, que es idempotente y que **se para** cuando la función ha cambiado de
 * forma. Lo último es lo importante: una migración que se aplica a medias en
 * producción deja unos informes filtrando y otros no, y las cifras dejan de
 * cuadrar entre pantallas sin que nadie sepa por qué.
 *
 * Sin `RUN_DB_TESTS=1` no hace nada.
 */

import { readFileSync } from "node:fs";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CORRE = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const describeSiHayBase = CORRE ? describe : describe.skip;

const RAIZ = new URL("../../", import.meta.url).pathname;
const MIGRACION = `${RAIZ}supabase/migrations/tyrecontrol_sin_seguimiento_en_informes.sql`;
const ESQUEMA = "pruebas_seg_informes";

/** Solo el `do $migracion$ … $migracion$;`, sin las dos funciones del final. */
function soloElBloque(sql: string): string {
  const i = sql.indexOf("do $migracion$");
  const j = sql.indexOf("$migracion$;", i) + "$migracion$;".length;
  if (i < 0 || j <= i) throw new Error("No se encuentra el bloque");
  return sql.slice(i, j).replace(/nspname = 'public'/g, `nspname = '${ESQUEMA}'`);
}

describeSiHayBase("el bloque que filtra los informes por en_seguimiento", () => {
  let db: Client;
  let bloque: string;

  const defDe = async (n: string) => (await db.query(
    `select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
      where ns.nspname = $1 and p.proname = $2`, [ESQUEMA, n],
  )).rows[0]?.d as string | undefined;

  /** Una función de mentira con las apariciones de `v.activo` que se le pidan. */
  async function stub(nombre: string, veces: number) {
    const condiciones = Array.from({ length: veces },
      (_, i) => `(select count(*) from ${ESQUEMA}.tc_vehiculos v where v.activo) + ${i}`).join(" + ");
    await db.query(`create or replace function ${ESQUEMA}.${nombre}() returns bigint
      language sql stable as $f$ select ${condiciones}; $f$`);
  }

  beforeAll(async () => {
    db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    await db.query(`drop schema if exists ${ESQUEMA} cascade`);
    await db.query(`create schema ${ESQUEMA}`);
    await db.query(`set search_path = ${ESQUEMA}, public`);
    await db.query(`create table tc_vehiculos (
      id uuid primary key default gen_random_uuid(),
      activo boolean not null default true,
      en_seguimiento boolean not null default true)`);
    await db.query(`create table tc_planes_mantenimiento (id uuid primary key default gen_random_uuid(), vehiculo_id uuid)`);

    // Las once, con el número de apariciones que declara la migración.
    for (const [n, k] of [
      ["tc_informes_kpis", 2], ["tc_informes_economico", 2], ["tc_informes_estado_flota", 1],
      ["tc_informe_control_revisiones", 1], ["tc_informe_ejecutivo", 1], ["tc_informe_ejecutivo_base", 1],
      ["tc_informe_flota_detalle", 1], ["tc_informes_alertas", 1], ["tc_informes_ranking_vehiculos", 1],
      ["tc_revision_estado", 1], ["tc_alta_operativa_recuentos", 1],
    ] as [string, number][]) await stub(n, k);

    // Y la del join, con la forma que tiene de verdad.
    await db.query(`create or replace function ${ESQUEMA}.tc_plan_estado() returns bigint
      language sql stable as $f$
        select count(*) from ${ESQUEMA}.tc_planes_mantenimiento p
          join tc_vehiculos v on v.id = p.vehiculo_id;
      $f$`);

    bloque = soloElBloque(readFileSync(MIGRACION, "utf8"));
  }, 60_000);

  afterAll(async () => {
    if (db) { await db.query(`drop schema if exists ${ESQUEMA} cascade`); await db.end(); }
  });

  it("añade el filtro a las once, tantas veces como haga falta", async () => {
    await db.query(bloque);
    expect((await defDe("tc_informes_estado_flota"))!).toContain("v.activo and v.en_seguimiento");
    // Las dos apariciones de kpis, las dos cambiadas.
    const kpis = (await defDe("tc_informes_kpis"))!;
    expect(kpis.match(/v\.activo and v\.en_seguimiento/g)).toHaveLength(2);
    // Y ninguna se queda a medias.
    expect(kpis).not.toMatch(/v\.activo(?! and v\.en_seguimiento)/);
  });

  it("a tc_plan_estado se lo pone en el join, que es donde va", async () => {
    expect((await defDe("tc_plan_estado"))!)
      .toContain("join tc_vehiculos v on v.id = p.vehiculo_id and v.en_seguimiento");
  });

  it("pasarlo dos veces no lo duplica", async () => {
    await db.query(bloque);
    const kpis = (await defDe("tc_informes_kpis"))!;
    expect(kpis.match(/v\.activo and v\.en_seguimiento/g)).toHaveLength(2);
    expect(kpis).not.toContain("v.en_seguimiento and v.en_seguimiento");
  });

  it("las funciones siguen ejecutándose después de reescribirlas", async () => {
    await db.query(`insert into ${ESQUEMA}.tc_vehiculos (activo, en_seguimiento) values (true, true), (true, false)`);
    // Dos vehículos activos, uno sin seguimiento: tiene que contar uno.
    const r = await db.query(`select ${ESQUEMA}.tc_informes_estado_flota() as n`);
    expect(Number(r.rows[0].n)).toBe(1);
  });

  /**
   * El caso que justifica que el bloque cuente en vez de sustituir a ciegas.
   */
  it("si una función ha cambiado de forma, SE PARA y no deja nada a medias", async () => {
    await db.query(`create or replace function ${ESQUEMA}.tc_informes_alertas() returns bigint
      language sql stable as $f$ select count(*) from ${ESQUEMA}.tc_vehiculos v where v.activo; $f$`);
    // Ahora declara 1 y tiene 1… se le ponen 3 para que no cuadre.
    await stub("tc_informes_alertas", 3);
    await expect(db.query(bloque)).rejects.toThrow(/se esperaban 1 apariciones de v\.activo y hay 3/);
  });

  it("y si falta una función, también se para", async () => {
    await stub("tc_informes_alertas", 1);              // se deja como estaba
    await db.query(`drop function ${ESQUEMA}.tc_informe_ejecutivo()`);
    await expect(db.query(bloque)).rejects.toThrow(/No existe .*tc_informe_ejecutivo/);
  });
});
