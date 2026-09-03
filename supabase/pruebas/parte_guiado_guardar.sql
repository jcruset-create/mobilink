-- ============================================================
-- Banco desechable para tyrecontrol_parte_guiado_guardar.sql
--
-- Levanta lo mínimo que la función toca y comprueba lo que importa: que
-- escribe de una vez, que un reintento NO duplica, y que si una operación
-- falla NO queda nada a medias.
--
-- Las RPC de operación reales (tc_montar_desde_almacen y compañía) no se
-- reproducen: son cientos de líneas y no es lo que esta función hace. Se
-- sustituyen por un tc_ejecutar_en_intervencion de banco que inserta una
-- operación —y que puede fallar a la orden, que es la prueba interesante.
--
--   initdb -D /tmp/pg/data -U postgres -A trust
--   pg_ctl -D /tmp/pg/data -o "-k /tmp/pg -p 55433" -l /tmp/pg/log start
--   psql -h /tmp/pg -p 55433 -U postgres -c "create database prueba"
--   psql -h /tmp/pg -p 55433 -U postgres -d prueba \
--        -f supabase/pruebas/parte_guiado_guardar.sql
-- ============================================================

do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role anon;          exception when duplicate_object then null; end $$;
do $$ begin create role service_role;  exception when duplicate_object then null; end $$;

create schema if not exists auth;
create table auth_ctx (quien uuid, rol text);
insert into auth_ctx values ('00000000-0000-0000-0000-0000000000aa', 'operador');
create or replace function auth.uid() returns uuid language sql stable as $$ select quien from auth_ctx limit 1 $$;
create or replace function tc_is_superadmin() returns boolean language sql stable as $$ select (select rol from auth_ctx limit 1) = 'superadmin' $$;
create or replace function tc_is_admin() returns boolean language sql stable as $$ select (select rol from auth_ctx limit 1) = 'admin' $$;
create or replace function tc_auth_empresa_id() returns uuid language sql stable as $$ select '00000000-0000-0000-0000-0000000000e1'::uuid $$;
create or replace function tc_operador_ve_empresa(e uuid) returns boolean language sql stable as
  $$ select (select rol from auth_ctx limit 1) = 'operador' and e = '00000000-0000-0000-0000-0000000000e1'::uuid $$;
create or replace function tc_puede_ver_empresa(e uuid) returns boolean language sql stable as $$ select true $$;

create table tc_empresas (id uuid primary key, nombre text);
insert into tc_empresas values ('00000000-0000-0000-0000-0000000000e1','Plana'),
                               ('00000000-0000-0000-0000-0000000000e2','Otra');
create table tc_usuarios (id uuid primary key);
insert into tc_usuarios values ('00000000-0000-0000-0000-0000000000aa');
create table tc_tipos_vehiculo (id uuid primary key default gen_random_uuid(), nombre text unique, activo boolean default true, configuracion_ejes text);
create table tc_posiciones_vehiculo (
  id uuid primary key default gen_random_uuid(),
  tipo_vehiculo_id uuid not null references tc_tipos_vehiculo(id) on delete cascade,
  codigo_posicion text not null, eje int, lado text, activo boolean not null default true,
  unique (tipo_vehiculo_id, codigo_posicion));
create table tc_vehiculos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references tc_empresas(id),
  tipo_vehiculo_id uuid references tc_tipos_vehiculo(id),
  matricula text not null, km_actual numeric not null default 0,
  origen_km text not null default 'manual', activo boolean not null default true,
  updated_at timestamptz not null default now(), unique (empresa_id, matricula));
create table tc_neumaticos (id uuid primary key default gen_random_uuid(), empresa_id uuid);

create table revisiones_vehiculo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references tc_empresas(id),
  vehiculo_id uuid not null references tc_vehiculos(id),
  km_vehiculo numeric, origen_km text default 'manual',
  fecha_revision date not null default current_date,
  tecnico_id uuid references tc_usuarios(id),
  estado_revision text not null default 'borrador'
    check (estado_revision in ('borrador','completada','enviada','anulada')),
  observaciones text, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());
