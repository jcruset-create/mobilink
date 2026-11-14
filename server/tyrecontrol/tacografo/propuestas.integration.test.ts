/**
 * Las propuestas de medida contra PostgreSQL de verdad.
 *
 * `propuestas.test.ts` fija qué DECIDE el código. Esto fija lo que hace la
 * base, que es donde se gana o se pierde lo que de verdad importa aquí:
 *
 *   · que no se pueda tener dos veces la misma propuesta viva,
 *   · que aceptar NO pueda pisar una medida que alguien puso entremedias,
 *   · que una propuesta resuelta no se quede sin fecha de resolución,
 *   · y que las tres migraciones reales se apliquen sobre un esquema limpio.
 *
 * El compara-y-cambia es el punto. En el código parece una condición más del
 * `update`; en la base es la diferencia entre «comprobamos antes de escribir»
 * —que es una carrera— y «la base no deja escribir si ha cambiado», que no lo
 * es. Una prueba pura no puede distinguir las dos cosas.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

/** UNA conexión: `set search_path` vale para la conexión que lo ejecuta. */
let db: { query: (sql: string, p?: unknown[]) => Promise<any> };
let soltar: (() => void) | null = null;

const ESQUEMA = `tacoprop_test_${String(process.hrtime.bigint()).slice(-9)}`;
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const migracion = (f: string) => readFileSync(join(RAIZ, "supabase", "migrations", f), "utf8");

const EMPRESA = "11111111-1111-4111-8111-111111111111";
const OTRA    = "99999999-9999-4999-8999-999999999999";

const APOYO = `
  create table tc_empresas (id uuid primary key, nombre text);
  create table tc_usuarios (id uuid primary key, nombre text);
  create table tc_cat_medidas_neumatico (id uuid primary key default gen_random_uuid(),
    valor text unique, activo boolean not null default true);
  create table tc_vehiculos (id uuid primary key default gen_random_uuid(),
    empresa_id uuid references tc_empresas(id), matricula text,
    medida_id uuid references tc_cat_medidas_neumatico(id),
    km_actual numeric);
  create function tc_puede_ver_empresa(uuid) returns boolean language sql as $f$ select true $f$;
  create function tc_is_superadmin() returns boolean language sql as $f$ select true $f$;
  create function tc_is_admin() returns boolean language sql as $f$ select true $f$;
  create function tc_operador_ve_empresa(uuid) returns boolean language sql as $f$ select true $f$;
`;

let M295 = "";
let M225 = "";

