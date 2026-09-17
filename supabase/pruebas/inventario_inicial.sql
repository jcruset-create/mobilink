\set ON_ERROR_STOP on
-- ⛔ ESTO NO ES UNA MIGRACIÓN. NO LO PEGUES EN SUPABASE.
-- Banco desechable: tablas de mentira y funciones de permisos redefinidas.
do $$ begin
  if exists (select 1 from pg_tables where schemaname='public' and tablename='tc_vehiculos') then
    raise exception 'ESTE FICHERO NO ES UNA MIGRACIÓN: banco desechable y esta base ya tiene TyreControl.';
  end if;
end $$;

-- ============================================================
-- Banco para tyrecontrol_inventario_inicial.sql
--
-- Lo que más se vigila aquí es lo que el encargo prohíbe: que apuntar una goma
-- que YA ESTABA montada no mueva stock, no cree coste y no genere un trabajo
-- facturable. Para poder demostrarlo, el banco crea una tabla de movimientos
-- de almacén y comprueba que se queda VACÍA.
-- ============================================================

do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create table auth_ctx (rol text, quien uuid);
insert into auth_ctx values ('operador','00000000-0000-0000-0000-0000000000aa');
create or replace function auth.uid() returns uuid language sql stable as $$ select quien from auth_ctx limit 1 $$;
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
insert into tc_empresas values ('00000000-0000-0000-0000-0000000000e1','Plana');
create table tc_tipos_vehiculo (id uuid primary key, nombre text, configuracion_ejes text, activo boolean default true);
create table tc_vehiculos (id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references tc_empresas(id), matricula text,
  tipo_vehiculo_id uuid references tc_tipos_vehiculo(id),
  km_actual numeric default 0, origen_km text default 'manual',
  marca text, modelo text, bastidor text,
  activo boolean default true, updated_at timestamptz default now());
create table tc_posiciones_vehiculo (id uuid primary key default gen_random_uuid(),
  tipo_vehiculo_id uuid not null references tc_tipos_vehiculo(id),
  codigo_posicion text, orden_visual int default 0, activo boolean default true);
create table tc_neumaticos (id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null, numero_interno text, codigo_interno text, almacen_producto_id uuid,
  control_individual boolean, creado_automaticamente boolean, origen text,
  marca text, modelo text, medida text, indice_carga text, indice_velocidad text,
  dot text, numero_serie text, rfid_epc text, proveedor text, profundidad_actual_mm numeric,
  estado text, vehiculo_id uuid, posicion_id uuid, activo boolean default true,
  coste_compra numeric, updated_at timestamptz default now());
create unique index uq_tc_neu_serie on tc_neumaticos (empresa_id, numero_serie) where numero_serie is not null;
create table tc_montajes_actuales (id uuid primary key default gen_random_uuid(),
  empresa_id uuid, vehiculo_id uuid references tc_vehiculos(id), neumatico_id uuid references tc_neumaticos(id),
  posicion_id uuid references tc_posiciones_vehiculo(id), fecha_montaje date, km_montaje numeric,
  tecnico_id uuid, observaciones text, unique (vehiculo_id, posicion_id));
create table tc_historial_montajes (id uuid primary key default gen_random_uuid(),
  empresa_id uuid, vehiculo_id uuid, neumatico_id uuid, posicion_id uuid, fecha_montaje date,
  km_montaje numeric, fecha_desmontaje date, km_desmontaje numeric, motivo_desmontaje text,
  tecnico_montaje_id uuid, tecnico_desmontaje_id uuid, observaciones text);
create table operaciones_neumaticos (id uuid primary key default gen_random_uuid(),
  empresa_id uuid, vehiculo_id uuid, neumatico_id uuid, tipo_operacion text,
  posicion_origen_id uuid, posicion_destino_id uuid, montaje_origen_id uuid, montaje_destino_id uuid,
  km_vehiculo numeric, fecha_operacion date, motivo text, estado_anterior text, estado_nuevo text,
  destino text, tecnico_id uuid, observaciones text, coste numeric, facturable boolean default false);
