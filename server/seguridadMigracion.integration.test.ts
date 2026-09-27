/**
 * Pruebas de la migración de seguridad de la Fase 0, contra PostgreSQL real.
 *
 * ── Qué se prueba aquí y por qué no vale con leerlo ─────────────────────────
 *
 * Esta migración tiene tres cosas que NO se ven leyendo el SQL, y las tres
 * aparecieron probándola:
 *
 *   · `revoke ... from anon` no basta si algo se concedió a PUBLIC, porque
 *     `anon` hereda de PUBLIC. Pasó con `app_login_email`;
 *   · `create or replace function` falla si cambia el nombre de un parámetro,
 *     y el del proyecto se llama `p_accesos` y no `p_modulos`;
 *   · `set search_path = public` en una función `security definer` no protege
 *     del esquema temporal: hay que nombrar `pg_temp` explícitamente.
 *
 * Así que esto monta un esquema mínimo, carga las funciones REALES del
 * repositorio sin tocarlas, aplica la migración y comprueba comportamiento.
 *
 * Sin `RUN_DB_TESTS=1` no hace nada, igual que el resto de las de integración.
 */

import { readFileSync } from "node:fs";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CORRE = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const describeSiHayBase = CORRE ? describe : describe.skip;

const RAIZ = new URL("../", import.meta.url).pathname;
const MIGRACION = `${RAIZ}supabase/migraciones-preparadas/001_seguridad_fase0.sql`;

/** El texto de una función del repositorio, tal cual, sin reescribirla. */
function funcionDelRepo(fichero: string, nombre: string): string {
  const sql = readFileSync(`${RAIZ}supabase/migrations/${fichero}`, "utf8");
  const i = sql.indexOf(`create or replace function ${nombre}(`);
  if (i < 0) throw new Error(`No se encuentra ${nombre} en ${fichero}`);
  const j = sql.indexOf("$$;", i) + 3;
  return sql.slice(i, j);
}

const EMPRESA_A = "00000000-0000-4000-a000-000000000001";
const EMPRESA_B = "00000000-0000-4000-a000-0000000000b0";
const ADMIN_A = "00000000-0000-4000-a000-000000000009";
const SUPER = "00000000-0000-4000-a000-0000000000ff";
const DE_A = "00000000-0000-4000-a000-0000000000aa";
const DE_B = "00000000-0000-4000-a000-0000000000bb";

/*
 * El esquema mínimo. `auth.uid()` lee un parámetro de sesión para poder cambiar
 * de identidad en la prueba: vacío = backend o migración, uuid = usuario final.
 * Es lo mismo que hace Supabase con `request.jwt.claims`.
 */
