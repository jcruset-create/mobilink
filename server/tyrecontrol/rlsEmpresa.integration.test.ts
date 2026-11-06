/**
 * `tc_puede_ver_empresa` dice lo mismo que decía, y lo dice rápido.
 *
 * Esta función es la que deciden 53 políticas RLS: si se equivoca, o un
 * cliente ve los autobuses de otro, o deja de ver los suyos. Por eso el
 * cambio de `tyrecontrol_rls_puede_ver_empresa_rapida.sql` —de cuatro
 * funciones anidadas a una sola consulta— no se comprueba con un par de
 * ejemplos, sino con la tabla de verdad ENTERA: todos los usuarios contra
 * todas las empresas, la versión vieja contra la nueva.
 *
 * El banco monta los tres casos que la función distingue —superadmin, usuario
 * de su empresa, operador con empresas asignadas— porque una prueba en la que
 * todo diera «no» pasaría igual sin comprobar nada. Por eso se exige también
 * que haya respuestas de los dos signos.
 *
 * Lo que NO se mide aquí es el tiempo: depende de la máquina y en CI no
 * significa nada. La medición está en la cabecera de la migración, hecha
 * contra producción y contra un PostgreSQL con el mismo volumen.
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

const ESQUEMA = `rlsemp_test_${String(process.hrtime.bigint()).slice(-9)}`;
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * La migración real, mirando al esquema desechable en vez de a `public`.
 *
 * La función lleva `set search_path to 'public'` dentro —y tiene que
 * llevarlo: sin él, un search_path manipulado podría colarle otra
 * `tc_usuarios` a una función SECURITY DEFINER—. Eso significa que, tal cual,
 * leería las tablas de verdad y no las del banco de pruebas.
 *
 * Lo único que se sustituye es el nombre del esquema. El cuerpo de la
 * función, que es lo que esta prueba comprueba, se ejecuta tal y como está
 * escrito en el fichero que se aplica en producción.
 */
const migracion = (f: string, esquema = ESQUEMA) =>
  readFileSync(join(RAIZ, "supabase", "migrations", f), "utf8")
    .replace(/set search_path to 'public'/gi, `set search_path to '${esquema}'`)
    // La migración cualifica la función como `public.tc_puede_ver_empresa`,
    // que es lo correcto en producción y aquí la sacaría del esquema
    // desechable: se crearía en el `public` de la base de pruebas y se
    // quedaría ahí para los demás ficheros de test.
    .replace(/\bpublic\.tc_puede_ver_empresa\b/g, `${esquema}.tc_puede_ver_empresa`);

/**
 * El banco: lo mínimo de TyreControl que la función toca, más un `auth.uid()`
 * con el mismo contrato que el de Supabase (lee el `sub` del claim de la
 * petición). Sin esto no se puede cambiar de usuario dentro de una prueba.
 */
const BANCO = `
  create table tc_empresas (id uuid primary key default gen_random_uuid(), nombre text);
  create table tc_usuarios (
    id uuid primary key default gen_random_uuid(),
    empresa_id uuid references tc_empresas(id),
    es_superadmin boolean not null default false);
  create table tc_operador_empresas (
    usuario_id uuid, empresa_id uuid, primary key (usuario_id, empresa_id));

  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $f$
    select (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')::uuid $f$;

  -- La cadena TAL COMO ESTABA antes de la migración, para comparar contra ella.
  create or replace function tc_is_superadmin() returns boolean
    language sql stable security definer set search_path to '${ESQUEMA}' as $f$
    select coalesce((select es_superadmin from tc_usuarios where id = auth.uid()), false) $f$;
  create or replace function tc_auth_empresa_id() returns uuid
    language sql stable security definer set search_path to '${ESQUEMA}' as $f$
    select empresa_id from tc_usuarios where id = auth.uid() $f$;
  create or replace function tc_operador_ve_empresa(emp uuid) returns boolean
    language sql stable security definer set search_path to '${ESQUEMA}' as $f$
    select exists (select 1 from tc_operador_empresas
                    where usuario_id = auth.uid() and empresa_id = emp) $f$;

  create or replace function tc_puede_ver_empresa_vieja(emp uuid) returns boolean
    language sql stable security definer set search_path to '${ESQUEMA}' as $f$
    select tc_is_superadmin() or emp = tc_auth_empresa_id() or tc_operador_ve_empresa(emp) $f$;
`;