create table autorizaciones_operaciones (id uuid primary key default gen_random_uuid(),
  empresa_id uuid, operacion_id uuid, tipo_autorizacion text, solicitado_por uuid,
  autorizado_por uuid, motivo text, estado text, fecha_autorizacion timestamptz);
create table revisiones_vehiculo (id uuid primary key default gen_random_uuid(),
  empresa_id uuid, vehiculo_id uuid references tc_vehiculos(id), km_vehiculo numeric,
  origen_km text default 'manual', fecha_revision date default current_date, tecnico_id uuid,
  estado_revision text default 'borrador', observaciones text,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table revisiones_neumaticos_detalle (id uuid primary key default gen_random_uuid(),
  revision_id uuid references revisiones_vehiculo(id), empresa_id uuid, vehiculo_id uuid,
  neumatico_id uuid, posicion_id uuid, profundidad_mm numeric, presion_bar numeric,
  metodo_profundidad text, metodo_presion text, observaciones text, foto_url text,
  unique (revision_id, posicion_id));

-- El catálogo, tal como lo lee tc_montar_desde_catalogo.
create table tyre_sizes (id uuid primary key default gen_random_uuid(), medida text,
  indice_carga_simple text, indice_carga_doble text, codigo_velocidad text);
create table tc_cat_marcas_neumatico (id uuid primary key default gen_random_uuid(), nombre text);
create table tc_cat_modelos_neumatico (id uuid primary key default gen_random_uuid(),
  nombre text, marca_id uuid references tc_cat_marcas_neumatico(id));
create table tc_referencias_neumatico (id uuid primary key default gen_random_uuid(),
  modelo_id uuid references tc_cat_modelos_neumatico(id), tyre_size_id uuid references tyre_sizes(id),
  profundidad_dibujo_mm numeric);
create table tc_contadores_numero_interno (anio int primary key, ultimo int);

-- EL TESTIGO: si el inventario inicial moviera stock, aquí habría filas.
create table movimientos_stock (id uuid primary key default gen_random_uuid(),
  neumatico_id uuid, tipo text, cantidad numeric, coste numeric);

-- El generador de números internos, calcado de tyrecontrol_fase8_operaciones.sql.
create or replace function tc_generar_numero_interno() returns text
language plpgsql as $g$
declare v_anio int; v_siguiente int;
begin
  v_anio := extract(year from now())::int;
  insert into tc_contadores_numero_interno (anio, ultimo) values (v_anio, 1)
    on conflict (anio) do update set ultimo = tc_contadores_numero_interno.ultimo + 1
    returning ultimo into v_siguiente;
  return 'NT-' || v_anio || '-' || lpad(v_siguiente::text, 6, '0');
end $g$;

create or replace function tc_medida_compatible(tipo uuid, medida text) returns boolean
  language sql stable as $$ select true $$;
create or replace function tc_devolver_usado_a_stock(n uuid, e uuid) returns void
  language plpgsql as $$ begin
    insert into movimientos_stock (neumatico_id, tipo, cantidad) values (n, 'devolucion', 1);
  end $$;

\ir ../migrations/tyrecontrol_montar_desde_catalogo.sql
\ir ../migrations/tyrecontrol_inventario_inicial.sql
-- Segunda pasada: las migraciones tienen que ser idempotentes.
\ir ../migrations/tyrecontrol_inventario_inicial.sql

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- ── Datos ───────────────────────────────────────────────────────────────────
insert into tc_tipos_vehiculo (id, nombre, configuracion_ejes) values
  ('00000000-0000-0000-0000-0000000000f1','semirremolque','2x2x2');
insert into tc_posiciones_vehiculo (tipo_vehiculo_id, codigo_posicion, orden_visual)
select '00000000-0000-0000-0000-0000000000f1','P'||g, g from generate_series(1,6) g;
insert into tc_cat_marcas_neumatico (id, nombre) values ('00000000-0000-0000-0000-0000000000a1','Michelin');
insert into tc_cat_modelos_neumatico (id, nombre, marca_id) values
  ('00000000-0000-0000-0000-0000000000b1','X Multi D','00000000-0000-0000-0000-0000000000a1');
insert into tyre_sizes (id, medida, indice_carga_simple, codigo_velocidad) values
  ('00000000-0000-0000-0000-0000000000c1','315/80R22.5','156','L');
insert into tc_referencias_neumatico (id, modelo_id, tyre_size_id, profundidad_dibujo_mm) values
  ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000c1', 16);

insert into tc_vehiculos (id, empresa_id, matricula, tipo_vehiculo_id, km_actual)
values ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000e1','1234ABC',
        '00000000-0000-0000-0000-0000000000f1', 100000);

