\set ON_ERROR_STOP on
-- ⛔ ESTO NO ES UNA MIGRACIÓN. NO LO PEGUES EN SUPABASE.
--
-- Es un banco de pruebas desechable, para un PostgreSQL vacío en local. Crea
-- tablas de mentira y REDEFINE tc_is_superadmin(), tc_puede_ver_empresa() y
-- auth.uid() como funciones que devuelven valores fijos. Contra una base real
-- eso abriría los permisos de par en par.
--
-- Las migraciones que van a Supabase son las de supabase/migrations/.
--
-- Este cerrojo aborta antes de tocar nada si la base ya tiene TyreControl.
do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'tc_vehiculos') then
    raise exception 'ESTE FICHERO NO ES UNA MIGRACIÓN: es el banco de pruebas '
      'desechable y esta base ya tiene TyreControl instalado. No se ha '
      'ejecutado nada. Las migraciones están en supabase/migrations/.';
  end if;
end $$;

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
create table tc_neumaticos (id uuid primary key default gen_random_uuid(), empresa_id uuid,
  estado text, updated_at timestamptz not null default now());

-- Los montajes actuales: es lo que se consulta para resolver una goma recién
-- declarada, que todavía no tenía id de montaje cuando la tablet armó el parte.
create table tc_montajes_actuales (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid, vehiculo_id uuid, neumatico_id uuid references tc_neumaticos(id),
  posicion_id uuid, fecha_montaje date default current_date, km_montaje numeric,
  tecnico_id uuid, observaciones text,
  unique (vehiculo_id, posicion_id));

-- Los catálogos de razones y destinos, con las filas que de verdad ofrece el
-- formulario. El destino es el que decide en qué estado queda la goma.
create table tc_cat_motivos (
  id uuid primary key default gen_random_uuid(), codigo text not null, nombre text not null,
  tipo_operacion text, orden int default 100, activo boolean default true,
  unique (codigo, tipo_operacion));
insert into tc_cat_motivos (codigo, nombre) values ('desgaste','Desgaste'),('pinchazo','Pinchazo');
create table tc_cat_destinos (
  codigo text primary key, nombre text not null, estado_resultante text,
  orden int default 100, activo boolean default true);
insert into tc_cat_destinos (codigo, nombre, estado_resultante) values
  ('almacen_taller','Almacenar en el taller','stock_usado'),
  ('carcasa_continental','Carcasa a Continental','pendiente_recauchutado'),
  ('desechado','Desechado','descartado');

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
  empresa_id uuid, vehiculo_id uuid, neumatico_id uuid references tc_neumaticos(id),
  -- Sin CHECK, como en la base de verdad desde la fase 1: aquí van CÓDIGOS del
  -- catálogo de destinos, no las cuatro palabras de antes.
  destino text, estado_nuevo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());

-- La tabla de adjuntos que ya existe: es donde van las fotos de la operación.
create table tc_operacion_adjuntos (
  id uuid primary key default gen_random_uuid(),
  operacion_id uuid not null references operaciones_neumaticos(id) on delete cascade,
  file_url text not null, storage_path text, file_type text, descripcion text,
  subido_por uuid default auth.uid(), created_at timestamptz not null default now());

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
declare i record; v_neu uuid; v_ids uuid[]; begin
  if p_rpc = 'REVIENTA' then raise exception 'la operación ha fallado'; end if;
  select * into i from tc_intervenciones where id = p_intervencion;

  -- Montar deja el montaje hecho, como la RPC de verdad: es lo que después
  -- permite resolver por posición una goma declarada en este mismo parte.
  if p_rpc = 'tc_montar_desde_catalogo' then
    insert into tc_neumaticos (empresa_id, estado) values (i.empresa_id, 'montado')
    returning id into v_neu;
    insert into tc_montajes_actuales (empresa_id, vehiculo_id, neumatico_id, posicion_id)
    values (i.empresa_id, (p_args->>'p_vehiculo')::uuid, v_neu, (p_args->>'p_posicion')::uuid);
  -- Desmontar lo quita, también como la de verdad.
  elsif p_rpc = 'tc_desmontar_neumatico' and nullif(p_args->>'p_montaje','') is not null then
    select neumatico_id into v_neu from tc_montajes_actuales where id = (p_args->>'p_montaje')::uuid;
    delete from tc_montajes_actuales where id = (p_args->>'p_montaje')::uuid;
    update tc_neumaticos set estado = p_args->>'p_nuevo_estado' where id = v_neu;
  else
    insert into tc_neumaticos (empresa_id, estado) values (i.empresa_id, p_args->>'p_nuevo_estado')
    returning id into v_neu;
  end if;

  insert into operaciones_neumaticos (intervencion_id, empresa_id, vehiculo_id, neumatico_id,
                                      destino, estado_nuevo)
  values (p_intervencion, i.empresa_id, i.vehiculo_id, v_neu,
          p_args->>'p_nuevo_estado', p_args->>'p_nuevo_estado');
  -- Como la de verdad: devuelve TODAS las operaciones de la intervención
  -- creadas en esta transacción, no solo la de esta llamada.
  select array_agg(id) into v_ids from operaciones_neumaticos
   where intervencion_id = p_intervencion and created_at >= transaction_timestamp();
  return jsonb_build_object('resultado', p_rpc, 'intervencion', p_intervencion,
                            'operaciones_intervencion', to_jsonb(v_ids));
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