create table revisiones_neumaticos_detalle (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references revisiones_vehiculo(id) on delete cascade,
  empresa_id uuid not null, vehiculo_id uuid not null,
  neumatico_id uuid references tc_neumaticos(id) on delete set null,
  posicion_id uuid not null references tc_posiciones_vehiculo(id),
  profundidad_mm numeric, presion_bar numeric, temperatura numeric,
  metodo_profundidad text, metodo_presion text, estado_visual text,
  observaciones text, foto_url text,
  no_accesible boolean not null default false,
  neumatico_ausente boolean not null default false,
  alerta_generada boolean not null default false,
  created_at timestamptz not null default now(),
  unique (revision_id, posicion_id));

create table tc_intervenciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references tc_empresas(id),
  vehiculo_id uuid references tc_vehiculos(id) on delete set null,
  fecha date not null default current_date,
  tecnico_id uuid references tc_usuarios(id),
  numero text, n_operaciones int not null default 0,
  inicio_at timestamptz, cerrada_at timestamptz,
  observaciones text, lugar_servicio text, orden_flota text,
  firma_cliente_url text, firma_cliente_nombre text, firma_cliente_dni text,
  firma_tecnico_url text, firma_tecnico_nombre text, firmado_at timestamptz,
  mecanico_inicio_at timestamptz, mecanico_fin_at timestamptz, mecanico_km numeric,
  created_at timestamptz not null default now());
create table tc_cat_servicios (codigo text primary key, nombre text, unidad text default 'unidad', activo boolean default true);
insert into tc_cat_servicios (codigo, nombre) values ('equilibrado','Equilibrados'),('pinchazo','Pinchazo');
create table tc_intervencion_servicios (
  id uuid primary key default gen_random_uuid(),
  intervencion_id uuid not null references tc_intervenciones(id) on delete cascade,
  servicio text not null references tc_cat_servicios(codigo),
  cantidad numeric not null check (cantidad > 0), observaciones text,
  created_at timestamptz not null default now(),
  unique (intervencion_id, servicio));
create table operaciones_neumaticos (
  id uuid primary key default gen_random_uuid(),
  intervencion_id uuid references tc_intervenciones(id) on delete set null,
  empresa_id uuid, vehiculo_id uuid, created_at timestamptz not null default now());

-- Las dos piezas que se reutilizan, en versión de banco.
create or replace function tc_iniciar_intervencion(p_vehiculo uuid) returns jsonb
language plpgsql as $$
declare v record; v_id uuid; begin
  select * into v from tc_vehiculos where id = p_vehiculo;
  select id into v_id from tc_intervenciones
   where vehiculo_id = p_vehiculo and tecnico_id = auth.uid() and cerrada_at is null limit 1;
  if v_id is not null then return jsonb_build_object('id', v_id, 'existente', true); end if;
  insert into tc_intervenciones (empresa_id, vehiculo_id, tecnico_id, inicio_at)
  values (v.empresa_id, p_vehiculo, auth.uid(), now()) returning id into v_id;
  return jsonb_build_object('id', v_id, 'existente', false);
end $$;

-- Inserta una operación, como hace la de verdad. Con 'REVIENTA' en el rpc
-- falla a propósito: es la prueba de que no queda nada a medias.
create or replace function tc_ejecutar_en_intervencion(
  p_intervencion uuid, p_rpc text, p_args jsonb default '{}'::jsonb, p_prevista uuid default null
) returns jsonb language plpgsql as $$
declare i record; begin
  if p_rpc = 'REVIENTA' then raise exception 'la operación ha fallado'; end if;
  select * into i from tc_intervenciones where id = p_intervencion;
  insert into operaciones_neumaticos (intervencion_id, empresa_id, vehiculo_id)
  values (p_intervencion, i.empresa_id, i.vehiculo_id);
  return jsonb_build_object('resultado', p_rpc);
end $$;

insert into tc_tipos_vehiculo (nombre, configuracion_ejes) values ('Camion 3 ejes','2x2x2');
insert into tc_posiciones_vehiculo (tipo_vehiculo_id, codigo_posicion, eje, lado)
select t.id, c.cod, c.eje, c.lado from tc_tipos_vehiculo t,
  (values ('E1_IZQ',1,'izq'),('E1_DER',1,'der'),('E2_IZQ',2,'izq')) as c(cod,eje,lado);
