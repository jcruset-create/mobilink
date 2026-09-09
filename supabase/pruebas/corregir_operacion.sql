\set ON_ERROR_STOP on
-- ⛔ ESTO NO ES UNA MIGRACIÓN. NO LO PEGUES EN SUPABASE.
--
-- Banco de pruebas desechable para un PostgreSQL vacío en local. Crea tablas
-- de mentira y REDEFINE tc_is_superadmin(), tc_is_admin() y auth.uid() como
-- funciones que devuelven valores fijos. Contra una base real eso abriría los
-- permisos de par en par.
--
-- Las migraciones que van a Supabase son las de supabase/migrations/.
do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'tc_neumaticos') then
    raise exception 'ESTE FICHERO NO ES UNA MIGRACIÓN: es el banco de pruebas '
      'desechable y esta base ya tiene TyreControl instalado. No se ha '
      'ejecutado nada. Las migraciones están en supabase/migrations/.';
  end if;
end $$;

-- ============================================================
-- Banco desechable para tyrecontrol_corregir_operacion.sql
--
--   initdb -D /tmp/pg/data -U postgres -A trust
--   pg_ctl -D /tmp/pg/data -o "-k /tmp/pg -p 55433" -l /tmp/pg/log start
--   psql -h /tmp/pg -p 55433 -U postgres -c "create database prueba"
--   psql -h /tmp/pg -p 55433 -U postgres -d prueba \
--        -f supabase/pruebas/corregir_operacion.sql
-- ============================================================

do $$ begin create role authenticated; exception when duplicate_object then null; end $$;

create schema if not exists auth;
create table auth_ctx (quien uuid, rol text);
insert into auth_ctx values ('00000000-0000-0000-0000-0000000000aa', 'operador');
create or replace function auth.uid() returns uuid language sql stable as $$ select quien from auth_ctx limit 1 $$;
create or replace function tc_is_superadmin() returns boolean language sql stable as $$ select (select rol from auth_ctx limit 1) = 'superadmin' $$;
create or replace function tc_is_admin() returns boolean language sql stable as $$ select (select rol from auth_ctx limit 1) = 'admin' $$;
create or replace function tc_auth_empresa_id() returns uuid language sql stable as $$ select '00000000-0000-0000-0000-0000000000e1'::uuid $$;

create table tc_neumaticos (
  id uuid primary key default gen_random_uuid(), empresa_id uuid,
  numero_serie text, dot text, estado text,
  updated_at timestamptz not null default now());
-- El unique de verdad: es lo que hace que dos gomas no lleven el mismo serie.
create unique index uq_tc_neu_serie on tc_neumaticos (empresa_id, numero_serie)
  where numero_serie is not null;

create table operaciones_neumaticos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null, vehiculo_id uuid, neumatico_id uuid references tc_neumaticos(id),
  tipo_operacion text, motivo text, destino text, estado_nuevo text,
  observaciones text, is_anulada boolean default false, status text default 'completada',
  tecnico_id uuid, created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());

create table tc_operacion_auditoria (
  id uuid primary key default gen_random_uuid(),
  operacion_id uuid references operaciones_neumaticos(id) on delete set null,
  accion text not null, datos_anteriores jsonb, datos_nuevos jsonb,
  realizado_por uuid default auth.uid(), motivo text,
  created_at timestamptz not null default now());

create table tc_cat_motivos (
  id uuid primary key default gen_random_uuid(), codigo text not null, nombre text not null,
  tipo_operacion text, orden int default 100, activo boolean default true,
  unique (codigo, tipo_operacion));
insert into tc_cat_motivos (codigo, nombre) values
  ('desgaste','Desgaste'), ('pinchazo','Pinchazo'), ('viejo','Ya no se usa');
update tc_cat_motivos set activo = false where codigo = 'viejo';

-- La política que la migración vigila. Aquí solo tiene que EXISTIR y no
-- mencionar operadores, que es lo que comprueba.
alter table tc_neumaticos enable row level security;
create policy tc_neu_write on tc_neumaticos for all
  using ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) )
  with check ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) );