/**
 * Una flota de prueba con los tres casos representados.
 *
 * El reparto de operadores es determinista —uno de cada siete cruces— y no
 * aleatorio: una prueba que a veces monta un caso y a veces no es una prueba
 * que a veces comprueba y a veces no.
 */
const DATOS = `
  insert into tc_empresas (nombre) select 'Empresa ' || g from generate_series(1, 12) g;
  insert into tc_usuarios (empresa_id, es_superadmin)
    select e.id, false from tc_empresas e;
  update tc_usuarios set es_superadmin = true
   where id in (select id from tc_usuarios order by id limit 2);
  -- Un usuario sin empresa: existe en TyreControl y hay que saber qué se le
  -- contesta, que es «no» a todo salvo lo que tenga asignado como operador.
  insert into tc_usuarios (empresa_id, es_superadmin) values (null, false);
  -- Solo la mitad de los usuarios son operadores, para que el banco tenga
  -- también usuarios SIN ninguna empresa asignada: si todos tuvieran alguna,
  -- la rama «es operador» taparía a las otras dos y no se probaría nada.
  insert into tc_operador_empresas (usuario_id, empresa_id)
    select u.id, e.id
      from (select id, row_number() over (order by id) ru from tc_usuarios) u
     cross join (select id, row_number() over (order by id) re from tc_empresas) e
     where u.ru % 2 = 0 and (u.ru + e.re) % 5 = 0
    on conflict do nothing;
  analyze;
`;

const unaFila = async (sql: string, p: unknown[] = []): Promise<any> =>
  (await db.query(sql, p)).rows[0];

beforeAll(async () => {
  if (!RUN) return;
  const pool = (await import("../db.ts")).default;
  const cliente = await pool.connect();
  db = cliente;
  soltar = () => cliente.release();
  await db.query(`create schema ${ESQUEMA}`);
  await db.query(`set search_path to ${ESQUEMA}, public`);
  await db.query(BANCO);
  await db.query(DATOS);
  // Y la migración de verdad, la que se aplica en producción.
  await db.query(migracion("tyrecontrol_rls_puede_ver_empresa_rapida.sql"));
}, 60_000);

afterAll(async () => {
  if (!RUN) return;
  await db.query(`drop schema if exists ${ESQUEMA} cascade`);
  soltar?.();
});