create or replace function prueba(nombre text, obtenido anyelement, espera anyelement) returns void
language plpgsql as $$ begin
  if obtenido is not distinct from espera then raise notice 'PASA · %', nombre;
  else raise notice 'FALLA · % → esperaba %, dio %', nombre, espera, obtenido; end if;
end $$;

create or replace function posicion(n int) returns uuid language sql stable as
$$ select id from tc_posiciones_vehiculo where codigo_posicion = 'P'||n $$;

-- ── Las pruebas ─────────────────────────────────────────────────────────────
do $$ declare r jsonb; begin
  r := tc_inventario_inicial_posicion('00000000-0000-0000-0000-00000000000a', posicion(1),
        '00000000-0000-0000-0000-0000000000d1',
        '{"profundidad_mm":"12.5","numero_serie":"SER-001","dot":"1422"}'::jsonb);
  perform prueba('se apunta la goma y devuelve el progreso', (r->>'total')::int, 6);
  perform prueba('… con una hecha', (r->>'hechas')::int, 1);
  perform prueba('sin presión, se dice que no se midió', (r->>'presion_medida')::boolean, false);
  perform prueba('cada goma nace con su número interno',
    (r->>'numero_interno') like 'NT-%', true);
end $$;

do $$ declare n record; begin
  select * into n from tc_neumaticos where numero_serie = 'SER-001';
  perform prueba('el origen queda marcado como inventario inicial', n.origen, 'carga_inicial');
  perform prueba('la goma es individual, no genérica', n.control_individual, true);
  perform prueba('se guarda la profundidad MEDIDA, no la de dibujo del catálogo',
    n.profundidad_actual_mm, 12.5::numeric);
  perform prueba('marca y modelo salen del catálogo, no se teclean', n.marca, 'Michelin');
  perform prueba('no se le inventa ningún coste', n.coste_compra is null, true);
end $$;

do $$ declare d record; begin
  select * into d from revisiones_neumaticos_detalle where posicion_id = posicion(1);
  perform prueba('LA REGLA: la presión no medida se guarda como NULL, no como cero',
    d.presion_bar is null, true);
  perform prueba('… y sin método de presión, que diría que alguien la midió',
    d.metodo_presion is null, true);
  perform prueba('la profundidad va a la revisión, no a una tabla nueva', d.profundidad_mm, 12.5::numeric);
end $$;

-- LO QUE EL ENCARGO PROHÍBE
do $$ declare n int; begin
  select count(*) into n from movimientos_stock;
  perform prueba('NO se mueve stock', n, 0);
  select count(*) into n from operaciones_neumaticos where coalesce(coste,0) <> 0;
  perform prueba('NO se genera coste', n, 0);
  select count(*) into n from operaciones_neumaticos where facturable;
  perform prueba('NO se genera trabajo facturable', n, 0);
  select count(*) into n from operaciones_neumaticos where tipo_operacion = 'montaje';
  perform prueba('SÍ queda el histórico del neumático: una operación de montaje', n, 1);
  select count(*) into n from operaciones_neumaticos
   where estado_anterior = 'inventario_inicial' and observaciones like '%ya estaba montada%';
  perform prueba('… y dice que la goma se encontró montada, no que se montó ese día', n, 1);