-- Datos: una goma y dos operaciones, una del técnico y otra de otro.
insert into tc_neumaticos (id, empresa_id, numero_serie, dot)
values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e1', null, null);
insert into tc_neumaticos (id, empresa_id, numero_serie)
values ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000e1', 'YA-EXISTE');

insert into operaciones_neumaticos (id, empresa_id, neumatico_id, tipo_operacion, motivo,
                                    destino, observaciones, tecnico_id)
values ('00000000-0000-0000-0000-00000000f1aa', '00000000-0000-0000-0000-0000000000e1',
        '00000000-0000-0000-0000-000000000001', 'desmontaje', 'desgaste', 'desechado',
        'montaje [USADO]', '00000000-0000-0000-0000-0000000000aa');
insert into operaciones_neumaticos (id, empresa_id, neumatico_id, tipo_operacion, motivo, tecnico_id)
values ('00000000-0000-0000-0000-00000000f2bb', '00000000-0000-0000-0000-0000000000e1',
        '00000000-0000-0000-0000-000000000001', 'desmontaje', 'desgaste',
        '00000000-0000-0000-0000-0000000000bb');

\ir ../migrations/tyrecontrol_corregir_operacion.sql
\ir ../migrations/tyrecontrol_corregir_operacion.sql

create or replace function prueba(nombre text, sql text, espera text) returns void
language plpgsql as $$
declare msg text; begin
  begin execute sql; msg := 'ok';
  exception when others then msg := SQLERRM; end;
  if espera = 'ok' then
    if msg = 'ok' then raise notice 'PASA · %', nombre;
    else raise notice 'FALLA · % → %', nombre, msg; end if;
  else
    if msg like '%' || espera || '%' then raise notice 'PASA · %', nombre;
    else raise notice 'FALLA · % → esperaba "%", dio "%"', nombre, espera, msg; end if;
  end if;
end $$;

-- ── Las pruebas ─────────────────────────────────────────────────────────────
select prueba('sin motivo no se corrige',
  $q$ select tc_corregir_operacion('00000000-0000-0000-0000-00000000f1aa',
        '{"motivo":"pinchazo"}'::jsonb, '  ') $q$,
  'Hace falta decir por qué');

select prueba('el tecnico corrige LO SUYO',
  $q$ select tc_corregir_operacion('00000000-0000-0000-0000-00000000f1aa',
        '{"motivo":"pinchazo"}'::jsonb, 'me equivoque al elegir') $q$, 'ok');

do $$ begin
  if (select motivo from operaciones_neumaticos where id='00000000-0000-0000-0000-00000000f1aa') = 'pinchazo'
  then raise notice 'PASA · la razon queda corregida';
  else raise notice 'FALLA · motivo = %', (select motivo from operaciones_neumaticos where id='00000000-0000-0000-0000-00000000f1aa'); end if;
end $$;

do $$ declare a record; begin
  select * into a from tc_operacion_auditoria where operacion_id='00000000-0000-0000-0000-00000000f1aa' and accion='corregir';
  if a.datos_anteriores->>'motivo' = 'desgaste' and a.datos_nuevos->>'motivo' = 'pinchazo'
     and a.motivo = 'me equivoque al elegir'
  then raise notice 'PASA · queda escrito lo que habia, lo que se puso y por que';
  else raise notice 'FALLA · auditoria = % → %, motivo %', a.datos_anteriores, a.datos_nuevos, a.motivo; end if;
end $$;

select prueba('la razon tiene que estar en el catalogo',
  $q$ select tc_corregir_operacion('00000000-0000-0000-0000-00000000f1aa',
        '{"motivo":"me_lo_invento"}'::jsonb, 'probando') $q$,
  'no está en el catálogo');

select prueba('una razon dada de baja tampoco vale',
  $q$ select tc_corregir_operacion('00000000-0000-0000-0000-00000000f1aa',
        '{"motivo":"viejo"}'::jsonb, 'probando') $q$,
  'no está en el catálogo');

