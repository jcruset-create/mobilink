\set ON_ERROR_STOP on
-- ⛔ ESTO NO ES UNA MIGRACIÓN. NO LO PEGUES EN SUPABASE.
-- Banco para tyrecontrol_rls_una_vez_por_consulta.sql: que cada perfil siga
-- viendo EXACTAMENTE lo mismo que antes, y que ahora no se pregunte por fila.
create schema if not exists auth;
create table auth.yo (uid uuid);
insert into auth.yo values (null);
create function auth.uid() returns uuid language sql stable as $$ select uid from auth.yo $$;

create table tc_usuarios (id uuid primary key, empresa_id uuid, rol text, es_superadmin boolean);
create table tc_operador_empresas (usuario_id uuid, empresa_id uuid);
create sequence llamadas;  -- cuenta las veces que se pregunta «¿superadmin?»

create function tc_is_superadmin() returns boolean language plpgsql stable security definer as $$
begin perform nextval('llamadas');
  return coalesce((select es_superadmin from tc_usuarios where id = auth.uid()), false); end $$;
-- (plpgsql con un contador: en real es sql stable, mismo resultado)
create function tc_auth_empresa_id() returns uuid language sql stable security definer as $$
  select empresa_id from tc_usuarios where id = auth.uid() $$;
create function tc_is_admin() returns boolean language sql stable security definer as $$
  select coalesce((select rol = 'administrador' from tc_usuarios where id = auth.uid()), false) $$;
create function tc_operador_ve_empresa(emp uuid) returns boolean language sql stable security definer as $$
  select exists (select 1 from tc_operador_empresas where usuario_id = auth.uid() and empresa_id = emp) $$;

create table revisiones_neumaticos_detalle (id serial, empresa_id uuid);
create table revisiones_vehiculo (id serial, empresa_id uuid);
create table tc_neumaticos (id serial, empresa_id uuid);
create table operaciones_neumaticos (id serial, empresa_id uuid);
create table tc_vehiculos (id serial, empresa_id uuid);
create table tc_montajes_actuales (id serial, empresa_id uuid);

-- Empresas A, B, C · 1000 filas por empresa en cada tabla
do $$ declare t text; begin
  foreach t in array array['revisiones_neumaticos_detalle','revisiones_vehiculo','tc_neumaticos',
                           'operaciones_neumaticos','tc_vehiculos','tc_montajes_actuales'] loop
    execute format('insert into %I (empresa_id) select (array[%L::uuid,%L::uuid,%L::uuid])[1 + g %% 3] from generate_series(1,3000) g',
      t, 'aaaaaaaa-0000-0000-0000-000000000000','bbbbbbbb-0000-0000-0000-000000000000','cccccccc-0000-0000-0000-000000000000');
    execute format('alter table %I enable row level security', t);
  end loop; end $$;

insert into tc_usuarios values
  ('00000000-0000-0000-0000-0000000000a1', null, 'administrador', true),                                -- super
  ('00000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000000', 'administrador', false), -- admin de A
  ('00000000-0000-0000-0000-0000000000a3', 'aaaaaaaa-0000-0000-0000-000000000000', 'operador', false),      -- operador de A con B asignada
  ('00000000-0000-0000-0000-0000000000a4', 'cccccccc-0000-0000-0000-000000000000', 'cliente', false);       -- cliente de C
insert into tc_operador_empresas values ('00000000-0000-0000-0000-0000000000a3','bbbbbbbb-0000-0000-0000-000000000000');

\i supabase/migrations/tyrecontrol_rls_una_vez_por_consulta.sql

do $r$ begin if exists (select 1 from pg_roles where rolname = 'probador') then execute 'drop owned by probador'; execute 'drop role probador'; end if; end $r$;
create role probador; grant select on all tables in schema public to probador; grant usage, update on sequence llamadas to probador;
grant usage on schema auth to probador; grant select on auth.yo to probador;
grant execute on all functions in schema public to probador;

create function prueba(nombre text, obtenido anyelement, espera anyelement) returns void language plpgsql as $$
begin if obtenido is not distinct from espera then raise notice 'PASA · %', nombre;
else raise notice 'FALLA · % → esperaba %, dio %', nombre, espera, obtenido; end if; end $$;

create function contar(uid uuid) returns table (t text, n bigint) language plpgsql as $$
declare tb text; begin
  update auth.yo set uid = contar.uid;
  foreach tb in array array['revisiones_neumaticos_detalle','revisiones_vehiculo','tc_neumaticos',
                            'operaciones_neumaticos','tc_vehiculos','tc_montajes_actuales'] loop
    t := tb; execute format('set local role probador; select count(*) from %I', tb) into n;
    reset role; return next; end loop; end $$;

do $$ declare r record; ok boolean;
begin
  -- superadmin ve las 3000 de cada tabla
  ok := true; for r in select * from contar('00000000-0000-0000-0000-0000000000a1') loop ok := ok and r.n = 3000; end loop;
  perform prueba('el superadmin sigue viendo todo', ok, true);
  -- admin de A: solo A (1000)
  ok := true; for r in select * from contar('00000000-0000-0000-0000-0000000000a2') loop ok := ok and r.n = 1000; end loop;
  perform prueba('el administrador de A solo ve A', ok, true);
  -- operador de A con B asignada: A + B (2000)
  ok := true; for r in select * from contar('00000000-0000-0000-0000-0000000000a3') loop ok := ok and r.n = 2000; end loop;
  perform prueba('el operador ve su empresa y la asignada, ni una más', ok, true);
  -- cliente de C: solo C
  ok := true; for r in select * from contar('00000000-0000-0000-0000-0000000000a4') loop ok := ok and r.n = 1000; end loop;
  perform prueba('el cliente solo ve su empresa', ok, true);
  -- sin sesión: nada
  ok := true; for r in select * from contar(null) loop ok := ok and r.n = 0; end loop;
  perform prueba('sin sesión no se ve nada', ok, true);
end $$;

-- Y lo que importa: cuántas veces se pregunta «¿superadmin?» en una consulta
-- de 3000 filas. Antes, una por fila (y por política). Ahora, una.
select setval('llamadas', 1, false);
update auth.yo set uid = '00000000-0000-0000-0000-0000000000a1';
set role probador;
select count(*) from revisiones_neumaticos_detalle;
reset role;
do $$ declare n int; begin
  select last_value - 1 + (case when is_called then 1 else 0 end) into n from llamadas;
  perform prueba('«¿es superadmin?» se pregunta una vez por política, no por fila (≤ 2)', n <= 2, true);
  raise notice '   (llamadas para 3000 filas: %)', n;
end $$;
