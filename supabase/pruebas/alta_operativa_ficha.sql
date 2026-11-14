\set ON_ERROR_STOP on
-- ⛔ ESTO NO ES UNA MIGRACIÓN. NO LO PEGUES EN SUPABASE.
-- Banco desechable: crea tablas de mentira y REDEFINE las funciones de
-- permisos. Las migraciones están en supabase/migrations/.
do $$ begin
  if exists (select 1 from pg_tables where schemaname='public' and tablename='tc_vehiculos') then
    raise exception 'ESTE FICHERO NO ES UNA MIGRACIÓN: banco desechable y esta base ya tiene TyreControl.';
  end if;
end $$;

-- ============================================================
-- Banco para tyrecontrol_alta_operativa_ficha.sql
--
-- Lo que importa aquí, por encima de que guarde: que NO se convierta en una
-- puerta ancha. Delega en tc_alta_operativa_tipo, así que tiene que heredar
-- sus permisos y su regla de los montajes; y no debe borrar lo que no se le
-- pregunta ni aceptar catálogo inventado.
-- ============================================================

do $$ begin create role authenticated; exception when duplicate_object then null; end $$;

create table auth_ctx (rol text);
insert into auth_ctx values ('operador');
create or replace function tc_is_superadmin() returns boolean language sql stable as
  $$ select (select rol from auth_ctx limit 1) = 'superadmin' $$;
create or replace function tc_is_admin() returns boolean language sql stable as
  $$ select (select rol from auth_ctx limit 1) = 'admin' $$;
create or replace function tc_auth_empresa_id() returns uuid language sql stable as
  $$ select '00000000-0000-0000-0000-0000000000e1'::uuid $$;
create or replace function tc_operador_ve_empresa(e uuid) returns boolean language sql stable as
  $$ select (select rol from auth_ctx limit 1) = 'operador'
            and e = '00000000-0000-0000-0000-0000000000e1'::uuid $$;

create table tc_empresas (id uuid primary key, nombre text);
insert into tc_empresas values ('00000000-0000-0000-0000-0000000000e1','Plana'),
                               ('00000000-0000-0000-0000-0000000000e2','Otra');
create table tc_config_ejes (id uuid primary key default gen_random_uuid(),
  nombre text not null unique, activo boolean not null default true);
insert into tc_config_ejes (nombre) values ('2x2x4'), ('2x2x2');
create table tc_tipos_vehiculo (id uuid primary key default gen_random_uuid(),
  nombre text, descripcion text, configuracion_ejes text, activo boolean not null default true);
create table tc_cat_medidas_neumatico (id uuid primary key default gen_random_uuid(),
  valor text not null unique, activo boolean not null default true);
create table tc_tipos_llanta (id uuid primary key default gen_random_uuid(),
  material text not null, medida text not null, activo boolean not null default true);
create table tc_vehiculos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references tc_empresas(id),
  matricula text not null, tipo_vehiculo_id uuid references tc_tipos_vehiculo(id),
  config_ejes_id uuid references tc_config_ejes(id),
  medida_id uuid references tc_cat_medidas_neumatico(id),
  tipo_llanta_id uuid references tc_tipos_llanta(id),
  marca text, modelo text, pendiente_validar boolean not null default true,
  activo boolean not null default true, updated_at timestamptz not null default now());
create table tc_posiciones_vehiculo (id uuid primary key default gen_random_uuid(),
  tipo_vehiculo_id uuid not null references tc_tipos_vehiculo(id),
  codigo_posicion text, activo boolean not null default true);
create table tc_montajes_actuales (id uuid primary key default gen_random_uuid(),
  vehiculo_id uuid not null references tc_vehiculos(id),
  posicion_id uuid not null references tc_posiciones_vehiculo(id));

\ir ../migrations/tyrecontrol_alta_operativa_tipo.sql
\ir ../migrations/tyrecontrol_alta_operativa_ficha.sql
-- Segunda pasada: la migración tiene que ser idempotente.
\ir ../migrations/tyrecontrol_alta_operativa_ficha.sql

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

insert into tc_tipos_vehiculo (id, nombre, configuracion_ejes) values
  ('00000000-0000-0000-0000-0000000000f1','tractora_3_ejes','2x2x4'),
  ('00000000-0000-0000-0000-0000000000f2','semirremolque','2x2x2'),
  ('00000000-0000-0000-0000-0000000000f3','sin-plano','2x2');
insert into tc_posiciones_vehiculo (tipo_vehiculo_id, codigo_posicion)
select '00000000-0000-0000-0000-0000000000f1','P'||g from generate_series(1,8) g;
insert into tc_posiciones_vehiculo (tipo_vehiculo_id, codigo_posicion)
select '00000000-0000-0000-0000-0000000000f2','Q'||g from generate_series(1,6) g;
insert into tc_cat_medidas_neumatico (id, valor) values
  ('00000000-0000-0000-0000-0000000000a1','315/80R22.5'),
  ('00000000-0000-0000-0000-0000000000a2','295/80R22.5'),
  ('00000000-0000-0000-0000-0000000000a3','11R22.5');