-- Un tipo ajeno, para probar que una posición de otro camión se rechaza.
insert into tc_tipos_vehiculo (nombre, configuracion_ejes) values ('Otro tipo','2x2');
insert into tc_posiciones_vehiculo (tipo_vehiculo_id, codigo_posicion, eje, lado)
select t.id, 'X1_IZQ', 1, 'izq' from tc_tipos_vehiculo t where t.nombre='Otro tipo';

insert into tc_vehiculos (empresa_id, tipo_vehiculo_id, matricula, km_actual)
select '00000000-0000-0000-0000-0000000000e1', id, '1234ABC', 100000
  from tc_tipos_vehiculo where nombre='Camion 3 ejes';

\ir ../migrations/tyrecontrol_parte_guiado_guardar.sql
\ir ../migrations/tyrecontrol_parte_guiado_guardar.sql

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

create or replace function parte(clave text, extra jsonb default '{}'::jsonb) returns jsonb
language sql as $$
  select jsonb_build_object(
    'clave', clave,
    'vehiculo_id', (select id from tc_vehiculos where matricula='1234ABC'),
    'km', 105000,
    'lugar_servicio', 'carretera',
    'observaciones', 'parte de prueba',
    'mediciones', jsonb_build_array(jsonb_build_object(
      'posicion_id', (select p.id from tc_posiciones_vehiculo p
                        join tc_tipos_vehiculo t on t.id = p.tipo_vehiculo_id
                       where t.nombre='Camion 3 ejes' and p.codigo_posicion='E1_IZQ'),
      'profundidad_mm', 7.5, 'presion_bar', 8.5)),
    'acciones', jsonb_build_array(jsonb_build_object('rpc','tc_desmontar_neumatico','args','{}'::jsonb)),
    'servicios', jsonb_build_array(jsonb_build_object('servicio','equilibrado','cantidad',2)),
    'firma_cliente_nombre','Jordi','firma_cliente_url','https://x/f.png'
  ) || extra
$$;

-- ── Las pruebas ─────────────────────────────────────────────────────────────
select prueba('sin clave no se guarda',
  $q$ select tc_guardar_parte_guiado(parte('11111111-1111-1111-1111-111111111111') - 'clave') $q$,
  'Falta la clave');

select prueba('el operador guarda el parte',
  $q$ select tc_guardar_parte_guiado(parte('11111111-1111-1111-1111-111111111111')) $q$, 'ok');

do $$ declare n int; begin
  select count(*) into n from revisiones_vehiculo where estado_revision='completada';
  if n = 1 then raise notice 'PASA · ha creado la revision, completada';
  else raise notice 'FALLA · % revisiones', n; end if;
  select count(*) into n from revisiones_neumaticos_detalle;
  if n = 1 then raise notice 'PASA · ha guardado la medicion';
  else raise notice 'FALLA · % mediciones', n; end if;
  select count(*) into n from tc_intervenciones;
  if n = 1 then raise notice 'PASA · ha creado la intervencion';
  else raise notice 'FALLA · % intervenciones', n; end if;
  select count(*) into n from operaciones_neumaticos;
  if n = 1 then raise notice 'PASA · ha ejecutado la operacion';
  else raise notice 'FALLA · % operaciones', n; end if;
  select count(*) into n from tc_intervencion_servicios where cantidad = 2;
  if n = 1 then raise notice 'PASA · ha guardado el servicio con su cantidad';
  else raise notice 'FALLA · % servicios', n; end if;
end $$;

do $$ declare v record; begin
  select * into v from tc_intervenciones limit 1;
  if v.lugar_servicio='carretera' and v.firma_cliente_nombre='Jordi' and v.firmado_at is not null
  then raise notice 'PASA · cabecera, firma y sello de firmado';
  else raise notice 'FALLA · lugar=% firma=% firmado=%', v.lugar_servicio, v.firma_cliente_nombre, v.firmado_at; end if;
end $$;

do $$ begin
  if (select km_actual from tc_vehiculos where matricula='1234ABC') = 105000
  then raise notice 'PASA · ha subido los km del vehiculo';
  else raise notice 'FALLA · km = %', (select km_actual from tc_vehiculos where matricula='1234ABC'); end if;