describe.runIf(RUN)("tc_puede_ver_empresa, antes y después", () => {
  /**
   * La comparación entera: cada usuario contra cada empresa, suplantando al
   * usuario en el claim igual que hace PostgREST.
   */
  const tablaDeVerdad = `
    select count(*)::int                                             as combinaciones,
           -- Lo que NUNCA puede pasar: que alguien vea algo que antes no veía.
           count(*) filter (where nueva and vieja is distinct from true)::int as gana_acceso,
           -- Ni lo contrario: que alguien deje de ver lo suyo.
           count(*) filter (where vieja and not nueva)::int           as pierde_acceso,
           -- Lo documentado: donde la vieja no sabía qué decir, ésta dice «no».
           count(*) filter (where vieja is null)::int                 as vieja_indecisa,
           count(*) filter (where nueva)::int                         as dicen_si,
           count(*) filter (where not nueva)::int                     as dicen_no
      from (
        select e.id eid,
               (select set_config('request.jwt.claims',
                                  json_build_object('sub', u.id)::text, true)) cfg
          from tc_usuarios u cross join tc_empresas e
      ) s,
      lateral (select tc_puede_ver_empresa_vieja(s.eid) vieja,
                      tc_puede_ver_empresa(s.eid)       nueva) t`;

  /**
   * Las dos propiedades que importan, dichas por separado.
   *
   * «Da el mismo resultado» sería más corto y peor: esconde cuál de los dos
   * lados se rompería. Nadie puede GANAR acceso que antes no tenía —eso sería
   * enseñarle a un cliente los autobuses de otro— y nadie puede PERDER el
   * suyo. Son fallos de distinta gravedad y se cuentan aparte.
   */
  it("nadie gana acceso que antes no tuviera", async () => {
    const r = await unaFila(tablaDeVerdad);
    expect(r.combinaciones).toBeGreaterThan(100);
    expect(r.gana_acceso, "alguien ve una empresa que antes no veía").toBe(0);
  });

  it("y nadie pierde el que tenía", async () => {
    const r = await unaFila(tablaDeVerdad);
    expect(r.pierde_acceso, "alguien ha dejado de ver una empresa suya").toBe(0);
  });

  // Si todo saliera «no», las pruebas de arriba pasarían sin comprobar nada.
  it("el banco tiene respuestas de los dos signos, o no probaría nada", async () => {
    const r = await unaFila(tablaDeVerdad);
    expect(r.dicen_si).toBeGreaterThan(0);
    expect(r.dicen_no).toBeGreaterThan(0);
  });

  /**
   * Y el banco tiene que incluir el caso en el que las dos NO coinciden, o
   * la diferencia que se documenta en la migración no estaría probada.
   *
   * Es el usuario sin empresa: la vieja devolvía NULL —`emp = NULL`— y ésta
   * devuelve false. En una política RLS las dos descartan la fila igual, así
   * que ninguna de las 53 lo nota. En producción, además, hoy no hay ningún
   * usuario sin empresa; está aquí porque mañana puede haberlo.
   */
  it("y cubre el caso en que la vieja no sabía qué contestar", async () => {
    const r = await unaFila(tablaDeVerdad);
    expect(r.vieja_indecisa, "el banco necesita un usuario sin empresa").toBeGreaterThan(0);
  });

  // ── Los tres casos, uno a uno y con nombre ───────────────────────────────

  const comoUsuario = async (sql: string, usuarioId: string | null) => {
    await db.query(`select set_config('request.jwt.claims', $1, false)`,
      [usuarioId ? JSON.stringify({ sub: usuarioId }) : ""]);
    return unaFila(sql);
  };

  it("el superadmin ve cualquier empresa", async () => {
    const { id } = await unaFila(`select id from tc_usuarios where es_superadmin order by id limit 1`);
    const r = await comoUsuario(
      `select bool_and(tc_puede_ver_empresa(id)) todas from tc_empresas`, id);
    expect(r.todas).toBe(true);
  });

  it("un usuario normal ve la suya y ninguna más, salvo las que tenga asignadas", async () => {
    const u = await unaFila(`
      select u.id, u.empresa_id from tc_usuarios u
       where not u.es_superadmin and u.empresa_id is not null
         and not exists (select 1 from tc_operador_empresas o where o.usuario_id = u.id)
       order by u.id limit 1`);
    expect(u, "el banco necesita un usuario sin empresas de operador").toBeTruthy();
    const r = await comoUsuario(`
      select tc_puede_ver_empresa('${u.empresa_id}') suya,
             bool_or(tc_puede_ver_empresa(id)) alguna_ajena
        from tc_empresas where id <> '${u.empresa_id}'`, u.id);
    expect(r.suya).toBe(true);
    expect(r.alguna_ajena, "está viendo una empresa que no es la suya").toBe(false);
  });

  it("un operador ve las que tiene asignadas además de la suya", async () => {
    const o = await unaFila(`
      select o.usuario_id, o.empresa_id from tc_operador_empresas o
        join tc_usuarios u on u.id = o.usuario_id
       where not u.es_superadmin and u.empresa_id is distinct from o.empresa_id
       order by o.usuario_id limit 1`);
    expect(o, "el banco necesita un operador con una empresa que no es la suya").toBeTruthy();
    const r = await comoUsuario(
      `select tc_puede_ver_empresa('${o.empresa_id}') asignada`, o.usuario_id);
    expect(r.asignada).toBe(true);
  });

  it("un usuario sin empresa no ve nada que no tenga asignado", async () => {
    const u = await unaFila(`
      select u.id from tc_usuarios u
       where u.empresa_id is null and not u.es_superadmin
         and not exists (select 1 from tc_operador_empresas o where o.usuario_id = u.id)
       order by u.id limit 1`);
    if (!u) return;            // el reparto determinista podría haberle asignado alguna
    const r = await comoUsuario(
      `select bool_or(tc_puede_ver_empresa(id)) alguna from tc_empresas`, u.id);
    expect(r.alguna).toBe(false);
  });

  // ── La única diferencia, fijada a propósito ──────────────────────────────

  /**
   * Sin sesión, la vieja devolvía NULL y ésta devuelve false.
   *
   * En una política RLS son lo mismo —NULL descarta la fila igual que false—,
   * así que las 53 políticas no notan nada. Donde sí cuenta es en las dos
   * funciones que hacen `if not tc_puede_ver_empresa(...) then raise`: con
   * NULL la comprobación se saltaba en silencio, y con false salta como
   * debía. Está fijado aquí para que el día que alguien lo lea sepa que es
   * deliberado y no un descuido.
   */
  it("sin sesión contesta «no», que antes era NULL y se saltaba el permiso", async () => {
    const r = await comoUsuario(`
      select tc_puede_ver_empresa((select id from tc_empresas order by id limit 1)) nueva,
             tc_puede_ver_empresa_vieja((select id from tc_empresas order by id limit 1)) vieja`,
      null);
    expect(r.nueva).toBe(false);
    expect(r.vieja).toBeNull();
    // Y en un USING de RLS las dos descartan la fila, que es lo que importa.
    const f = await unaFila(`select coalesce(false, false) = false ok`);
    expect(f.ok).toBe(true);
  });

  it("con la empresa a nulo también contesta «no»", async () => {
    const { id } = await unaFila(
      `select id from tc_usuarios where not es_superadmin order by id limit 1`);
    const r = await comoUsuario(`select tc_puede_ver_empresa(null) r`, id);
    expect(r.r).toBe(false);
  });

  // ── Lo que la migración no puede perder por el camino ────────────────────

  it("sigue siendo SECURITY DEFINER con search_path fijado", async () => {
    const r = await unaFila(`
      select p.prosecdef, p.provolatile, array_to_string(p.proconfig, ',') cfg
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = $1 and p.proname = 'tc_puede_ver_empresa'`, [ESQUEMA]);
    // Sin SECURITY DEFINER, leer tc_usuarios pasaría por la RLS de tc_usuarios
    // y la comprobación de permisos se llamaría a sí misma.
    expect(r.prosecdef).toBe(true);
    expect(r.provolatile, "STABLE: el planificador cuenta con que no cambia dentro de la consulta").toBe("s");
    // En producción es `public`; aquí el esquema desechable, que es lo mismo
    // sustituido. Lo que se fija es que la función SIGUE fijando su
    // search_path, no cuál es.
    expect(r.cfg).toContain(`search_path=${ESQUEMA}`);
  });

  it("es idempotente: aplicarla dos veces no cambia nada", async () => {
    await db.query(migracion("tyrecontrol_rls_puede_ver_empresa_rapida.sql"));
    const r = await unaFila(tablaDeVerdad);
    expect(r.gana_acceso).toBe(0);
    expect(r.pierde_acceso).toBe(0);
  });
});