update tc_cat_medidas_neumatico set activo = false where id='00000000-0000-0000-0000-0000000000a3';
insert into tc_tipos_llanta (id, material, medida) values
  ('00000000-0000-0000-0000-0000000000b1','acero','22.5x11.75'),
  ('00000000-0000-0000-0000-0000000000b2','aluminio','22.5x9.00');

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

create or replace function nuevo(mat text, emp text default '00000000-0000-0000-0000-0000000000e1')
returns uuid language plpgsql as $$
declare v uuid; begin
  insert into tc_vehiculos (empresa_id, matricula) values (emp::uuid, mat) returning id into v;
  return v;
end $$;

-- ── Lo que tiene que hacer ──────────────────────────────────────────────────
do $$ declare v uuid; r jsonb; begin
  v := nuevo('0001AAA');
  r := tc_alta_operativa_ficha(v, '00000000-0000-0000-0000-0000000000f1',
                               '00000000-0000-0000-0000-0000000000a1',
                               '00000000-0000-0000-0000-0000000000b1');
  if (select tipo_vehiculo_id from tc_vehiculos where id=v) = '00000000-0000-0000-0000-0000000000f1'
     and (select medida_id from tc_vehiculos where id=v) = '00000000-0000-0000-0000-0000000000a1'
     and (select tipo_llanta_id from tc_vehiculos where id=v) = '00000000-0000-0000-0000-0000000000b1'
  then raise notice 'PASA · guarda tipo, medida y llanta de una vez';
  else raise notice 'FALLA · %', r; end if;

  if r->>'medida' = '315/80R22.5' and r->>'llanta' = 'acero 22.5x11.75'
     and (r->>'posiciones')::int = 8 and r->>'configuracion_ejes' = '2x2x4'
  then raise notice 'PASA · devuelve lo que ha quedado en la ficha, no lo que le mandaron';
  else raise notice 'FALLA · %', r; end if;

  if (select config_ejes_id from tc_vehiculos where id=v)
     = (select id from tc_config_ejes where nombre='2x2x4')
  then raise notice 'PASA · hereda el enlace de la configuración de ejes por nombre';
  else raise notice 'FALLA · config_ejes_id no enlazado'; end if;
end $$;

-- ── No borra lo que no se le pregunta ───────────────────────────────────────
do $$ declare v uuid; begin
  v := nuevo('0002BBB');
  perform tc_alta_operativa_ficha(v, '00000000-0000-0000-0000-0000000000f1',
                                  '00000000-0000-0000-0000-0000000000a1',
                                  '00000000-0000-0000-0000-0000000000b1');
  -- Reconfirmar el tipo sin mandar medida ni llanta: lo de antes se queda.
  perform tc_alta_operativa_ficha(v, '00000000-0000-0000-0000-0000000000f1');
  if (select medida_id from tc_vehiculos where id=v) = '00000000-0000-0000-0000-0000000000a1'
     and (select tipo_llanta_id from tc_vehiculos where id=v) = '00000000-0000-0000-0000-0000000000b1'
  then raise notice 'PASA · un parámetro en null no vacía la ficha';
  else raise notice 'FALLA · ha borrado medida o llanta'; end if;

  -- Corregir SOLO la medida no debe tocar la llanta.
  perform tc_alta_operativa_ficha(v, '00000000-0000-0000-0000-0000000000f1',
                                  '00000000-0000-0000-0000-0000000000a2', null);
  if (select medida_id from tc_vehiculos where id=v) = '00000000-0000-0000-0000-0000000000a2'
     and (select tipo_llanta_id from tc_vehiculos where id=v) = '00000000-0000-0000-0000-0000000000b1'
  then raise notice 'PASA · se puede corregir solo la medida';
  else raise notice 'FALLA · corregir la medida ha tocado la llanta'; end if;
end $$;

-- ── Catálogo: lo que no está, no entra ──────────────────────────────────────
select prueba('una medida inventada se rechaza',
  $q$ select tc_alta_operativa_ficha(nuevo('0003CCC'),'00000000-0000-0000-0000-0000000000f1',
        '00000000-0000-0000-0000-00000000dead', null) $q$,
  'no está en el catálogo');

select prueba('una medida dada de baja tampoco entra',
  $q$ select tc_alta_operativa_ficha(nuevo('0004DDD'),'00000000-0000-0000-0000-0000000000f1',
        '00000000-0000-0000-0000-0000000000a3', null) $q$,
  'dada de baja');

select prueba('una llanta inventada se rechaza',
  $q$ select tc_alta_operativa_ficha(nuevo('0005EEE'),'00000000-0000-0000-0000-0000000000f1',
        null, '00000000-0000-0000-0000-00000000dead') $q$,
  'no está en el catálogo');

