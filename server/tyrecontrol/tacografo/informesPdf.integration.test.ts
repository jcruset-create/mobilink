/**
 * Las dos garantías del adjunto, contra PostgreSQL de verdad.
 *
 * Las dos son de la BASE y no del código, así que una prueba pura no las
 * puede dar:
 *
 *   1 · Un vehículo puede acumular informes. `tc_vehiculo_documentos` viene
 *       de la ficha técnica con un índice único `(vehiculo_id, tipo) where
 *       vigente` —«solo uno vigente por tipo»—, y con él puesto el PRIMER
 *       informe entra y el SEGUNDO del mismo autobús revienta. Con revisión
 *       cada dos años, eso no se vería hasta dentro de dos años.
 *
 *   2 · Deshacer un lote no se lleva los PDF. La clave ajena va con
 *       `on delete set null`, así que al borrar la intervención el documento
 *       se queda —huérfano y visible— en vez de desaparecer con ella.
 *
 * Se monta el esquema de las migraciones REALES en un esquema desechable,
 * igual que `lotes.integration.test.ts`. Solo con RUN_DB_TESTS=1 y
 * DATABASE_URL a una base DESECHABLE.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

/** Una sola conexión: `set search_path` vale para la conexión que lo ejecuta. */
let db: { query: (sql: string, p?: unknown[]) => Promise<any> };
let soltar: (() => void) | null = null;

const ESQUEMA = `tacopdf_test_${String(process.hrtime.bigint()).slice(-9)}`;
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const migracion = (f: string) => readFileSync(join(RAIZ, "supabase", "migrations", f), "utf8");

const EMPRESA = "11111111-1111-4111-8111-111111111111";

/** Lo mínimo para que las claves ajenas y los `alter table` resuelvan. */
const APOYO = `
  create table tc_empresas (id uuid primary key, nombre text);
  create table tc_usuarios (id uuid primary key, nombre text);
  create table tc_cat_medidas_neumatico (id uuid primary key default gen_random_uuid(), valor text unique);
  create table tc_vehiculos (id uuid primary key default gen_random_uuid(),
    empresa_id uuid references tc_empresas(id), matricula text,
    medida_id uuid references tc_cat_medidas_neumatico(id));
  create table tc_vehiculo_ejes (id uuid primary key default gen_random_uuid(),
    vehiculo_id uuid references tc_vehiculos(id));
  create function tc_puede_ver_empresa(uuid) returns boolean language sql as $f$ select true $f$;
  create function tc_is_superadmin() returns boolean language sql as $f$ select true $f$;
  create function tc_is_admin() returns boolean language sql as $f$ select true $f$;
  create function tc_operador_ve_empresa(uuid) returns boolean language sql as $f$ select true $f$;
`;

let vehiculoA = "";
let vehiculoB = "";

async function crearVehiculo(matricula: string): Promise<string> {
  const { rows } = await db.query(
    `insert into tc_vehiculos (empresa_id, matricula) values ($1,$2) returning id`,
    [EMPRESA, matricula]);
  return String(rows[0].id);
}

/** Una intervención, como la mete el importador o el lector del PDF. */
async function crearIntervencion(idOrigen: string, vehiculo: string, dePdf = false): Promise<string> {
  const { rows } = await db.query(
    `insert into tc_tacografo_intervenciones
       (empresa_id, sistema_origen, id_origen, fecha, matricula_norm, vehiculo_id, creada_de_pdf)
     values ($1, 'informe_intervenciones', $2, '2026-11-07', '1234ABC', $3, $4)
     returning id`, [EMPRESA, idOrigen, vehiculo, dePdf]);
  return String(rows[0].id);
}

/** El PDF adjunto, como lo graba la ruta de subida. */
async function adjuntar(vehiculo: string | null, intervencion: string | null, ruta: string): Promise<string> {
  const { rows } = await db.query(
    `insert into tc_vehiculo_documentos
       (vehiculo_id, empresa_id, tipo, storage_path, nombre_original, mime_type,
        hash_sha256, intervencion_id)
     values ($1, $2, 'informe_tacografo', $3, 'InfTec.pdf', 'application/pdf', $4, $5)
     returning id`, [vehiculo, EMPRESA, ruta, `sha-${ruta}`, intervencion]);
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
  // El rol y `auth.uid()` que las migraciones de producción dan por hechos.
  await db.query(`do $$ begin
    if not exists (select 1 from pg_roles where rolname='authenticated')
      then create role authenticated; end if;
  end $$;`);
  await db.query(`create schema if not exists auth;
    create or replace function auth.uid() returns uuid language sql as $f$ select null::uuid $f$;`);
  // La migración de la ficha técnica da de alta su bucket privado. Aquí no
  // hay Storage, pero la tabla tiene que existir para que el insert pase.
  await db.query(`create schema if not exists storage;
    create table if not exists storage.buckets (id text primary key, name text, public boolean);`);
  await db.query(migracion("tyrecontrol_ficha_tecnica.sql"));
  await db.query(migracion("tyrecontrol_tacografo.sql"));
  await db.query(migracion("tyrecontrol_tacografo_lotes.sql"));
  await db.query(migracion("tyrecontrol_tacografo_informes_pdf.sql"));
  await db.query(migracion("tyrecontrol_documentos_sin_vehiculo.sql"));
  await db.query(`insert into tc_empresas (id, nombre) values ($1,'Plana')`, [EMPRESA]);
  vehiculoA = await crearVehiculo("8235JDF");
  vehiculoB = await crearVehiculo("9204HMM");
}, 60_000);

afterAll(async () => {
  if (!RUN) return;
  await db.query(`drop schema if exists ${ESQUEMA} cascade`);
  soltar?.();
});