end $$;

-- Presión SÍ medida
do $$ declare r jsonb; d record; begin
  r := tc_inventario_inicial_posicion('00000000-0000-0000-0000-00000000000a', posicion(2),
        '00000000-0000-0000-0000-0000000000d1', '{"profundidad_mm":"9","presion_bar":"8.5"}'::jsonb);
  perform prueba('con presión medida se dice que sí', (r->>'presion_medida')::boolean, true);
  select * into d from revisiones_neumaticos_detalle where posicion_id = posicion(2);
  perform prueba('… y se guarda el valor', d.presion_bar, 8.5::numeric);
  perform prueba('… con su método', d.metodo_presion, 'manual');
end $$;

-- Identidad individual: dos gomas iguales, sin serie, son DOS.
do $$ declare a jsonb; b jsonb; begin
  a := tc_inventario_inicial_posicion('00000000-0000-0000-0000-00000000000a', posicion(3),
        '00000000-0000-0000-0000-0000000000d1', '{"profundidad_mm":"10"}'::jsonb);
  b := tc_inventario_inicial_posicion('00000000-0000-0000-0000-00000000000a', posicion(4),
        '00000000-0000-0000-0000-0000000000d1', '{"profundidad_mm":"10"}'::jsonb);
  perform prueba('dos gomas idénticas sin número de serie son DOS neumáticos distintos',
    (a->>'neumatico_id') <> (b->>'neumatico_id'), true);
  perform prueba('… con números internos distintos',
    (a->>'numero_interno') <> (b->>'numero_interno'), true);
end $$;

-- Validaciones
do $$ begin
  begin
    perform tc_inventario_inicial_posicion('00000000-0000-0000-0000-00000000000a', posicion(5),
      '00000000-0000-0000-0000-0000000000d1', '{}'::jsonb);
    raise notice 'FALLA · ha dejado guardar sin profundidad';
  exception when others then
    if SQLERRM like '%Falta la profundidad%' then raise notice 'PASA · sin profundidad no se guarda';
    else raise notice 'FALLA · %', SQLERRM; end if;
  end;
  begin
    perform tc_inventario_inicial_posicion('00000000-0000-0000-0000-00000000000a', posicion(5),
      '00000000-0000-0000-0000-0000000000d1', '{"profundidad_mm":"99"}'::jsonb);
    raise notice 'FALLA · ha aceptado 99 mm';
  exception when others then
    if SQLERRM like '%imposible%' then raise notice 'PASA · una profundidad imposible se rechaza';
    else raise notice 'FALLA · %', SQLERRM; end if;
  end;
  begin
    perform tc_inventario_inicial_posicion('00000000-0000-0000-0000-00000000000a', posicion(5),
      '00000000-0000-0000-0000-0000000000d1', '{"profundidad_mm":"8","numero_serie":"SER-001"}'::jsonb);
    raise notice 'FALLA · ha aceptado un número de serie repetido';
  exception when others then
    if SQLERRM like '%ya está en otro neumático%' then raise notice 'PASA · un número de serie repetido se avisa en cristiano';
    else raise notice 'FALLA · %', SQLERRM; end if;
  end;
end $$;

-- Reanudar y corregir: no se duplica nada.
do $$ declare r jsonb; n int; d record; begin
  r := tc_inventario_inicial_posicion('00000000-0000-0000-0000-00000000000a', posicion(1),
        '00000000-0000-0000-0000-0000000000d1', '{"profundidad_mm":"11","presion_bar":"7.8"}'::jsonb);
  select count(*) into n from revisiones_vehiculo where vehiculo_id='00000000-0000-0000-0000-00000000000a';
  perform prueba('reanudar no abre una segunda revisión', n, 1);
  select count(*) into n from tc_montajes_actuales
   where vehiculo_id='00000000-0000-0000-0000-00000000000a' and posicion_id=posicion(1);
  perform prueba('… ni monta una segunda goma en la misma posición', n, 1);
  select * into d from revisiones_neumaticos_detalle where posicion_id = posicion(1);
  perform prueba('… y la medición queda corregida', d.profundidad_mm, 11::numeric);
  perform prueba('… incluida la presión que antes no estaba', d.presion_bar, 7.8::numeric);