const ESQUEMA = `
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select nullif(current_setting('test.uid', true), '')::uuid
$fn$;
do $r$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $r$;

create table if not exists app_empresas (id uuid primary key, nombre text);
create table if not exists app_usuarios (
  id uuid primary key, username text not null, nombre text not null,
  email_recuperacion text, telefono text, activo boolean not null default true,
  es_superadmin boolean not null default false, employee_id uuid, empresa_id uuid,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists app_usuario_modulos (
  id uuid primary key default gen_random_uuid(), user_id uuid, modulo text, rol text,
  pantallas text[], empresa_id uuid, unique (user_id, modulo));
create table if not exists adm_usuarios (id uuid primary key, rol text, activo boolean);
create table if not exists adm_payments (id serial primary key, registered_by uuid);
create table if not exists adm_recovery_actions (id serial primary key, user_id uuid);
create table if not exists adm_payment_tracking_actions (id serial primary key, user_id uuid);
create table if not exists adm_payment_tracking (id serial primary key, responsible_user uuid);
create table if not exists adm_recovery_cases (id serial primary key, responsible_user uuid);
create table if not exists adm_notificaciones (id serial primary key, created_by uuid);
create table if not exists app_licencias (id serial primary key, empresa_id uuid, modulo text,
  estado text default 'activa', fecha_inicio date default current_date, fecha_fin date, max_usuarios integer);
create table if not exists app_auditoria (id serial primary key, empresa_id uuid, user_id uuid,
  accion text, entidad text, entidad_id text, detalle jsonb, creado_en timestamptz default now());
create table if not exists tc_usuarios (id uuid primary key, empresa_id uuid, rol text, activo boolean);
create table if not exists perfiles_usuario (id uuid primary key default gen_random_uuid(),
  user_id uuid, nombre text, email text, codigo_operario text, rol text, ubicacion text,
  activo boolean default true);
create table if not exists pres_records (id serial primary key, employee_id uuid, fecha date);
create table if not exists sm_document_acknowledgements (id serial primary key, doc uuid);
create table if not exists cash_sessions (id serial primary key);
create table if not exists central_api_tokens (id serial primary key, token text);

-- Como la real: superadmin de app_usuarios O admin del módulo de administración.
create or replace function app_es_admin() returns boolean language sql stable
security definer set search_path = public as $fn$
  select coalesce((select es_superadmin from app_usuarios where id = auth.uid() and activo), false)
      or coalesce((select rol = 'admin' from adm_usuarios where id = auth.uid() and activo), false)
$fn$;
-- Como la real (saas_fase1_empresas_licencias.sql): security definer y con
-- search_path = public, que es justo lo que la migración tiene que endurecer.
create or replace function app_empresa_actual() returns uuid language sql stable
security definer set search_path = public as $fn$
  select empresa_id from app_usuarios where id = auth.uid() and activo
$fn$;
create or replace function app_licencia_activa(p_empresa uuid, p_modulo text)
  returns boolean language sql stable as $fn$ select true $fn$;
create or replace function app_login_email(p_username text) returns text language sql stable
security definer set search_path = public as $fn$
  select u.email::text from app_usuarios a join auth.users u on u.id = a.id
   where lower(a.username) = lower(trim(p_username)) and a.activo
$fn$;
grant execute on function app_login_email(text) to anon, authenticated;

-- El estado de partida que tenía el proyecto.
alter table pres_records enable row level security;
drop policy if exists "pres_anon_select" on pres_records;
create policy "pres_anon_select" on pres_records for select to anon using (true);
drop policy if exists "pres_anon_insert" on pres_records;
create policy "pres_anon_insert" on pres_records for insert to anon with check (true);
drop policy if exists "pres_anon_update" on pres_records;
create policy "pres_anon_update" on pres_records for update to anon using (true) with check (true);
grant select, insert, update on pres_records to anon;

-- perfiles_usuario, tal como esta HOY en produccion (fotografia del 2026-09-26).
-- La politica almacen_solo_autenticados que suponia la revision 1 ya no existe:
-- SEC-003 esta corregido, con cuatro politicas acotadas mas una de anon.
create or replace function usuario_actual_es_admin() returns boolean
  language sql security definer set search_path = public as $$
  select exists (select 1 from perfiles_usuario where user_id = auth.uid()
                  and activo and rol = 'admin') $$;
alter table perfiles_usuario enable row level security;
drop policy if exists perfiles_usuario_select_propio_o_admin on perfiles_usuario;
create policy perfiles_usuario_select_propio_o_admin on perfiles_usuario
  for select to authenticated using (usuario_actual_es_admin() or user_id = auth.uid());
drop policy if exists perfiles_usuario_insert_admin on perfiles_usuario;
create policy perfiles_usuario_insert_admin on perfiles_usuario
  for insert to authenticated with check (usuario_actual_es_admin());
drop policy if exists perfiles_usuario_update_admin on perfiles_usuario;
create policy perfiles_usuario_update_admin on perfiles_usuario
  for update to authenticated using (usuario_actual_es_admin()) with check (usuario_actual_es_admin());
drop policy if exists perfiles_usuario_delete_admin on perfiles_usuario;
create policy perfiles_usuario_delete_admin on perfiles_usuario
  for delete to authenticated using (usuario_actual_es_admin());
drop policy if exists anon_read_activos on perfiles_usuario;
create policy anon_read_activos on perfiles_usuario for select to anon using (activo = true);
grant select, insert, update, delete on perfiles_usuario to authenticated;
grant select on perfiles_usuario to anon;

-- La politica transversal que la revision 1 no veia: cualquier autenticado.
drop policy if exists pres_auth_all on pres_records;
create policy pres_auth_all on pres_records for all to authenticated using (true) with check (true);

-- Los acuses, con el nombre REAL de sus politicas. La revision 1 hacia drop de
-- sm_ack_anon_*, que no existe: los drop no fallaban, simplemente no hacian
-- nada. Si este stub llevara el nombre inventado, la prueba no lo habria visto.
create table if not exists sm_document_acknowledgements (
  id uuid primary key default gen_random_uuid(), employee_id uuid, document_id uuid,
  leido boolean default false, firmado boolean default false);
alter table sm_document_acknowledgements enable row level security;
drop policy if exists portal_anon_acks_select on sm_document_acknowledgements;
create policy portal_anon_acks_select on sm_document_acknowledgements for select to anon using (true);
drop policy if exists portal_anon_acks_insert on sm_document_acknowledgements;
create policy portal_anon_acks_insert on sm_document_acknowledgements for insert to anon with check (true);
drop policy if exists portal_anon_acks_update on sm_document_acknowledgements;
create policy portal_anon_acks_update on sm_document_acknowledgements for update to anon using (true) with check (true);
drop policy if exists sm_auth_all on sm_document_acknowledgements;
create policy sm_auth_all on sm_document_acknowledgements for all to authenticated using (true) with check (true);
grant select, insert, update on sm_document_acknowledgements to anon, authenticated;

-- Y una tabla concedida a PUBLIC, que es el caso que se nos colaba.
grant select on central_api_tokens to public;
`;