-- ── El destino del catálogo y las fotos ─────────────────────────────────────
-- Los partes de arriba han ido todos a la MISMA intervención (que es lo
-- correcto: tc_iniciar_intervencion reutiliza la abierta del vehículo). Para
-- que las comprobaciones de aquí abajo miren solo sus propias operaciones, se
-- cierra esa intervención y cada parte nuevo abre la suya.
update tc_intervenciones set cerrada_at = now() where cerrada_at is null;

-- Un destino que NO deja la goma en el almacén: se desmonta a 'reparacion'
-- (que no toca stock) y acaba en el estado que dice el catálogo.
do $$ declare r jsonb; o record; n int; begin
  r := tc_guardar_parte_guiado(parte('77777777-7777-7777-7777-777777777777',
    jsonb_build_object('acciones', jsonb_build_array(jsonb_build_object(
      'rpc','tc_desmontar_neumatico', 'args', jsonb_build_object('p_motivo','pinchazo'),
      'destino_codigo','carcasa_continental',
      'adjuntos', jsonb_build_array(
        jsonb_build_object('url','https://x/serie.jpg','descripcion','Número de serie'),
        jsonb_build_object('url','https://x/dot.jpg','descripcion','DOT'),
        jsonb_build_object('url','','descripcion','vacía, se ignora')))))));

  select * into o from operaciones_neumaticos
   where intervencion_id = (r->>'intervencion_id')::uuid;
  if o.destino = 'carcasa_continental' and o.estado_nuevo = 'pendiente_recauchutado'
  then raise notice 'PASA · la operacion guarda el CODIGO del destino del catalogo';
  else raise notice 'FALLA · destino=% estado_nuevo=%', o.destino, o.estado_nuevo; end if;

  if (select estado from tc_neumaticos where id = o.neumatico_id) = 'pendiente_recauchutado'
  then raise notice 'PASA · el neumatico acaba en el estado que dice el catalogo';
  else raise notice 'FALLA · el neumatico quedo en %',
    (select estado from tc_neumaticos where id = o.neumatico_id); end if;

  select count(*) into n from tc_operacion_adjuntos where operacion_id = o.id;
  if n = 2 then raise notice 'PASA · las dos fotos se cuelgan de la operacion (la vacia no)';
  else raise notice 'FALLA · % adjuntos', n; end if;
  if (r->>'fotos')::int = 2 then raise notice 'PASA · y lo devuelve contado';
  else raise notice 'FALLA · fotos = %', r->>'fotos'; end if;
end $$;

-- Un destino que SÍ vuelve al almacén: se desmonta a 'almacen', que es lo que
-- repone stock como usado. Ese camino no se toca.
update tc_intervenciones set cerrada_at = now() where cerrada_at is null;
do $$ declare r jsonb; o record; begin
  r := tc_guardar_parte_guiado(parte('88888888-8888-8888-8888-888888888888',
    jsonb_build_object('acciones', jsonb_build_array(jsonb_build_object(
      'rpc','tc_desmontar_neumatico', 'args','{}'::jsonb,
      'destino_codigo','almacen_taller')))));
  select * into o from operaciones_neumaticos
   where intervencion_id = (r->>'intervencion_id')::uuid;
  -- El banco guarda en estado_nuevo el p_nuevo_estado con el que se llamó,
  -- antes de la corrección: así se ve con qué estado se desmontó de verdad.
  if (select estado from tc_neumaticos where id = o.neumatico_id) = 'stock_usado'
     and o.destino = 'almacen_taller'
  then raise notice 'PASA · el destino de almacen desmonta a almacen y queda como stock usado';
  else raise notice 'FALLA · estado=% destino=%',
    (select estado from tc_neumaticos where id = o.neumatico_id), o.destino; end if;
end $$;

-- DOS acciones en el mismo parte: cada foto va a SU operación, no a las dos.
update tc_intervenciones set cerrada_at = now() where cerrada_at is null;
do $$ declare r jsonb; ids uuid[]; n1 int; n2 int; begin
  r := tc_guardar_parte_guiado(parte('99999999-9999-9999-9999-999999999999',
    jsonb_build_object('acciones', jsonb_build_array(
      jsonb_build_object('rpc','tc_desmontar_neumatico','args','{}'::jsonb,
        'destino_codigo','desechado',
        'adjuntos', jsonb_build_array(jsonb_build_object('url','https://x/1.jpg'))),
      jsonb_build_object('rpc','tc_desmontar_neumatico','args','{}'::jsonb,
        'destino_codigo','desechado',
        'adjuntos', jsonb_build_array(jsonb_build_object('url','https://x/2.jpg')))))));
  select array_agg(id order by created_at, id) into ids from operaciones_neumaticos
   where intervencion_id = (r->>'intervencion_id')::uuid;
  select count(*) into n1 from tc_operacion_adjuntos where operacion_id = ids[1];
  select count(*) into n2 from tc_operacion_adjuntos where operacion_id = ids[2];
  if array_length(ids,1) = 2 and n1 = 1 and n2 = 1
  then raise notice 'PASA · con dos acciones cada foto va a SU operacion';
  else raise notice 'FALLA · % operaciones, adjuntos %/%', array_length(ids,1), n1, n2; end if;