end $$;

-- ── Finalizar ───────────────────────────────────────────────────────────────
do $$ begin
  begin
    perform tc_inventario_inicial_finalizar('00000000-0000-0000-0000-00000000000a');
    raise notice 'FALLA · ha finalizado con posiciones sin informar';
  exception when others then
    if SQLERRM like '%Faltan neumáticos%' and SQLERRM like '%P5%' and SQLERRM like '%P6%'
    then raise notice 'PASA · no finaliza con posiciones vacías, y dice CUÁLES faltan';
    else raise notice 'FALLA · %', SQLERRM; end if;
  end;
end $$;

do $$ declare r jsonb; begin
  perform tc_inventario_inicial_posicion('00000000-0000-0000-0000-00000000000a', posicion(5),
    '00000000-0000-0000-0000-0000000000d1', '{"profundidad_mm":"7"}'::jsonb);
  perform tc_inventario_inicial_posicion('00000000-0000-0000-0000-00000000000a', posicion(6),
    '00000000-0000-0000-0000-0000000000d1', '{"profundidad_mm":"6"}'::jsonb);
  -- Sin marca, sin modelo, sin bastidor y sin presión en cuatro ruedas.
  r := tc_inventario_inicial_finalizar('00000000-0000-0000-0000-00000000000a', 123456, 'manual');
  perform prueba('finaliza sin presión y sin datos de oficina', (r->>'ya_estaba')::boolean, false);
  perform prueba('… con las 6 posiciones', (r->>'posiciones')::int, 6);
end $$;

do $$ declare r jsonb; n int; begin
  -- Doble toque en Finalizar.
  r := tc_inventario_inicial_finalizar('00000000-0000-0000-0000-00000000000a', 123456, 'manual');
  perform prueba('el doble toque en Finalizar no crea otra revisión', (r->>'ya_estaba')::boolean, true);
  select count(*) into n from revisiones_vehiculo where vehiculo_id='00000000-0000-0000-0000-00000000000a';
  perform prueba('… sigue habiendo UNA revisión inicial', n, 1);
end $$;

do $$ declare v record; begin
  select * into v from tc_vehiculos where id='00000000-0000-0000-0000-00000000000a';
  perform prueba('los km del vehículo suben con el inventario', v.km_actual, 123456::numeric);
end $$;

do $$ declare v record; begin
  -- Una lectura MENOR no puede pisar la buena.
  perform tc_inventario_inicial_finalizar('00000000-0000-0000-0000-00000000000a', 5, 'manual');
  select * into v from tc_vehiculos where id='00000000-0000-0000-0000-00000000000a';
  perform prueba('un kilometraje menor NO pisa el que ya había', v.km_actual, 123456::numeric);
end $$;

do $$ declare n int; begin
  select count(*) into n from movimientos_stock;
  perform prueba('al terminar el inventario entero, el stock sigue sin moverse', n, 0);
end $$;

-- Permisos
update auth_ctx set rol = 'cliente';
do $$ begin
  begin
    perform tc_inventario_inicial_posicion('00000000-0000-0000-0000-00000000000a', posicion(1),
      '00000000-0000-0000-0000-0000000000d1', '{"profundidad_mm":"8"}'::jsonb);
    raise notice 'FALLA · un usuario sin permiso ha podido inventariar';
  exception when others then
    if SQLERRM like '%Sin permiso%' then raise notice 'PASA · un usuario sin permiso no inventaría';
    else raise notice 'FALLA · %', SQLERRM; end if;
  end;
end $$;
