-- ============================================================
-- Banco desechable para tyrecontrol_parte_guiado_alta_vehiculo.sql
--
-- Aquí no hay Supabase, así que este fichero levanta a mano lo mínimo que la
-- migración toca —las tablas, la RLS de tc_vehiculos y los roles anon /
-- authenticated / service_role— y después comprueba el comportamiento.
--
-- Cómo se usa (hace falta postgresql-16 y ejecutarlo como el usuario postgres):
--
--   initdb -D /tmp/pg/data -U postgres -A trust
--   pg_ctl -D /tmp/pg/data -o "-k /tmp/pg -p 55433" -l /tmp/pg/log start
--   psql -h /tmp/pg -p 55433 -U postgres -c "create database prueba"
--   psql -h /tmp/pg -p 55433 -U postgres -d prueba \
--        -f supabase/pruebas/parte_guiado_alta_vehiculo.sql
--
-- LOS GRANTS A authenticated IMPORTAN. Sin ellos las pruebas de permisos
-- pasarían por el motivo equivocado: fallarían por privilegios de tabla en vez
-- de por la RLS, que es lo que se quiere comprobar. Supabase los da por
-- defecto; aquí hay que ponerlos.
-- ============================================================

-- Los roles son del clúster, no de la base: si ya están de una pasada
-- anterior, no es un problema.
do $$ begin
  create role authenticated;
exception when duplicate_object then null; end $$;
do $$ begin
  create role anon;
exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role;
exception when duplicate_object then null; end $$;

create schema if not exists auth;

-- Quién soy en cada prueba. Se cambia con: update auth_ctx set rol = '...'
create table auth_ctx (quien uuid, rol text);
insert into auth_ctx values ('00000000-0000-0000-0000-0000000000aa', 'operador');

create or replace function auth.uid() returns uuid language sql stable as $$ select quien from auth_ctx limit 1 $$;
create or replace function tc_is_superadmin() returns boolean language sql stable as $$ select (select rol from auth_ctx limit 1) = 'superadmin' $$;
create or replace function tc_is_admin() returns boolean language sql stable as $$ select (select rol from auth_ctx limit 1) = 'admin' $$;
create or replace function tc_auth_empresa_id() returns uuid language sql stable as $$ select '00000000-0000-0000-0000-0000000000e1'::uuid $$;
create or replace function tc_operador_ve_empresa(e uuid) returns boolean language sql stable as
  $$ select (select rol from auth_ctx limit 1) = 'operador' and e = '00000000-0000-0000-0000-0000000000e1'::uuid $$;

create table tc_empresas (id uuid primary key, nombre text);
insert into tc_empresas values ('00000000-0000-0000-0000-0000000000e1','Plana'),
                               ('00000000-0000-0000-0000-0000000000e2','Otra');
create table tc_delegaciones (id uuid primary key default gen_random_uuid());
create table tc_config_ejes (id uuid primary key default gen_random_uuid(), nombre text);
create table tc_cat_medidas_neumatico (id uuid primary key default gen_random_uuid(), valor text);

create table tc_tipos_vehiculo (
  id uuid primary key default gen_random_uuid(), nombre text not null unique,
  descripcion text, numero_ejes int not null default 2, numero_ruedas int not null default 4,
  activo boolean not null default true, configuracion_ejes text,
  created_at timestamptz not null default now());

-- Calcado de tyrecontrol_fase3.sql: las posiciones cuelgan del TIPO.
create table tc_posiciones_vehiculo (
  id uuid primary key default gen_random_uuid(),
  tipo_vehiculo_id uuid not null references tc_tipos_vehiculo(id) on delete cascade,
  codigo_posicion text not null, nombre text, eje int, lado text, interior_exterior text,
  orden_visual int not null default 0, activo boolean not null default true,
  unique (tipo_vehiculo_id, codigo_posicion));

create table tc_vehiculos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references tc_empresas(id) on delete restrict,
  delegacion_id uuid references tc_delegaciones(id) on delete set null,
  tipo_vehiculo_id uuid references tc_tipos_vehiculo(id) on delete set null,
  matricula text not null, marca text, modelo text, bastidor text,
  fecha_matriculacion date, webfleet_vehicle_id text,
  km_actual numeric not null default 0, origen_km text not null default 'manual',
  activo boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  config_ejes_id uuid references tc_config_ejes(id) on delete set null,
  medida_id uuid references tc_cat_medidas_neumatico(id) on delete set null,
  numero_unidad text,
  unique (empresa_id, matricula));

alter table tc_vehiculos enable row level security;
create policy tc_vehiculos_write on tc_vehiculos for all
  using      ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) )
  with check ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) );

-- Un tipo CON posiciones y otro SIN, para probar las dos ramas.
insert into tc_tipos_vehiculo (nombre, configuracion_ejes, numero_ejes, numero_ruedas)
  values ('Camion 3 ejes', '2x2x2', 3, 6), ('Tipo sin posiciones', '2x2', 2, 4);
insert into tc_posiciones_vehiculo (tipo_vehiculo_id, codigo_posicion, eje, lado, orden_visual)
select t.id, c.cod, c.eje, c.lado, c.orden from tc_tipos_vehiculo t,
  (values ('E1_IZQ',1,'izq',1),('E1_DER',1,'der',2),('E2_IZQ',2,'izq',3),
          ('E2_DER',2,'der',4),('E3_IZQ',3,'izq',5),('E3_DER',3,'der',6)) as c(cod,eje,lado,orden)
 where t.nombre = 'Camion 3 ejes';