end $$;

-- LA PRUEBA DE LA IDEMPOTENCIA
do $$ declare r jsonb; n int; begin
  r := tc_guardar_parte_guiado(parte('11111111-1111-1111-1111-111111111111'));
  select count(*) into n from tc_intervenciones;
  if (r->>'ya_guardado')::boolean and n = 1
  then raise notice 'PASA · el mismo parte dos veces NO duplica la intervencion';
  else raise notice 'FALLA · ya_guardado=% intervenciones=%', r->>'ya_guardado', n; end if;
  select count(*) into n from revisiones_vehiculo;
  if n = 1 then raise notice 'PASA · ni duplica la revision';
  else raise notice 'FALLA · % revisiones', n; end if;
end $$;

-- LA PRUEBA DEL TODO O NADA
do $$ declare n_int_antes int; n_rev_antes int; n_int int; n_rev int; begin
  select count(*) into n_int_antes from tc_intervenciones;
  select count(*) into n_rev_antes from revisiones_vehiculo;
  begin
    perform tc_guardar_parte_guiado(parte('22222222-2222-2222-2222-222222222222',
      jsonb_build_object('acciones', jsonb_build_array(
        jsonb_build_object('rpc','tc_desmontar_neumatico','args','{}'::jsonb),
        jsonb_build_object('rpc','REVIENTA','args','{}'::jsonb)))));
    raise notice 'FALLA · deberia haber fallado y no fallo';
  exception when others then
    select count(*) into n_int from tc_intervenciones;
    select count(*) into n_rev from revisiones_vehiculo;
    if n_int = n_int_antes and n_rev = n_rev_antes
    then raise notice 'PASA · si una operacion falla no queda NADA a medias';
    else raise notice 'FALLA · quedaron restos: intervenciones %→%, revisiones %→%',
      n_int_antes, n_int, n_rev_antes, n_rev; end if;
  end;
  if not exists (select 1 from tc_partes_guiados where clave='22222222-2222-2222-2222-222222222222')
  then raise notice 'PASA · el parte que fallo no queda marcado como guardado';
  else raise notice 'FALLA · el parte fallido quedo marcado'; end if;
end $$;

-- Una posición de OTRO tipo de vehículo se rechaza.
select prueba('una posicion de otro camion se rechaza',
  $q$ select tc_guardar_parte_guiado(parte('33333333-3333-3333-3333-333333333333',
        jsonb_build_object('mediciones', jsonb_build_array(jsonb_build_object(
          'posicion_id', (select p.id from tc_posiciones_vehiculo p
                            join tc_tipos_vehiculo t on t.id = p.tipo_vehiculo_id
                           where t.nombre='Otro tipo'), 'profundidad_mm', 5))))) $q$,
  'no es de este veh');

-- Km a la baja: avisa, no bloquea.
do $$ declare r jsonb; begin
  r := tc_guardar_parte_guiado(parte('44444444-4444-4444-4444-444444444444',
        jsonb_build_object('km', 90000)));
  if jsonb_array_length(r->'avisos') = 1 and (r->'avisos'->>0) like '%menores que los registrados%'
  then raise notice 'PASA · los km a la baja avisan pero no bloquean';
  else raise notice 'FALLA · avisos = %', r->'avisos'; end if;
end $$;
do $$ begin
  if (select km_actual from tc_vehiculos where matricula='1234ABC') = 105000
  then raise notice 'PASA · y no se escriben encima de los buenos';
  else raise notice 'FALLA · km = %', (select km_actual from tc_vehiculos where matricula='1234ABC'); end if;
end $$;

select prueba('los km negativos se rechazan',
  $q$ select tc_guardar_parte_guiado(parte('55555555-5555-5555-5555-555555555555',
        jsonb_build_object('km', -1))) $q$, 'no pueden ser negativos');

update auth_ctx set rol = 'cliente';
select prueba('un cliente no guarda partes',
  $q$ select tc_guardar_parte_guiado(parte('66666666-6666-6666-6666-666666666666')) $q$,
  'Sin permiso');
update auth_ctx set rol = 'operador';