describeSiHayBase("Migración de seguridad de la Fase 0", () => {
  let db: Client;

  beforeAll(async () => {
    db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    await db.query(ESQUEMA);
    // Las funciones REALES del repositorio, sin una coma de diferencia.
    await db.query(funcionDelRepo("administracion_fase12_licencia_en_alta_usuario.sql", "app_guardar_usuario"));
    await db.query(funcionDelRepo("administracion_fase11_usuarios_unificados.sql", "app_eliminar_usuario"));
    await db.query(readFileSync(MIGRACION, "utf8"));

    // Datos, como los escribiría el backend: sin usuario final detrás.
    await db.query(`set test.uid = ''`);
    await db.query(
      `insert into app_usuarios (id,username,nombre,activo,es_superadmin,empresa_id) values
         ($1,'adminA','Admin A',true,false,$5),
         ($2,'super','Super',true,true,$5),
         ($3,'deA','De la A',true,false,$5),
         ($4,'deB','De la B',true,false,$6)
       on conflict (id) do nothing`,
      [ADMIN_A, SUPER, DE_A, DE_B, EMPRESA_A, EMPRESA_B]
    );
    await db.query(
      `insert into adm_usuarios (id,rol,activo) values ($1,'admin',true) on conflict (id) do nothing`,
      [ADMIN_A]
    );
  });

  afterAll(async () => {
    await db?.end();
  });

  /** Ejecuta como un usuario final concreto. */
  async function como(uid: string, sql: string, params: unknown[] = []) {
    await db.query(`set test.uid = '${uid}'`);
    return db.query(sql, params as never[]);
  }

  async function falla(uid: string, sql: string, params: unknown[] = []) {
    await expect(como(uid, sql, params)).rejects.toThrow();
  }

  describe("el punto de partida del ataque es real", () => {
    it("un admin de módulo de una empresa cliente pasa app_es_admin()", async () => {
      const r = await como(ADMIN_A, `select app_es_admin() as ok`);
      // Si esto fuera falso, SEC-004 no tendría por dónde empezar. Lo es.
      expect(r.rows[0].ok).toBe(true);
    });
  });

  describe("SEC-004 · nadie concede el superadministrador que no tiene", () => {
    it("no puede concedérselo por la RPC real", async () => {
      await falla(
        ADMIN_A,
        `select app_guardar_usuario($1::uuid,'adminA','Admin A',null,null,true,true,null,'[]'::jsonb)`,
        [ADMIN_A]
      );
    });

    it("ni escribiendo la tabla directamente, saltándose la RPC", async () => {
      // Esto es lo que aporta el disparador frente a parchear la función.
      await falla(ADMIN_A, `update app_usuarios set es_superadmin = true where id = $1`, [ADMIN_A]);
    });

    it("ni dando de alta a otro como superadministrador", async () => {
      await falla(
        ADMIN_A,
        `insert into app_usuarios (id,username,nombre,activo,es_superadmin,empresa_id)
           values (gen_random_uuid(),'colado','Colado',true,true,$1)`,
        [EMPRESA_A]
      );
    });

    it("y un superadministrador de verdad sí puede", async () => {
      const r = await como(
        SUPER,
        `select app_guardar_usuario(gen_random_uuid(),'otroSuper','Otro Super',null,null,true,true,null,'[]'::jsonb) as id`
      );
      expect(r.rows[0].id).toBeTruthy();
    });
  });

  describe("SEC-005 · a un superadministrador no lo toca quien no lo es", () => {
    it("no puede editar su ficha por la RPC real", async () => {
      await falla(
        ADMIN_A,
        `select app_guardar_usuario($1::uuid,'super','Secuestrada',null,null,true,false,null,'[]'::jsonb)`,
        [SUPER]
      );
    });

    it("no puede desactivarlo con la RPC de borrado real", async () => {
      await falla(ADMIN_A, `select app_eliminar_usuario($1::uuid)`, [SUPER]);
    });

    it("no puede borrarlo escribiendo la tabla", async () => {
      await falla(ADMIN_A, `delete from app_usuarios where id = $1`, [SUPER]);
    });
  });

  describe("aislamiento entre empresas en el borrado", () => {
    it("un admin de la empresa A no borra a un usuario de la B", async () => {
      await falla(ADMIN_A, `select app_eliminar_usuario($1::uuid)`, [DE_B]);
    });

    it("sí borra a uno de la suya, y queda apuntada la baja con su empresa", async () => {
      const r = await como(ADMIN_A, `select app_eliminar_usuario($1::uuid) as resultado`, [DE_A]);
      expect(r.rows[0].resultado).toBe("eliminado");

      const baja = await db.query(`select empresa_id, solicitado_por from app_bajas_auth where user_id = $1`, [DE_A]);
      // Esta fila es la que permite autorizar el borrado de la cuenta de Auth
      // DESPUÉS, cuando la relación usuario → empresa ya no existe.
      expect(baja.rows[0]?.empresa_id).toBe(EMPRESA_A);
      expect(baja.rows[0]?.solicitado_por).toBe(ADMIN_A);
    });

    it("y no queda apuntada ninguna baja de un usuario de otra empresa", async () => {
      const baja = await db.query(`select 1 from app_bajas_auth where user_id = $1`, [DE_B]);
      expect(baja.rowCount).toBe(0);
    });
  });

  describe("el registro de baja guarda todo lo que hay que poder comprobar después", () => {
    it("lleva instantánea del objetivo y del solicitante, caducidad e id propio", async () => {
      const r = await db.query(
        `select id, user_id, empresa_id, objetivo_es_superadmin,
                solicitado_por, solicitante_empresa_id, solicitante_nivel,
                origen, creado_en, caduca_en, consumido_en, consumido_por
           from app_bajas_auth where user_id = $1`,
        [DE_A]
      );
      const fila = r.rows[0];
      expect(fila).toBeDefined();
      expect(fila.id).toBeTruthy();
      // La empresa del OBJETIVO en el momento de autorizar: es el dato que
      // después ya no existe, y el motivo de que esta tabla exista.
      expect(fila.empresa_id).toBe(EMPRESA_A);
      expect(fila.objetivo_es_superadmin).toBe(false);
      // Quién lo pidió, con qué empresa y con qué nivel.
      expect(fila.solicitado_por).toBe(ADMIN_A);
      expect(fila.solicitante_empresa_id).toBe(EMPRESA_A);
      expect(fila.solicitante_nivel).toBe("admin_modulo");
      expect(fila.origen).toBe("app_usuarios:delete");
      // Caducidad y estado de consumo.
      expect(new Date(fila.caduca_en).getTime()).toBeGreaterThan(Date.now());
      expect(fila.consumido_en).toBeNull();
      expect(fila.consumido_por).toBeNull();
    });

    it("marca el nivel del solicitante como superadmin cuando lo es", async () => {
      const objetivo = "00000000-0000-4000-a000-0000000000dd";
      await db.query(`set test.uid = ''`);
      await db.query(
        `insert into app_usuarios (id,username,nombre,activo,es_superadmin,empresa_id)
           values ($1,'paraBorrar','Para Borrar',true,false,$2) on conflict (id) do nothing`,
        [objetivo, EMPRESA_A]
      );
      await como(SUPER, `select app_eliminar_usuario($1::uuid)`, [objetivo]);
      const r = await db.query(
        `select solicitante_nivel from app_bajas_auth where user_id = $1`,
        [objetivo]
      );
      expect(r.rows[0].solicitante_nivel).toBe("superadmin");
    });

    it("solo hay un apunte vivo por usuario: pedir la baja otra vez cierra el anterior", async () => {
      const objetivo = "00000000-0000-4000-a000-0000000000ee";
      await db.query(`set test.uid = ''`);
      await db.query(
        `insert into app_usuarios (id,username,nombre,activo,es_superadmin,empresa_id)
           values ($1,'dosVeces','Dos Veces',true,false,$2) on conflict (id) do nothing`,
        [objetivo, EMPRESA_A]
      );
      await como(ADMIN_A, `select app_eliminar_usuario($1::uuid)`, [objetivo]);
      // Se vuelve a crear y a borrar: el índice único parcial obliga a cerrar el
      // apunte anterior en vez de dejar dos vivos.
      await db.query(`set test.uid = ''`);
      await db.query(
        `insert into app_usuarios (id,username,nombre,activo,es_superadmin,empresa_id)
           values ($1,'dosVeces','Dos Veces',true,false,$2)`,
        [objetivo, EMPRESA_A]
      );
      await como(ADMIN_A, `select app_eliminar_usuario($1::uuid)`, [objetivo]);

      const vivos = await db.query(
        `select count(*)::int as n from app_bajas_auth
          where user_id = $1 and consumido_en is null`,
        [objetivo]
      );
      expect(vivos.rows[0].n).toBe(1);
      const todos = await db.query(
        `select count(*)::int as n from app_bajas_auth where user_id = $1`,
        [objetivo]
      );
      expect(todos.rows[0].n).toBe(2); // el rastro de las dos se conserva
    });

    it("la tabla no la puede leer ni anon ni authenticated", async () => {
      const r = await db.query(
        `select has_table_privilege('anon','app_bajas_auth','select') as a,
                has_table_privilege('authenticated','app_bajas_auth','select') as b`
      );
      expect(r.rows[0].a).toBe(false);
      expect(r.rows[0].b).toBe(false);
    });
  });

  describe("SEC-002 · la clave pública deja de alcanzar las tablas", () => {
    it("activa RLS en las tablas que no la tenían", async () => {
      const r = await db.query(
        `select relname, relrowsecurity from pg_class
          where relname in ('cash_sessions','central_api_tokens') order by 1`
      );
      for (const fila of r.rows) expect(fila.relrowsecurity, fila.relname).toBe(true);
    });

    it("y quita el permiso heredado de PUBLIC, no solo el de anon", async () => {
      // `central_api_tokens` estaba concedida a PUBLIC en el esquema de partida.
      // Con `revoke ... from anon` a secas, esto seguiría siendo cierto.
      const r = await db.query(
        `select has_table_privilege('anon','central_api_tokens','select') as puede`
      );
      expect(r.rows[0].puede).toBe(false);
    });
  });

  // SEC-010 salio de la Fase 0 al contrastar la migracion con produccion: el
  // `revoke` sobre `pres_records` habria dejado sin servicio `/portal/mi-ficha`,
  // que entra con la clave `anon` y no por el servidor. Estas pruebas fijan que
  // la Fase 0 ya NO lo toca, para que nadie lo vuelva a meter sin el cambio de
  // codigo que hace falta antes. El SQL corregido esta preparado y sin aplicar
  // en `003_sec010_presencia_acuses.sql`.
  describe("SEC-010 · la Fase 0 ya no toca los fichajes, y queda declarado", () => {
    it("las politicas de anon sobre pres_records siguen vivas", async () => {
      const r = await db.query(
        `select count(*)::int as n from pg_policies
          where tablename = 'pres_records' and 'anon' = any(roles)`
      );
      expect(r.rows[0].n).toBe(3);
    });

    it("y el permiso de tabla tambien, que es lo que usa el portal del empleado", async () => {
      const r = await db.query(
        `select has_table_privilege('anon','pres_records','select') as lee,
                has_table_privilege('anon','pres_records','update') as escribe`
      );
      expect(r.rows[0].lee).toBe(true);
      expect(r.rows[0].escribe).toBe(true);
    });

    it("la transversal de authenticated sigue ahi: retirar solo anon no cerraba nada", async () => {
      const r = await db.query(
        `select count(*)::int as n from pg_policies
          where tablename = 'pres_records' and policyname = 'pres_auth_all'`
      );
      expect(r.rows[0].n).toBe(1);
    });

    it("los acuses conservan el nombre REAL de sus politicas, no el que suponia la revision 1", async () => {
      const r = await db.query(
        `select count(*) filter (where policyname like 'portal_anon_acks_%')::int as reales,
                count(*) filter (where policyname like 'sm_ack_anon_%')::int as inventadas
           from pg_policies where tablename = 'sm_document_acknowledgements'`
      );
      expect(r.rows[0].reales).toBe(3);
      expect(r.rows[0].inventadas).toBe(0);
    });
  });

  // SEC-003 tambien salio: ya esta corregido en produccion con politicas
  // acotadas, y la que la revision 1 creaba las habria anulado, porque las
  // politicas permisivas se combinan con OR.
  describe("SEC-003 · la Fase 0 no degrada las politicas reales de perfiles_usuario", () => {
    it("no crea perfiles_lectura, que por OR abriria la lectura a cualquier autenticado", async () => {
      const r = await db.query(
        `select count(*)::int as n from pg_policies
          where tablename = 'perfiles_usuario' and policyname = 'perfiles_lectura'`
      );
      expect(r.rows[0].n).toBe(0);
    });

    it("y deja intactas las cuatro acotadas que ya existian", async () => {
      const r = await db.query(
        `select count(*)::int as n from pg_policies
          where tablename = 'perfiles_usuario' and policyname like 'perfiles_usuario_%'`
      );
      expect(r.rows[0].n).toBe(4);
    });

    it("anon_read_activos sigue viva: se decide aparte, no se retira a ciegas", async () => {
      const r = await db.query(
        `select count(*)::int as n from pg_policies
          where tablename = 'perfiles_usuario' and policyname = 'anon_read_activos'`
      );
      expect(r.rows[0].n).toBe(1);
    });
  });

  describe("SEC-065 · app_login_email deja de responder a la clave pública", () => {
    it("anon no puede ejecutarla, pese al grant heredado de PUBLIC", async () => {
      const r = await db.query(
        `select has_function_privilege('anon','app_login_email(text)','execute') as puede`
      );
      expect(r.rows[0].puede).toBe(false);
    });

    it("y el servidor sí, porque no pasa por esos roles", async () => {
      const r = await db.query(`select app_login_email('adminA') as email`);
      expect(r.rows[0]).toBeDefined();
    });
  });

  describe("hallazgo nuevo · search_path y el esquema temporal", () => {
    it("una función security definer con search_path = public se puede suplantar", async () => {
      // Este es el caso SIN arreglar, reproducido a propósito para dejar dicho
      // que el riesgo existe y por qué el arreglo es el que es.
      await db.query(`
        create table if not exists secreto_demo (valor text);
        delete from secreto_demo;
        insert into secreto_demo values ('real');
        create or replace function lee_demo() returns text language plpgsql
        security definer set search_path = public as $fn$
          declare v text; begin select valor into v from secreto_demo limit 1; return v; end
        $fn$;`);
      await db.query(`create temp table secreto_demo (valor text)`);
      await db.query(`insert into secreto_demo values ('SUPLANTADA')`);
      const r = await db.query(`select lee_demo() as v`);
      expect(r.rows[0].v).toBe("SUPLANTADA");
    });

    it("nombrando pg_temp explícitamente, ya no", async () => {
      await db.query(`alter function lee_demo() set search_path = public, pg_temp`);
      const r = await db.query(`select lee_demo() as v`);
      expect(r.rows[0].v).toBe("real");
      await db.query(`drop table if exists secreto_demo`); // la temporal
    });

    it("la migración endurece SOLO las funciones de las que depende la autorización", async () => {
      const r = await db.query(
        `select p.proname, p.proconfig
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('app_es_admin','app_empresa_actual','app_login_email')
          order by 1`
      );
      expect(r.rows.length).toBeGreaterThan(0);
      for (const fila of r.rows) {
        expect(String(fila.proconfig), fila.proname).toContain("pg_temp");
      }
    });
  });

  describe("la migración se puede aplicar dos veces", () => {
    it("una segunda pasada no falla", async () => {
      // Sin los `drop policy if exists`, moría con «policy already exists».
      await expect(db.query(readFileSync(MIGRACION, "utf8"))).resolves.toBeDefined();
    });
  });
});