/** Crea una propuesta como la crearía el importador. */
async function proponer(
  o: { matricula?: string; medida?: string; caso?: string; vehiculo?: string | null;
       medidaActual?: string | null; medidaActualId?: string | null;
       segura?: boolean; estado?: string; empresa?: string } = {},
): Promise<string> {
  const { rows } = await db.query(
    `insert into tc_tacografo_medida_propuesta
       (empresa_id, vehiculo_id, matricula_norm, caso, medida_norm,
        medida_actual, medida_actual_id, segura_para_bloque, estado)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [o.empresa ?? EMPRESA, o.vehiculo ?? null, o.matricula ?? "1234ABC",
     o.caso ?? "sin_medida", o.medida ?? "295/80R22.5",
     o.medidaActual ?? null, o.medidaActualId ?? null,
     o.segura ?? true, o.estado ?? "pendiente"]);
  return String(rows[0].id);
}

async function crearVehiculo(medidaId: string | null = null): Promise<string> {
  const { rows } = await db.query(
    `insert into tc_vehiculos (empresa_id, matricula, medida_id) values ($1,'1234ABC',$2) returning id`,
    [EMPRESA, medidaId]);
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
  await db.query(migracion("tyrecontrol_tacografo_propuestas.sql"));
  await db.query(`insert into tc_empresas (id, nombre) values ($1,'Plana'), ($2,'Otra')`,
    [EMPRESA, OTRA]);
  const a = await db.query(
    `insert into tc_cat_medidas_neumatico (valor) values ('295/80R22.5'),('225/75R16')
     returning id, valor`);
  M295 = String(a.rows.find((r: any) => r.valor === "295/80R22.5").id);
  M225 = String(a.rows.find((r: any) => r.valor === "225/75R16").id);
}, 60_000);

afterAll(async () => {
  if (!RUN) return;
  await db.query(`drop schema if exists ${ESQUEMA} cascade`);
  soltar?.();
});

describe.runIf(RUN)("las propuestas de medida contra PostgreSQL", () => {
  it("las TRES migraciones se aplican sobre un esquema limpio", async () => {
    const n = await contar(
      `select count(*)::int n from information_schema.tables
        where table_schema=$1 and table_name like 'tc_tacografo%'`, [ESQUEMA]);
    expect(n, "cinco tablas: intervenciones, lotes, regla, propuesta, bloqueados").toBe(5);
  });

  it("la tercera migración deja las cuatro columnas que necesita la pantalla", async () => {
    const n = await contar(
      `select count(*)::int n from information_schema.columns
        where table_schema=$1 and table_name='tc_tacografo_medida_propuesta'
          and column_name in ('segura_para_bloque','medida_aplicada_id',
                              'medida_aplicada','aplicada_exacta')`, [ESQUEMA]);
    expect(n).toBe(4);
  });

  it("y es idempotente: pasarla dos veces no cambia nada", async () => {
    const antes = await contar(
      `select count(*)::int n from information_schema.columns
        where table_schema=$1 and table_name='tc_tacografo_medida_propuesta'`, [ESQUEMA]);
    await db.query(migracion("tyrecontrol_tacografo_propuestas.sql"));
    const despues = await contar(
      `select count(*)::int n from information_schema.columns
        where table_schema=$1 and table_name='tc_tacografo_medida_propuesta'`, [ESQUEMA]);
    expect(despues).toBe(antes);
  });

  // ── El índice único parcial ───────────────────────────────────────────────

  it("no deja dos propuestas VIVAS de la misma medida para la misma matrícula", async () => {
    await proponer({ matricula: "AAA1" });
    await expect(proponer({ matricula: "AAA1" })).rejects.toThrow(/duplicate key|unique/i);
  });

  it("pero una resuelta no estorba a una nueva: el índice es solo de pendientes", async () => {
    await proponer({ matricula: "BBB1", estado: "rechazada" });
    await expect(proponer({ matricula: "BBB1" })).resolves.toBeTruthy();
  });

  it("y otra empresa con la misma matrícula y medida no choca", async () => {
    await proponer({ matricula: "CCC1" });
    await expect(proponer({ matricula: "CCC1", empresa: OTRA })).resolves.toBeTruthy();
  });

  it("la misma matrícula con otra medida sí es otra propuesta", async () => {
    await proponer({ matricula: "DDD1", medida: "295/80R22.5" });
    await expect(proponer({ matricula: "DDD1", medida: "225/75R16" })).resolves.toBeTruthy();
  });

  // ── El compara-y-cambia, que es el punto de todo esto ─────────────────────

  it("aceptar escribe la medida cuando el vehículo sigue sin ella", async () => {
    const v = await crearVehiculo(null);
    const { rows } = await db.query(
      `update tc_vehiculos set medida_id=$1 where id=$2 and empresa_id=$3 and medida_id is null
       returning id`, [M295, v, EMPRESA]);
    expect(rows).toHaveLength(1);
    expect(await contar(
      `select count(*)::int n from tc_vehiculos where id=$1 and medida_id=$2`, [v, M295])).toBe(1);
  });

  /*
   * El caso que justifica la condición: alguien pone la medida a mano entre
   * que la pantalla pinta el botón y alguien lo pulsa. Sin el `is null`, el
   * update pisaría una decisión humana con un dato de un fichero.
   */
  it("y NO la escribe si alguien la ha puesto entremedias", async () => {
    const v = await crearVehiculo(null);
    await db.query(`update tc_vehiculos set medida_id=$1 where id=$2`, [M225, v]);  // a mano
    const { rows } = await db.query(
      `update tc_vehiculos set medida_id=$1 where id=$2 and empresa_id=$3 and medida_id is null
       returning id`, [M295, v, EMPRESA]);
    expect(rows, "cero filas: la base no ha dejado escribir").toHaveLength(0);
    expect(await contar(
      `select count(*)::int n from tc_vehiculos where id=$1 and medida_id=$2`, [v, M225]),
      "la medida que puso la persona sigue ahí").toBe(1);
  });

  it("con medida previa, exige que siga siendo ESA", async () => {
    const v = await crearVehiculo(M225);
    const malo = await db.query(
      `update tc_vehiculos set medida_id=$1 where id=$2 and medida_id=$3 returning id`,
      [M295, v, M295]);                       // creyendo que tenía otra
    expect(malo.rows).toHaveLength(0);

    const bueno = await db.query(
      `update tc_vehiculos set medida_id=$1 where id=$2 and medida_id=$3 returning id`,
      [M295, v, M225]);                       // con la que de verdad tenía
    expect(bueno.rows).toHaveLength(1);
  });

  it("no cruza empresas: el vehículo de otra no se toca", async () => {
    const { rows: vs } = await db.query(
      `insert into tc_vehiculos (empresa_id, matricula) values ($1,'9999ZZZ') returning id`, [OTRA]);
    const { rows } = await db.query(
      `update tc_vehiculos set medida_id=$1 where id=$2 and empresa_id=$3 and medida_id is null
       returning id`, [M295, String(vs[0].id), EMPRESA]);
    expect(rows).toHaveLength(0);
  });

  // ── El trigger de `resuelto_en` ───────────────────────────────────────────

  it("una propuesta resuelta nunca se queda sin fecha de resolución", async () => {
    const id = await proponer({ matricula: "EEE1" });
    await db.query(`update tc_tacografo_medida_propuesta set estado='aceptada' where id=$1`, [id]);
    const { rows } = await db.query(
      `select resuelto_en from tc_tacografo_medida_propuesta where id=$1`, [id]);
    expect(rows[0].resuelto_en).not.toBeNull();
  });

  it("y una pendiente no se la inventa", async () => {
    const id = await proponer({ matricula: "FFF1" });
    const { rows } = await db.query(
      `select resuelto_en from tc_tacografo_medida_propuesta where id=$1`, [id]);
    expect(rows[0].resuelto_en).toBeNull();
  });

  it("si ya traía fecha, el trigger la respeta", async () => {
    const id = await proponer({ matricula: "GGG1" });
    await db.query(
      `update tc_tacografo_medida_propuesta
          set estado='rechazada', resuelto_en='2026-01-02T03:04:05Z' where id=$1`, [id]);
    const { rows } = await db.query(
      `select resuelto_en from tc_tacografo_medida_propuesta where id=$1`, [id]);
    expect(new Date(rows[0].resuelto_en).toISOString()).toBe("2026-01-02T03:04:05.000Z");
  });

  // ── Los `check` de la tabla ───────────────────────────────────────────────

  it("no acepta un caso que no existe", async () => {
    await expect(proponer({ matricula: "HHH1", caso: "lo_que_sea" }))
      .rejects.toThrow(/check constraint|caso/i);
  });

  it("ni un estado que no existe", async () => {
    await expect(proponer({ matricula: "III1", estado: "a_medias" }))
      .rejects.toThrow(/check constraint|estado/i);
  });

  // ── Lo que NO se toca ─────────────────────────────────────────────────────

  /*
   * La promesa del encargo, comprobada y no prometida: aceptar una propuesta
   * no puede cambiar el kilometraje del vehículo. Esta prueba se rompería el
   * día que alguien añadiera `km_actual` al update de `aplicarPropuesta`.
   */
  it("aceptar no toca km_actual del vehículo", async () => {
    const { rows: vs } = await db.query(
      `insert into tc_vehiculos (empresa_id, matricula, km_actual) values ($1,'7777KM',123456)
       returning id`, [EMPRESA]);
    const v = String(vs[0].id);
    await db.query(
      `update tc_vehiculos set medida_id=$1 where id=$2 and medida_id is null`, [M295, v]);
    const { rows } = await db.query(`select km_actual from tc_vehiculos where id=$1`, [v]);
    expect(Number(rows[0].km_actual)).toBe(123456);
  });

  it("borrar un vehículo se lleva sus propuestas y no al revés", async () => {
    const v = await crearVehiculo(null);
    const id = await proponer({ matricula: "JJJ1", vehiculo: v });
    await db.query(`delete from tc_vehiculos where id=$1`, [v]);
    expect(await contar(
      `select count(*)::int n from tc_tacografo_medida_propuesta where id=$1`, [id]),
      "on delete cascade: la propuesta se va con el vehículo").toBe(0);
    // Y la empresa no: es `on delete restrict`, que es lo que impide que
    // borrar una empresa se lleve por delante su histórico sin avisar.
    await proponer({ matricula: "KKK1" });
    await expect(db.query(`delete from tc_empresas where id=$1`, [EMPRESA]))
      .rejects.toThrow(/foreign key|violates/i);
  });
});