describe.runIf(RUN)("los informes en PDF contra PostgreSQL", () => {
  it("la migración se aplica sobre el esquema de producción", async () => {
    expect(await contar(
      `select count(*)::int n from information_schema.columns
        where table_schema=$1 and table_name='tc_vehiculo_documentos'
          and column_name='intervencion_id'`, [ESQUEMA])).toBe(1);
    expect(await contar(
      `select count(*)::int n from information_schema.columns
        where table_schema=$1 and table_name='tc_tacografo_intervenciones'
          and column_name='creada_de_pdf'`, [ESQUEMA])).toBe(1);
  });

  /*
   * Garantía 1. Dos informes del mismo autobús, que es lo normal: una
   * revisión cada dos años y el histórico entero adjunto.
   */
  it("un vehículo puede acumular informes: el segundo NO choca con el primero", async () => {
    const i1 = await crearIntervencion("PDF-1", vehiculoA);
    const i2 = await crearIntervencion("PDF-2", vehiculoA);
    await adjuntar(vehiculoA, i1, "a/1.pdf");
    await adjuntar(vehiculoA, i2, "a/2.pdf");
    expect(await contar(
      `select count(*)::int n from tc_vehiculo_documentos
        where vehiculo_id=$1 and tipo='informe_tacografo'`, [vehiculoA])).toBe(2);
  });

  // Y la regla de la ficha técnica sigue en pie: de esa solo hay una vigente.
  it("pero de la ficha técnica sigue habiendo una sola vigente", async () => {
    await db.query(
      `insert into tc_vehiculo_documentos (vehiculo_id, empresa_id, tipo, storage_path)
       values ($1,$2,'ficha_tecnica','a/ficha.pdf')`, [vehiculoA, EMPRESA]);
    await expect(db.query(
      `insert into tc_vehiculo_documentos (vehiculo_id, empresa_id, tipo, storage_path)
       values ($1,$2,'ficha_tecnica','a/ficha2.pdf')`, [vehiculoA, EMPRESA]))
      .rejects.toThrow(/duplicate key|idx_veh_doc_vigente/i);
  });

  /*
   * Garantía 2. Deshacer un lote borra intervenciones. El PDF que subió una
   * persona no se va con ellas: se queda, y la ficha del vehículo lo sigue
   * enseñando aunque ya no cuelgue de ninguna intervención.
   */
  it("borrar la intervención NO borra el PDF: se queda huérfano y visible", async () => {
    const interv = await crearIntervencion("PDF-3", vehiculoB, true);
    const doc = await adjuntar(vehiculoB, interv, "b/3.pdf");

    await db.query(`delete from tc_tacografo_intervenciones where id=$1`, [interv]);

    expect(await contar(`select count(*)::int n from tc_vehiculo_documentos where id=$1`, [doc]))
      .toBe(1);
    const { rows } = await db.query(
      `select intervencion_id from tc_vehiculo_documentos where id=$1`, [doc]);
    expect(rows[0].intervencion_id).toBeNull();
  });

  /*
   * Y la razón de ser de `creada_de_pdf`: la clave única sigue siendo
   * `(empresa, sistema_origen, id_origen)`, así que el Excel del mes que
   * viene NO puede duplicar la intervención que creó un PDF. Si llevara un
   * `sistema_origen` propio, entrarían las dos.
   */
  it("el Excel no puede duplicar lo que creó un PDF: la clave única es la misma", async () => {
    await crearIntervencion("PDF-4", vehiculoA, true);
    const { rowCount } = await db.query(
      `insert into tc_tacografo_intervenciones
         (empresa_id, sistema_origen, id_origen, fecha, matricula_norm)
       values ($1, 'informe_intervenciones', 'PDF-4', '2026-11-08', '1234ABC')
       on conflict (empresa_id, sistema_origen, id_origen) do nothing`, [EMPRESA]);
    expect(rowCount).toBe(0);
    expect(await contar(
      `select count(*)::int n from tc_tacografo_intervenciones where id_origen='PDF-4'`)).toBe(1);
  });

  /*
   * Un informe puede llegar antes que el alta del autobús: lo manda el centro
   * técnico de un vehículo que todavía no está en TyreControl. El papel se
   * guarda igual, colgando de su intervención, en vez de tirarse.
   */
  it("un documento puede existir sin vehículo", async () => {
    const { rows } = await db.query(
      `insert into tc_tacografo_intervenciones
         (empresa_id, sistema_origen, id_origen, fecha, matricula_norm, creada_de_pdf)
       values ($1, 'informe_intervenciones', 'PDF-SIN-VEH', '2026-11-07', '0000XXX', true)
       returning id`, [EMPRESA]);
    const interv = String(rows[0].id);
    const doc = await adjuntar(null, interv, "sin-vehiculo/1.pdf");
    expect(await contar(
      `select count(*)::int n from tc_vehiculo_documentos where id=$1 and vehiculo_id is null`,
      [doc])).toBe(1);
  });

  // Y dos de ellos no chocan entre sí: un índice único trata cada NULL como
  // distinto, así que la regla de «uno vigente por vehículo y tipo» no les
  // aplica.
  it("y dos sin vehículo tampoco chocan entre sí", async () => {
    await db.query(
      `insert into tc_vehiculo_documentos (vehiculo_id, empresa_id, tipo, storage_path)
       values (null,$1,'ficha_tecnica','x/1.pdf'), (null,$1,'ficha_tecnica','x/2.pdf')`, [EMPRESA]);
    expect(await contar(
      `select count(*)::int n from tc_vehiculo_documentos
        where vehiculo_id is null and tipo='ficha_tecnica'`)).toBe(2);
  });
});