-- Y si el catálogo falla, NO se queda el tipo a medias con la ficha escrita.
do $$ declare v uuid; begin
  v := nuevo('0006FFF');
  begin
    perform tc_alta_operativa_ficha(v,'00000000-0000-0000-0000-0000000000f1',
                                    '00000000-0000-0000-0000-00000000dead', null);
  exception when others then null; end;
  if (select medida_id is null from tc_vehiculos where id=v)
  then raise notice 'PASA · con medida mala no se escribe medida';
  else raise notice 'FALLA · ha escrito una medida que no existe'; end if;
end $$;

-- ── Hereda las reglas de la función del tipo ────────────────────────────────
select prueba('un tipo sin plano se sigue rechazando',
  $q$ select tc_alta_operativa_ficha(nuevo('0007GGG'),'00000000-0000-0000-0000-0000000000f3',
        '00000000-0000-0000-0000-0000000000a1', null) $q$,
  'no tiene plano todavía');

do $$ declare v uuid; begin
  v := nuevo('0008HHH');
  perform tc_alta_operativa_ficha(v,'00000000-0000-0000-0000-0000000000f1',
                                  '00000000-0000-0000-0000-0000000000a1', null);
  insert into tc_montajes_actuales (vehiculo_id, posicion_id)
  select v, id from tc_posiciones_vehiculo where tipo_vehiculo_id='00000000-0000-0000-0000-0000000000f1' limit 2;
  begin
    perform tc_alta_operativa_ficha(v,'00000000-0000-0000-0000-0000000000f2',
                                    '00000000-0000-0000-0000-0000000000a2', null);
    raise notice 'FALLA · ha cambiado el tipo con neumáticos montados';
  exception when others then
    if SQLERRM like '%montado%'
    then raise notice 'PASA · con gomas montadas tampoco cambia el tipo por esta puerta';
    else raise notice 'FALLA · %', SQLERRM; end if;
  end;
  if (select medida_id from tc_vehiculos where id=v) = '00000000-0000-0000-0000-0000000000a1'
  then raise notice 'PASA · y la medida se queda como estaba';
  else raise notice 'FALLA · la medida ha cambiado pese al error'; end if;
  -- Pero con el MISMO tipo sí se puede corregir la medida después de montar.
  begin
    perform tc_alta_operativa_ficha(v,'00000000-0000-0000-0000-0000000000f1',
                                    '00000000-0000-0000-0000-0000000000a2', null);
    if (select medida_id from tc_vehiculos where id=v) = '00000000-0000-0000-0000-0000000000a2'
    then raise notice 'PASA · con el mismo tipo, la medida sí se corrige con gomas montadas';
    else raise notice 'FALLA · no ha corregido la medida'; end if;
  exception when others then raise notice 'FALLA · %', SQLERRM; end;
end $$;

select prueba('un vehículo de baja no pasa',
  $q$ do $x$ declare v uuid; begin
        v := nuevo('0009III'); update tc_vehiculos set activo=false where id=v;
        perform tc_alta_operativa_ficha(v,'00000000-0000-0000-0000-0000000000f1',
                                        '00000000-0000-0000-0000-0000000000a1', null);
      end $x$ $q$, 'dado de baja');

-- ── Permisos: la puerta sigue siendo estrecha ───────────────────────────────
select prueba('un operador no toca la flota de otra empresa',
  $q$ select tc_alta_operativa_ficha(nuevo('0010JJJ','00000000-0000-0000-0000-0000000000e2'),
        '00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000a1', null) $q$,
  'Sin permiso sobre este vehículo');

update auth_ctx set rol = 'cliente';
select prueba('un usuario sin rol operador ni admin no puede',
  $q$ select tc_alta_operativa_ficha(nuevo('0011KKK'),'00000000-0000-0000-0000-0000000000f1',
        '00000000-0000-0000-0000-0000000000a1', null) $q$,
  'Sin permiso sobre este vehículo');

update auth_ctx set rol = 'admin';
select prueba('el administrador de su empresa sí puede',
  $q$ select tc_alta_operativa_ficha(nuevo('0012LLL'),'00000000-0000-0000-0000-0000000000f1',
        '00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b2') $q$, 'ok');

-- Datos de oficina: ni se miran ni se tocan.
do $$ declare v uuid; begin
  v := nuevo('0013MMM');
  perform tc_alta_operativa_ficha(v,'00000000-0000-0000-0000-0000000000f2',
                                  '00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1');
  if (select marca is null and modelo is null and pendiente_validar from tc_vehiculos where id=v)
  then raise notice 'PASA · no toca marca, modelo ni pendiente_validar';
  else raise notice 'FALLA · ha tocado datos de oficina'; end if;
end $$;