end $$;

select prueba('un destino inventado se rechaza',
  $q$ select tc_guardar_parte_guiado(parte('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        jsonb_build_object('acciones', jsonb_build_array(jsonb_build_object(
          'rpc','tc_desmontar_neumatico','args','{}'::jsonb,
          'destino_codigo','me_lo_invento'))))) $q$,
  'no está en el catálogo');

-- ── Declarar lo que ya lleva, y cambiar una en el mismo parte ───────────────
-- Es el caso del camión que no tiene NI UNA goma fichada: el técnico declara
-- qué monta y acto seguido cambia una. El desmontaje no puede traer el id del
-- montaje, porque ese montaje se crea unas líneas antes, en esta transacción.
update tc_intervenciones set cerrada_at = now() where cerrada_at is null;
do $$
declare r jsonb; v_veh uuid; v_p1 uuid; v_p2 uuid; n int; begin
  select id into v_veh from tc_vehiculos where matricula='1234ABC';
  select p.id into v_p1 from tc_posiciones_vehiculo p join tc_tipos_vehiculo t on t.id=p.tipo_vehiculo_id
   where t.nombre='Camion 3 ejes' and p.codigo_posicion='E1_IZQ';
  select p.id into v_p2 from tc_posiciones_vehiculo p join tc_tipos_vehiculo t on t.id=p.tipo_vehiculo_id
   where t.nombre='Camion 3 ejes' and p.codigo_posicion='E1_DER';

  r := tc_guardar_parte_guiado(parte('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    jsonb_build_object('acciones', jsonb_build_array(
      -- Lo declarado: dos ruedas.
      jsonb_build_object('rpc','tc_montar_desde_catalogo','args',
        jsonb_build_object('p_vehiculo', v_veh, 'p_posicion', v_p1, 'p_condicion','usado')),
      jsonb_build_object('rpc','tc_montar_desde_catalogo','args',
        jsonb_build_object('p_vehiculo', v_veh, 'p_posicion', v_p2, 'p_condicion','usado')),
      -- Y una de ellas se cambia, sin id de montaje: por posición.
      jsonb_build_object('rpc','tc_desmontar_neumatico', 'posicion_origen', v_p1,
        'args','{}'::jsonb, 'destino_codigo','desechado',
        'adjuntos', jsonb_build_array(
          jsonb_build_object('url','https://x/serie.jpg','descripcion','Número de serie')))))));

  if (r->>'operaciones')::int = 3
  then raise notice 'PASA · declarar dos ruedas y desmontar una sale en un solo parte';
  else raise notice 'FALLA · operaciones = %', r->>'operaciones'; end if;

  -- La declarada que no se tocó sigue montada; la otra ya no.
  select count(*) into n from tc_montajes_actuales where vehiculo_id = v_veh;
  if n = 1 and exists (select 1 from tc_montajes_actuales
                        where vehiculo_id = v_veh and posicion_id = v_p2)
  then raise notice 'PASA · queda montada la que no se tocó, y la otra no';
  else raise notice 'FALLA · % montajes actuales', n; end if;

  if (r->>'fotos')::int = 1
  then raise notice 'PASA · la foto se cuelga del desmontaje resuelto por posicion';
  else raise notice 'FALLA · fotos = %', r->>'fotos'; end if;
end $$;

-- Una posición sin nada montado cuando llega su turno: se rechaza, y con un
-- mensaje que dice qué ha pasado en vez de un error de conversión a uuid.
update tc_intervenciones set cerrada_at = now() where cerrada_at is null;
select prueba('desmontar por posicion sin nada montado se rechaza',
  $q$ select tc_guardar_parte_guiado(parte('cccccccc-cccc-cccc-cccc-cccccccccccc',
        jsonb_build_object('acciones', jsonb_build_array(jsonb_build_object(
          'rpc','tc_desmontar_neumatico','args','{}'::jsonb,
          'destino_codigo','desechado',
          'posicion_origen', (select p.id from tc_posiciones_vehiculo p
                                join tc_tipos_vehiculo t on t.id=p.tipo_vehiculo_id
                               where t.nombre='Camion 3 ejes' and p.codigo_posicion='E2_IZQ')))))) $q$,
  'No hay ningún neumático montado en la posición');
