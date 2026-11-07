/**
 * Las cinco garantías del importador, contra PostgreSQL de verdad.
 *
 * Las pruebas puras de `importar.test.ts` y `deshacer.test.ts` fijan qué
 * DECIDE el código. Esto fija qué hace la BASE, que no es lo mismo y es donde
 * de verdad se gana o se pierde la idempotencia: un `insert ... on conflict do
 * nothing` o un `delete ... where lote_id` se comportan como se comportan,
 * no como uno crea.
 *
 * Se monta el esquema de las dos migraciones REALES —los ficheros que se
 * aplican en producción— dentro de un esquema desechable, con unas tablas
 * mínimas de apoyo. Si una migración se rompe, esto se entera.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

/**
 * UNA conexión para todo el fichero, no el pool.
 *
 * `set search_path` vale para la conexión que lo ejecuta, y un pool reparte
 * conexiones distintas entre consultas: la mitad de las pruebas acababan
 * buscando las tablas en `public`, donde no están. Esto no es una manía del
 * esquema desechable; es cómo funciona `search_path`.
 */
let db: { query: (sql: string, p?: unknown[]) => Promise<any> };
let soltar: (() => void) | null = null;

const ESQUEMA = `tacografo_test_${String(process.hrtime.bigint()).slice(-9)}`;
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const migracion = (f: string) => readFileSync(join(RAIZ, "supabase", "migrations", f), "utf8");

const EMPRESA = "11111111-1111-4111-8111-111111111111";
const OTRA    = "99999999-9999-4999-8999-999999999999";

/** Lo mínimo para que las claves ajenas y las políticas resuelvan. */
const APOYO = `
  create table tc_empresas (id uuid primary key, nombre text);
  create table tc_usuarios (id uuid primary key, nombre text);
  create table tc_cat_medidas_neumatico (id uuid primary key default gen_random_uuid(), valor text unique);
  create table tc_vehiculos (id uuid primary key default gen_random_uuid(),
    empresa_id uuid references tc_empresas(id), matricula text,
    medida_id uuid references tc_cat_medidas_neumatico(id));
  create function tc_puede_ver_empresa(uuid) returns boolean language sql as $f$ select true $f$;
  create function tc_is_superadmin() returns boolean language sql as $f$ select true $f$;
  create function tc_is_admin() returns boolean language sql as $f$ select true $f$;
  create function tc_operador_ve_empresa(uuid) returns boolean language sql as $f$ select true $f$;
`;

/** Inserta una intervención como lo haría el importador. */
async function meter(lote: string, idOrigen: string, empresa = EMPRESA, fecha = "2026-01-15") {
  const { rows } = await db.query(
    `insert into tc_tacografo_intervenciones
       (empresa_id, sistema_origen, id_origen, fecha, matricula_norm, lote_id)
     values ($1, 'informe_intervenciones', $2, $3, '1234ABC', $4)
     on conflict (empresa_id, sistema_origen, id_origen) do nothing
     returning id`, [empresa, idOrigen, fecha, lote]);
  return rows.length;
}

async function crearLote(archivo = "taco.xlsx", empresa = EMPRESA): Promise<string> {
  const { rows } = await db.query(
    `insert into tc_tacografo_lotes (empresa_id, archivo_nombre) values ($1,$2) returning id`,
    [empresa, archivo]);
  return String(rows[0].id);
}

const contar = async (sql: string, p: unknown[] = []): Promise<number> =>
  Number((await db.query(sql, p)).rows[0].n);

beforeAll(async () => {
  if (!RUN) return;
  const pool = (await import("../../db.ts")).default;
  const cliente = await pool.connect();
  db = cliente;
  soltar = () => cliente.release();
  await db.query(`create schema ${ESQUEMA}`);
  await db.query(`set search_path to ${ESQUEMA}, public`);
  await db.query(APOYO);
  await db.query(migracion("tyrecontrol_tacografo.sql"));
  await db.query(migracion("tyrecontrol_tacografo_lotes.sql"));
  await db.query(`insert into tc_empresas (id, nombre) values ($1,'Plana'), ($2,'Otra')`,
    [EMPRESA, OTRA]);
}, 60_000);

afterAll(async () => {
  if (!RUN) return;
  await db.query(`drop schema if exists ${ESQUEMA} cascade`);
  soltar?.();
});