select prueba('el tecnico NO corrige lo de otro',
  $q$ select tc_corregir_operacion('00000000-0000-0000-0000-00000000f2bb',
        '{"motivo":"pinchazo"}'::jsonb, 'probando') $q$,
  'Solo el técnico que la hizo');

-- El número de serie, que es el caso que motivó todo esto.
do $$ declare r jsonb; begin
  r := tc_corregir_operacion('00000000-0000-0000-0000-00000000f1aa',
        '{"numero_serie":" 1944778229 ","dot":"2325"}'::jsonb, 'la IA lo leyo mal');
  if (select numero_serie from tc_neumaticos where id='00000000-0000-0000-0000-000000000001') = '1944778229'
     and (select dot from tc_neumaticos where id='00000000-0000-0000-0000-000000000001') = '2325'
  then raise notice 'PASA · el numero de serie y el DOT se corrigen en la ficha de la goma';
  else raise notice 'FALLA · serie=% dot=%',
    (select numero_serie from tc_neumaticos where id='00000000-0000-0000-0000-000000000001'),
    (select dot from tc_neumaticos where id='00000000-0000-0000-0000-000000000001'); end if;
end $$;

select prueba('un serie que ya lleva otra goma se rechaza, y se dice',
  $q$ select tc_corregir_operacion('00000000-0000-0000-0000-00000000f1aa',
        '{"numero_serie":"YA-EXISTE"}'::jsonb, 'probando') $q$,
  'ya está en otro neumático');

-- Los marcadores que lee el parte no se pueden borrar por descuido.
do $$ begin
  perform tc_corregir_operacion('00000000-0000-0000-0000-00000000f1aa',
    '{"observaciones":"se cambio por desgaste"}'::jsonb, 'redactar mejor');
  if (select observaciones from operaciones_neumaticos where id='00000000-0000-0000-0000-00000000f1aa')
     like '%[USADO]%'
  then raise notice 'PASA · el marcador [USADO] sobrevive a reescribir las observaciones';
  else raise notice 'FALLA · observaciones = %',
    (select observaciones from operaciones_neumaticos where id='00000000-0000-0000-0000-00000000f1aa'); end if;
end $$;

-- Corregir sin cambiar nada no ensucia el histórico.
do $$ declare r jsonb; n_antes int; n int; begin
  select count(*) into n_antes from tc_operacion_auditoria;
  r := tc_corregir_operacion('00000000-0000-0000-0000-00000000f1aa',
        '{"motivo":"pinchazo"}'::jsonb, 'otra vez lo mismo');
  select count(*) into n from tc_operacion_auditoria;
  if (r->>'cambiado')::boolean = false and n = n_antes
  then raise notice 'PASA · corregir sin cambiar nada no apunta nada';
  else raise notice 'FALLA · cambiado=% auditorias %→%', r->>'cambiado', n_antes, n; end if;
end $$;

-- Una anulada no se toca.
update operaciones_neumaticos set is_anulada = true where id='00000000-0000-0000-0000-00000000f2bb';
update auth_ctx set quien = '00000000-0000-0000-0000-0000000000bb';
select prueba('una operacion anulada no se corrige',
  $q$ select tc_corregir_operacion('00000000-0000-0000-0000-00000000f2bb',
        '{"motivo":"pinchazo"}'::jsonb, 'probando') $q$,
  'está anulada');

-- El administrador sí puede con la de cualquiera.
update auth_ctx set quien = '00000000-0000-0000-0000-0000000000cc', rol = 'admin';
select prueba('el administrador corrige la de cualquiera',
  $q$ select tc_corregir_operacion('00000000-0000-0000-0000-00000000f1aa',
        '{"motivo":"desgaste"}'::jsonb, 'revisado en oficina') $q$, 'ok');

-- Y un cliente no.
update auth_ctx set rol = 'cliente';
select prueba('un cliente no corrige nada',
  $q$ select tc_corregir_operacion('00000000-0000-0000-0000-00000000f1aa',
        '{"motivo":"pinchazo"}'::jsonb, 'probando') $q$,
  'Solo el técnico que la hizo');