\ir ../migrations/tyrecontrol_parte_guiado_alta_vehiculo.sql
-- Segunda pasada: la migración tiene que ser idempotente.
\ir ../migrations/tyrecontrol_parte_guiado_alta_vehiculo.sql

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

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
select prueba('el operador da de alta en su empresa',
  $q$ select tc_alta_vehiculo_desde_parte('00000000-0000-0000-0000-0000000000e1',' 1234abc ',
        (select id from tc_tipos_vehiculo where nombre='Camion 3 ejes')) $q$, 'ok');

do $$ begin
  if exists (select 1 from tc_vehiculos where matricula = '1234ABC')
  then raise notice 'PASA · la matricula se normaliza en mayusculas y sin espacios';
  else raise notice 'FALLA · matricula sin normalizar'; end if;
end $$;

do $$ declare v record; begin
  select * into v from tc_vehiculos where matricula='1234ABC';
  if v.pendiente_validar and v.creado_desde='tablet'
     and v.creado_por='00000000-0000-0000-0000-0000000000aa'
  then raise notice 'PASA · nace pendiente de validar, con creador y procedencia';
  else raise notice 'FALLA · pendiente=% desde=% por=%', v.pendiente_validar, v.creado_desde, v.creado_por; end if;
end $$;

do $$ declare r jsonb; begin
  r := tc_alta_vehiculo_desde_parte('00000000-0000-0000-0000-0000000000e1','1234ABC',
        (select id from tc_tipos_vehiculo where nombre='Camion 3 ejes'));
  if (r->>'ya_existia')::boolean
  then raise notice 'PASA · una matricula repetida devuelve la que ya existia, no falla';
  else raise notice 'FALLA · ya_existia = %', r->>'ya_existia'; end if;
end $$;

do $$ declare n int; begin
  select count(*) into n from tc_vehiculos where matricula='1234ABC';
  if n = 1 then raise notice 'PASA · no se duplica el vehiculo';
  else raise notice 'FALLA · hay % filas', n; end if;
end $$;

select prueba('un tipo sin posiciones se rechaza, y dice que falta generarlas',
  $q$ select tc_alta_vehiculo_desde_parte('00000000-0000-0000-0000-0000000000e1','9999ZZZ',
        (select id from tc_tipos_vehiculo where nombre='Tipo sin posiciones')) $q$,
  'no tiene posiciones generadas');

select prueba('la matricula vacia se rechaza',
  $q$ select tc_alta_vehiculo_desde_parte('00000000-0000-0000-0000-0000000000e1','   ',
        (select id from tc_tipos_vehiculo where nombre='Camion 3 ejes')) $q$, 'Hace falta la matr');

select prueba('los km negativos se rechazan',
  $q$ select tc_alta_vehiculo_desde_parte('00000000-0000-0000-0000-0000000000e1','5555KKK',
        (select id from tc_tipos_vehiculo where nombre='Camion 3 ejes'), null, null, null, -5) $q$,
  'no pueden ser negativos');

select prueba('el operador no da de alta en una empresa ajena',
  $q$ select tc_alta_vehiculo_desde_parte('00000000-0000-0000-0000-0000000000e2','7777XXX',
        (select id from tc_tipos_vehiculo where nombre='Camion 3 ejes')) $q$, 'Sin permiso');

update auth_ctx set rol = 'cliente';
select prueba('un cliente no da de alta',
  $q$ select tc_alta_vehiculo_desde_parte('00000000-0000-0000-0000-0000000000e1','8888YYY',
        (select id from tc_tipos_vehiculo where nombre='Camion 3 ejes')) $q$, 'Sin permiso');

update auth_ctx set rol = 'operador';
select prueba('el operador no valida lo que el mismo ha creado',
  $q$ select tc_validar_vehiculo((select id from tc_vehiculos where matricula='1234ABC')) $q$,
  'administrador valida veh');

update auth_ctx set rol = 'admin';
select prueba('el administrador si valida',
  $q$ select tc_validar_vehiculo((select id from tc_vehiculos where matricula='1234ABC')) $q$, 'ok');
do $$ begin
  if not (select pendiente_validar from tc_vehiculos where matricula='1234ABC')
  then raise notice 'PASA · tras validar deja de estar pendiente';
  else raise notice 'FALLA · sigue pendiente'; end if;
end $$;

-- LAS DOS QUE SOSTIENEN TODA LA PROPUESTA: la puerta sigue estrecha, y abre.
update auth_ctx set rol = 'operador';
set role authenticated;
select prueba('el operador NO puede insertar directamente en tc_vehiculos',
  $q$ insert into tc_vehiculos (empresa_id, matricula) values
      ('00000000-0000-0000-0000-0000000000e1','0000AAA') $q$, 'row-level security');
select prueba('pero SI puede por la funcion acotada',
  $q$ select tc_alta_vehiculo_desde_parte('00000000-0000-0000-0000-0000000000e1','3333BBB',
        (select id from tc_tipos_vehiculo where nombre='Camion 3 ejes')) $q$, 'ok');
reset role;
do $$ begin
  if exists (select 1 from tc_vehiculos where matricula='3333BBB' and creado_desde='tablet')
  then raise notice 'PASA · el vehiculo creado por la funcion esta ahi';
  else raise notice 'FALLA · no se ha creado 3333BBB'; end if;
end $$;