describe.runIf(RUN)("el importador contra PostgreSQL", () => {
  it("las dos migraciones se aplican sobre un esquema limpio", async () => {
    const n = await contar(
      `select count(*)::int n from information_schema.tables
        where table_schema=$1 and table_name like 'tc_tacografo%'`, [ESQUEMA]);
    expect(n).toBe(5);
  });

  /** Punto 1: lo que entra, se conserva. */
  it("lo que se mete se queda, con su lote", async () => {
    const lote = await crearLote("primero.xlsx");
    for (const id of ["A1", "A2", "A3"]) await meter(lote, id);
    expect(await contar(`select count(*)::int n from tc_tacografo_intervenciones where lote_id=$1`, [lote]))
      .toBe(3);
  });

  /** Punto 3: la misma importación otra vez no duplica NADA. */
  it("volver a pasar el mismo fichero: cero duplicados, lo dice la base", async () => {
    const lote1 = await crearLote("mismo.xlsx");
    const ids = ["B1", "B2", "B3", "B4"];
    let metidas = 0;
    for (const id of ids) metidas += await meter(lote1, id);
    expect(metidas).toBe(4);

    const lote2 = await crearLote("mismo.xlsx");
    let segunda = 0;
    for (const id of ids) segunda += await meter(lote2, id);
    expect(segunda, "la segunda pasada no ha insertado nada").toBe(0);

    expect(await contar(
      `select count(*)::int n from tc_tacografo_intervenciones where id_origen = any($1)`, [ids]))
      .toBe(4);
    // Y siguen siendo del PRIMER lote: el segundo no se las apropió.
    expect(await contar(
      `select count(*)::int n from tc_tacografo_intervenciones where lote_id=$1`, [lote1])).toBe(4);
    expect(await contar(
      `select count(*)::int n from tc_tacografo_intervenciones where lote_id=$1`, [lote2])).toBe(0);
  });

  /** Punto 4: una versión más larga del fichero solo trae lo nuevo. */
  it("un fichero ampliado solo añade lo que no estaba", async () => {
    const lote1 = await crearLote("v1.xlsx");
    for (const id of ["C1", "C2"]) await meter(lote1, id);

    const lote2 = await crearLote("v2.xlsx");
    let nuevas = 0;
    for (const id of ["C1", "C2", "C3", "C4"]) nuevas += await meter(lote2, id);
    expect(nuevas, "solo C3 y C4 son nuevas").toBe(2);

    expect(await contar(
      `select count(*)::int n from tc_tacografo_intervenciones where lote_id=$1`, [lote2])).toBe(2);
  });

  /** El mismo identificador en DOS empresas no choca: la clave lleva empresa. */
  it("dos empresas pueden tener el mismo id de intervención", async () => {
    const l1 = await crearLote("plana.xlsx", EMPRESA);
    const l2 = await crearLote("otra.xlsx", OTRA);
    expect(await meter(l1, "COMPARTIDO", EMPRESA)).toBe(1);
    expect(await meter(l2, "COMPARTIDO", OTRA)).toBe(1);
    expect(await contar(
      `select count(*)::int n from tc_tacografo_intervenciones where id_origen='COMPARTIDO'`)).toBe(2);
  });

  /** Punto 2: las de matrícula desconocida entran sin vincular. */
  it("una intervención sin vehículo se guarda igual, pendiente de vincular", async () => {
    const lote = await crearLote("pendientes.xlsx");
    await meter(lote, "SINVEH");
    const { rows } = await db.query(
      `select vehiculo_id, matricula_norm from tc_tacografo_intervenciones where id_origen='SINVEH'`);
    expect(rows[0].vehiculo_id).toBeNull();
    expect(rows[0].matricula_norm).toBe("1234ABC");
    // Y el índice parcial de pendientes las encuentra.
    expect(await contar(
      `select count(*)::int n from tc_tacografo_intervenciones
        where empresa_id=$1 and vehiculo_id is null`, [EMPRESA])).toBeGreaterThan(0);
  });

  /** Punto 5: deshacer toca SOLO su lote. */
  it("deshacer un lote no se lleva las filas de otro", async () => {
    const viejo = await crearLote("viejo.xlsx");
    const nuevo = await crearLote("nuevo.xlsx");
    for (const id of ["D1", "D2"]) await meter(viejo, id);
    for (const id of ["D3", "D4", "D5"]) await meter(nuevo, id);

    const { rowCount } = await db.query(
      `delete from tc_tacografo_intervenciones where lote_id=$1 and empresa_id=$2`,
      [nuevo, EMPRESA]);
    expect(rowCount).toBe(3);

    expect(await contar(
      `select count(*)::int n from tc_tacografo_intervenciones where lote_id=$1`, [viejo])).toBe(2);
    expect(await contar(
      `select count(*)::int n from tc_tacografo_intervenciones where lote_id=$1`, [nuevo])).toBe(0);
  });

  /**
   * Y la trampa que de verdad importa: si un segundo lote se SALTÓ filas por
   * estar ya importadas, deshacerlo no puede llevárselas, porque nunca fueron
   * suyas. Sale de cómo se graba, pero conviene que esté escrito.
   */
  it("deshacer un lote que no insertó nada no borra lo que ya estaba", async () => {
    const primero = await crearLote("uno.xlsx");
    for (const id of ["E1", "E2"]) await meter(primero, id);
    const segundo = await crearLote("dos.xlsx");
    for (const id of ["E1", "E2"]) await meter(segundo, id);   // las dos se saltan

    const { rowCount } = await db.query(
      `delete from tc_tacografo_intervenciones where lote_id=$1 and empresa_id=$2`,
      [segundo, EMPRESA]);
    expect(rowCount).toBe(0);
    expect(await contar(
      `select count(*)::int n from tc_tacografo_intervenciones where lote_id=$1`, [primero])).toBe(2);
  });

  /** Punto 5, segunda mitad: la base sabe si una fila se tocó después. */
  it("el disparador delata una modificación posterior", async () => {
    const lote = await crearLote("tocado.xlsx");
    await meter(lote, "F1");
    const antes = await db.query(
      `select importado_en, actualizado_en from tc_tacografo_intervenciones where id_origen='F1'`);
    expect(new Date(antes.rows[0].actualizado_en).getTime()
         - new Date(antes.rows[0].importado_en).getTime()).toBeLessThan(1000);

    await db.query(`select pg_sleep(1.1)`);
    await db.query(`update tc_tacografo_intervenciones set observaciones='editada' where id_origen='F1'`);

    const despues = await db.query(
      `select importado_en, actualizado_en from tc_tacografo_intervenciones where id_origen='F1'`);
    expect(new Date(despues.rows[0].actualizado_en).getTime()
         - new Date(despues.rows[0].importado_en).getTime()).toBeGreaterThan(1000);
  }, 20_000);

  it("un lote deshecho se marca, no se borra", async () => {
    const lote = await crearLote("marcado.xlsx");
    await meter(lote, "G1");
    await db.query(`delete from tc_tacografo_intervenciones where lote_id=$1`, [lote]);
    await db.query(
      `update tc_tacografo_lotes set estado='deshecho', deshecho_en=now() where id=$1`, [lote]);
    const { rows } = await db.query(
      `select estado, archivo_nombre from tc_tacografo_lotes where id=$1`, [lote]);
    expect(rows[0].estado).toBe("deshecho");
    expect(rows[0].archivo_nombre).toBe("marcado.xlsx");
  });

  it("un estado que no existe se rechaza", async () => {
    const lote = await crearLote("estado.xlsx");
    await expect(
      db.query(`update tc_tacografo_lotes set estado='cualquier_cosa' where id=$1`, [lote]),
    ).rejects.toThrow();
  });

  it("las bloqueadas guardan la fila y el motivo, no solo un recuento", async () => {
    const lote = await crearLote("bloq.xlsx");
    await db.query(
      `insert into tc_tacografo_bloqueados (lote_id, empresa_id, fila_origen, id_origen, motivo)
       values ($1,$2,42,'H1','Sin fecha')`, [lote, EMPRESA]);
    const { rows } = await db.query(
      `select fila_origen, motivo from tc_tacografo_bloqueados where lote_id=$1`, [lote]);
    expect(rows[0]).toMatchObject({ fila_origen: 42, motivo: "Sin fecha" });
  });

  /** Y lo que NO toca nada de esto: los neumáticos. */
  it("no hay ninguna clave ajena del tacógrafo hacia montajes ni neumáticos", async () => {
    const { rows } = await db.query(
      `select conname, confrelid::regclass::text destino
         from pg_constraint
        where contype='f' and connamespace=$1::regnamespace
          and conrelid::regclass::text like '%tc_tacografo%'`, [ESQUEMA]);
    const destinos = new Set<string>(
      rows.map((r: any) => String(r.destino).split(".").pop() ?? ""));
    // Se fija la PROPIEDAD, no una lista contada a mano: a dónde PUEDE
    // apuntar el tacógrafo. Si mañana alguien añade una clave ajena a
    // montajes, esto salta sin que haya que acordarse de actualizar nada.
    const PERMITIDOS = new Set([
      "tc_empresas", "tc_usuarios", "tc_vehiculos", "tc_cat_medidas_neumatico",
      "tc_tacografo_lotes", "tc_tacografo_intervenciones",
    ]);
    for (const d of destinos) {
      expect(PERMITIDOS.has(d), `clave ajena inesperada hacia ${d}`).toBe(true);
    }
    for (const prohibido of ["tc_montajes_actuales", "tc_neumaticos", "tc_vehiculo_ejes",
                             "tc_posiciones_vehiculo", "tc_config_ejes"]) {
      expect(destinos.has(prohibido), `el tacógrafo apunta a ${prohibido}`).toBe(false);
    }
    expect(destinos.size).toBeGreaterThan(3);
  });
});
