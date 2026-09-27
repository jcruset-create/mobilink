-- Reproduccion de laboratorio de las vistas de produccion y de las politicas
-- REALES de sus tablas base (fotografias del 2026-09-26 y 2026-09-27).
--
-- Solo se reproducen las 5 vistas cuya definicion devolvio produccion. Las 9
-- restantes se crearon a mano en el dashboard y su definicion no esta en el
-- repositorio: quedan NO VERIFICADAS.
--
-- Las funciones de autorizacion se dejan parametrizables por GUC para poder
-- probar los dos lados (admin y no admin) sin tocar nada.

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;

-- ── Tablas base, con las columnas que las vistas seleccionan ───────────────
create table if not exists clientes (
  id uuid primary key default gen_random_uuid(), empresa_id uuid, codigo text,
  nombre text, nif text, telefono text, email text, activo boolean default true);
create table if not exists productos_neumaticos (
  id uuid primary key default gen_random_uuid(), empresa_id uuid, marca text,
  modelo text, medida text, dot text, activo boolean default true);
create table if not exists adm_customers (
  id uuid primary key default gen_random_uuid(), name text);
create table if not exists adm_work_orders (
  id uuid primary key default gen_random_uuid(), ot_number text, vehicle_plate text,
  status text, center text, created_at timestamptz default now(), customer_id uuid);
create table if not exists traspasos (
  id uuid primary key default gen_random_uuid(), codigo text, estado text);
create table if not exists traspasos_auditoria (
  id uuid primary key default gen_random_uuid(), traspaso_id uuid, accion text,
  codigo_personal text, estado_anterior text, estado_nuevo text,
  created_at timestamptz default now());
create table if not exists tc_cat_marcas_neumatico (
  id uuid primary key default gen_random_uuid(), nombre text, activo boolean default true);
create table if not exists tc_cat_modelos_neumatico (
  id uuid primary key default gen_random_uuid(), marca_id uuid, activo boolean default true);
create table if not exists tc_neumaticos (
  id uuid primary key default gen_random_uuid(), marca text, vehiculo_id uuid);

-- ── Las funciones de autorizacion, conmutables para probar los dos lados ───
create or replace function tc_is_admin() returns boolean language sql stable as $$
  select coalesce(current_setting('prueba.tc_admin', true) = '1', false) $$;
create or replace function usuario_actual_es_admin() returns boolean language sql stable as $$
  select coalesce(current_setting('prueba.almacen_admin', true) = '1', false) $$;
create or replace function usuario_actual_perfil_id() returns uuid language sql stable as $$
  select nullif(current_setting('prueba.perfil_id', true), '')::uuid $$;
create or replace function adm_can_read() returns boolean language sql stable as $$
  select coalesce(current_setting('prueba.adm_read', true) = '1', false) $$;
create or replace function adm_can_manage() returns boolean language sql stable as $$
  select coalesce(current_setting('prueba.adm_manage', true) = '1', false) $$;
create or replace function tc_is_superadmin() returns boolean language sql stable as $$
  select coalesce(current_setting('prueba.tc_super', true) = '1', false) $$;

-- El defecto de Supabase, tambien para las tablas FUTURAS: es lo que hace que
-- la lista de tablas abiertas crezca sola. Se reproduce aqui para poder
-- comprobar que 005 NO lo toca (lo hace la Fase D, que es donde corresponde).
alter default privileges in schema public grant all on tables to anon, authenticated;

-- ── El defecto de Supabase: CRUD a anon y authenticated en todo ────────────
do $$ declare t text; begin
  for t in select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
            where n.nspname='public' and c.relkind='r' loop
    execute format('grant select, insert, update, delete on public.%I to anon, authenticated', t);
  end loop;
end $$;

-- ── Las politicas REALES, copiadas de la fotografia ────────────────────────
alter table clientes enable row level security;
drop policy if exists clientes_select_permitidos_o_admin on clientes;
create policy clientes_select_permitidos_o_admin on clientes for select to authenticated
  using (usuario_actual_es_admin());
drop policy if exists clientes_insert_admin on clientes;
create policy clientes_insert_admin on clientes for insert to authenticated
  with check (usuario_actual_es_admin());
drop policy if exists clientes_update_admin on clientes;
create policy clientes_update_admin on clientes for update to authenticated
  using (usuario_actual_es_admin());
drop policy if exists clientes_delete_admin on clientes;
create policy clientes_delete_admin on clientes for delete to authenticated
  using (usuario_actual_es_admin());
-- Ojo: clientes NO tiene ninguna politica para anon.

alter table productos_neumaticos enable row level security;
drop policy if exists anon_read_productos on productos_neumaticos;
create policy anon_read_productos on productos_neumaticos for select to anon using (true);
drop policy if exists productos_select_autenticado on productos_neumaticos;
create policy productos_select_autenticado on productos_neumaticos for select to authenticated
  using (usuario_actual_perfil_id() is not null);
drop policy if exists productos_insert_admin on productos_neumaticos;
create policy productos_insert_admin on productos_neumaticos for insert to authenticated
  with check (usuario_actual_es_admin());

alter table adm_customers enable row level security;
drop policy if exists adm_customers_select on adm_customers;
create policy adm_customers_select on adm_customers for select to public using (adm_can_read());
drop policy if exists adm_customers_write on adm_customers;
create policy adm_customers_write on adm_customers for all to public
  using (adm_can_manage()) with check (adm_can_manage());

alter table adm_work_orders enable row level security;
drop policy if exists adm_work_orders_select on adm_work_orders;
create policy adm_work_orders_select on adm_work_orders for select to public using (adm_can_read());
drop policy if exists adm_work_orders_write on adm_work_orders;
create policy adm_work_orders_write on adm_work_orders for all to public
  using (adm_can_manage()) with check (adm_can_manage());

alter table traspasos enable row level security;
drop policy if exists anon_read_traspasos on traspasos;
create policy anon_read_traspasos on traspasos for select to anon using (true);
drop policy if exists anon_insert_traspasos on traspasos;
create policy anon_insert_traspasos on traspasos for insert to anon with check (true);
drop policy if exists anon_update_traspasos on traspasos;
create policy anon_update_traspasos on traspasos for update to anon using (true) with check (true);

alter table traspasos_auditoria enable row level security;
drop policy if exists anon_read_auditoria on traspasos_auditoria;
create policy anon_read_auditoria on traspasos_auditoria for select to anon using (true);
drop policy if exists anon_insert_auditoria on traspasos_auditoria;
create policy anon_insert_auditoria on traspasos_auditoria for insert to anon with check (true);

alter table tc_cat_marcas_neumatico enable row level security;
drop policy if exists tc_cat_marcas_select on tc_cat_marcas_neumatico;
create policy tc_cat_marcas_select on tc_cat_marcas_neumatico for select to public
  using (auth.uid() is not null);
alter table tc_cat_modelos_neumatico enable row level security;
alter table tc_neumaticos enable row level security;

-- ── Las 5 vistas, con la definicion EXACTA que devolvio produccion ─────────
create or replace view adm_ot_estado as
  select wo.id, wo.ot_number, wo.vehicle_plate, wo.status, wo.center, wo.created_at,
         c.name as customer_name
    from adm_work_orders wo join adm_customers c on c.id = wo.customer_id;
create or replace view tc_clientes_almacen as
  select id, empresa_id as empresa_id_almacen, codigo, nombre, nif, telefono, email, activo
    from clientes where tc_is_admin();
create or replace view tc_productos_almacen as
  select id, empresa_id as empresa_id_almacen, marca, modelo, medida, dot, activo
    from productos_neumaticos p where tc_is_admin();
create or replace view tc_marcas_contadores as
  select id,
    (select count(*) from tc_cat_modelos_neumatico mo where mo.marca_id = m.id and mo.activo) as num_modelos,
    (select count(*) from tc_neumaticos n where n.marca = m.nombre) as num_neumaticos,
    (select count(distinct n.vehiculo_id) from tc_neumaticos n
      where n.marca = m.nombre and n.vehiculo_id is not null) as num_vehiculos
   from tc_cat_marcas_neumatico m;
create or replace view traspasos_auditoria_detalle as
  select a.id, a.traspaso_id, a.accion, a.codigo_personal, a.estado_anterior,
         a.estado_nuevo, a.created_at, t.codigo as traspaso_codigo
    from traspasos_auditoria a left join traspasos t on t.id = a.traspaso_id;

-- Las vistas nacen sin grants; produccion las tiene con CRUD para los dos roles.
grant select, insert, update, delete on adm_ot_estado, tc_clientes_almacen,
  tc_productos_almacen, tc_marcas_contadores, traspasos_auditoria_detalle
  to anon, authenticated;

-- ── Datos de prueba ────────────────────────────────────────────────────────
insert into clientes (codigo,nombre,nif,telefono,email)
  select 'C1','Cliente Real','B12345678','600111222','c@ejemplo.es'
  where not exists (select 1 from clientes);
insert into adm_customers (id,name)
  select '00000000-0000-4000-a000-000000000001','Cliente OT'
  where not exists (select 1 from adm_customers);
insert into adm_work_orders (ot_number,vehicle_plate,status,center,customer_id)
  select 'OT-1','1234ABC','abierta','Tarragona','00000000-0000-4000-a000-000000000001'
  where not exists (select 1 from adm_work_orders);
insert into traspasos (id,codigo,estado)
  select '00000000-0000-4000-b000-000000000001','TR-1','en_camino'
  where not exists (select 1 from traspasos);
insert into traspasos_auditoria (traspaso_id,accion,codigo_personal,estado_anterior,estado_nuevo)
  select '00000000-0000-4000-b000-000000000001','aceptacion_transporte','OPER-4471','preparado','en_camino'
  where not exists (select 1 from traspasos_auditoria);
insert into productos_neumaticos (marca,modelo,medida)
  select 'Michelin','X','315/80R22.5' where not exists (select 1 from productos_neumaticos);
-- Sin esta fila, tc_marcas_contadores devolvia 0 y parecia protegida cuando solo
-- estaba vacia. Un cero ambiguo no es una prueba.
insert into tc_cat_marcas_neumatico (id,nombre)
  select '00000000-0000-4000-c000-000000000001','Michelin'
  where not exists (select 1 from tc_cat_marcas_neumatico);

-- ── Las otras nueve vistas, con la definicion EXACTA de produccion ────────
-- (inventario del 2026-09-27). Hacen falta tablas base adicionales.
create table if not exists centros (id uuid primary key default gen_random_uuid(), nombre text);
create table if not exists movimientos_stock (
  id uuid primary key default gen_random_uuid(), empresa_id uuid, tipo text, cantidad int,
  documento_referencia text, observaciones text, created_at timestamptz default now(),
  centro_origen_id uuid, centro_destino_id uuid, cliente_id uuid, producto_id uuid, estado text);
create table if not exists traspaso_lineas (
  id uuid primary key default gen_random_uuid(), traspaso_id uuid, producto_id uuid,
  cantidad_enviada int, cantidad_recibida int);
create table if not exists tc_tipos_vehiculo (
  id uuid primary key default gen_random_uuid(), nombre text, descripcion text,
  configuracion_ejes text, activo boolean default true);
create table if not exists tc_posiciones_vehiculo (
  id uuid primary key default gen_random_uuid(), tipo_vehiculo_id uuid, eje int, activo boolean default true);
create table if not exists tc_cat_aplicaciones_neumatico (codigo text primary key);
create or replace function tc_ruedas_de_configuracion(p text) returns int[]
  language sql immutable as $$ select array[2,4] $$;

alter table traspasos add column if not exists recibido_at timestamptz;
alter table traspasos add column if not exists created_at timestamptz default now();
alter table traspasos add column if not exists tipo_entrega text;
alter table traspasos add column if not exists origen_id uuid;
alter table traspasos add column if not exists destino_id uuid;
alter table tc_cat_modelos_neumatico add column if not exists nombre text;
alter table tc_cat_modelos_neumatico add column if not exists aplicacion text;

create or replace view kpis_traspasos as
 select count(*) filter (where (estado = 'preparado'::text)) as pendientes_recogida,
    count(*) filter (where (estado = 'en_camino'::text)) as en_camino,
    count(*) filter (where ((estado = 'recibido'::text) and ((recibido_at)::date = current_date))) as recibidos_hoy,
    count(*) filter (where ((estado = 'recibido'::text) and (recibido_at >= (now() - '30 days'::interval)))) as recibidos_30_dias
   from traspasos;

create or replace view movimientos_stock_detalle as
 select m.id, m.tipo, m.cantidad, m.documento_referencia, m.observaciones, m.created_at,
    co.nombre as centro_origen_nombre, cd.nombre as centro_destino_nombre,
    cl.nombre as cliente_nombre, p.marca, p.modelo, p.medida, p.dot
   from ((((movimientos_stock m
     left join centros co on ((co.id = m.centro_origen_id)))
     left join centros cd on ((cd.id = m.centro_destino_id)))
     left join clientes cl on ((cl.id = m.cliente_id)))
     left join productos_neumaticos p on ((p.id = m.producto_id)));

create or replace view stock_actual as
 select empresa_id, coalesce(centro_destino_id, centro_origen_id) as centro_id,
    cliente_id, producto_id,
    (sum(case when (centro_destino_id is not null) then cantidad else (- cantidad) end))::integer as stock
   from movimientos_stock
  where (coalesce(estado, 'confirmado'::text) = 'confirmado'::text)
  group by empresa_id, coalesce(centro_destino_id, centro_origen_id), cliente_id, producto_id;

create or replace view stock_actual_detalle as
 select s.empresa_id, s.centro_id, s.cliente_id, s.producto_id, s.stock,
    c.nombre as centro_nombre, cl.nombre as cliente_nombre, p.marca, p.modelo, p.medida, p.dot
   from (((stock_actual s
     left join centros c on ((c.id = s.centro_id)))
     left join clientes cl on ((cl.id = s.cliente_id)))
     left join productos_neumaticos p on ((p.id = s.producto_id)))
  where (s.stock > 0);

create or replace view tc_modelos_aplicacion_sin_clasificar as
 select m.id, m.nombre, k.nombre as marca, m.aplicacion
   from (tc_cat_modelos_neumatico m
     left join tc_cat_marcas_neumatico k on ((k.id = m.marca_id)))
  where ((m.aplicacion is not null) and (not (m.aplicacion in (select tc_cat_aplicaciones_neumatico.codigo from tc_cat_aplicaciones_neumatico))));

create or replace view tc_tipos_plano_descuadrado as
 select nombre, descripcion, configuracion_ejes,
    ((select sum(x.x) from unnest(tc_ruedas_de_configuracion(t.configuracion_ejes)) x(x)))::integer as ruedas_segun_la_etiqueta,
    ((select count(*) from tc_posiciones_vehiculo p where ((p.tipo_vehiculo_id = t.id) and p.activo and (p.eje is not null))))::integer as ruedas_en_el_plano
   from tc_tipos_vehiculo t
  where (activo and (tc_ruedas_de_configuracion(configuracion_ejes) is not null)
    and (exists (select 1 from tc_posiciones_vehiculo p where ((p.tipo_vehiculo_id = t.id) and p.activo and (p.eje is not null))))
    and (((select sum(x.x) from unnest(tc_ruedas_de_configuracion(t.configuracion_ejes)) x(x)))::integer
         <> (select count(*) from tc_posiciones_vehiculo p where ((p.tipo_vehiculo_id = t.id) and p.activo and (p.eje is not null)))));

create or replace view traspasos_detalle as
 select t.id, coalesce(t.codigo, ('TR-'::text || upper("left"((t.id)::text, 8)))) as codigo,
    t.tipo_entrega, t.estado, t.created_at,
    coalesce(co.nombre, 'Origen no informado'::text) as origen_nombre,
    coalesce(cd.nombre, 'Destino no informado'::text) as destino_nombre
   from ((traspasos t
     left join centros co on ((co.id = t.origen_id)))
     left join centros cd on ((cd.id = t.destino_id)));

create or replace view traspasos_lineas_detalle as
 select tl.id, tl.traspaso_id, tl.producto_id, tl.cantidad_enviada, tl.cantidad_recibida,
    p.marca, p.modelo, p.medida
   from (traspaso_lineas tl
     left join productos_neumaticos p on ((p.id = tl.producto_id)));

create or replace view traspasos_resumen_lineas as
 select tl.traspaso_id, coalesce(sum(tl.cantidad_enviada), (0)::bigint) as cantidad_total,
    string_agg(distinct concat(pn.medida, ' - ', pn.marca,
      case when (pn.modelo is not null) then (' '::text || pn.modelo) else ''::text end), ', '::text) as medidas
   from (traspaso_lineas tl
     left join productos_neumaticos pn on ((pn.id = tl.producto_id)))
  group by tl.traspaso_id;

grant select, insert, update, delete on kpis_traspasos, movimientos_stock_detalle,
  stock_actual, stock_actual_detalle, tc_modelos_aplicacion_sin_clasificar,
  tc_tipos_plano_descuadrado, traspasos_detalle, traspasos_lineas_detalle,
  traspasos_resumen_lineas to anon, authenticated;

insert into tc_tipos_vehiculo (id,nombre,configuracion_ejes)
  select '00000000-0000-4000-d000-000000000001','Rigido','2+4'
  where not exists (select 1 from tc_tipos_vehiculo);
insert into tc_posiciones_vehiculo (tipo_vehiculo_id,eje)
  select '00000000-0000-4000-d000-000000000001',1
  where not exists (select 1 from tc_posiciones_vehiculo);

-- ── RLS y politicas REALES de las tablas base de las nueve vistas nuevas ───
-- Sin esto, la columna «acceso directo» de la matriz no vale nada: una tabla
-- sin RLS deja pasar a anon y parece que la vista no aporta bypass cuando en
-- realidad es que el laboratorio no reproducia la proteccion.
--
-- `centros` y `traspaso_lineas` NO llevan RLS: en produccion tampoco.

alter table tc_tipos_vehiculo enable row level security;
drop policy if exists tc_tipos_select on tc_tipos_vehiculo;
create policy tc_tipos_select on tc_tipos_vehiculo for select to public using (auth.uid() is not null);
drop policy if exists tc_tipos_write on tc_tipos_vehiculo;
create policy tc_tipos_write on tc_tipos_vehiculo for all to public
  using (tc_is_superadmin()) with check (tc_is_superadmin());

alter table tc_posiciones_vehiculo enable row level security;
drop policy if exists tc_posiciones_select on tc_posiciones_vehiculo;
create policy tc_posiciones_select on tc_posiciones_vehiculo for select to public using (auth.uid() is not null);

alter table tc_cat_modelos_neumatico enable row level security;
drop policy if exists tc_cat_modelos_select on tc_cat_modelos_neumatico;
create policy tc_cat_modelos_select on tc_cat_modelos_neumatico for select to public using (auth.uid() is not null);

alter table tc_cat_aplicaciones_neumatico enable row level security;
drop policy if exists aplicaciones_lectura on tc_cat_aplicaciones_neumatico;
create policy aplicaciones_lectura on tc_cat_aplicaciones_neumatico for select to public using (true);

alter table movimientos_stock enable row level security;
drop policy if exists anon_read_movimientos on movimientos_stock;
create policy anon_read_movimientos on movimientos_stock for select to anon using (true);
drop policy if exists anon_insert_movimientos on movimientos_stock;
create policy anon_insert_movimientos on movimientos_stock for insert to anon with check (true);

-- Datos semilla del almacen. El orden importa: `centros` antes que el
-- movimiento, porque si centro_destino_id queda nulo el stock sale negativo y
-- `stock_actual_detalle` devuelve cero filas, que parece proteccion y es un
-- error de los datos de prueba.
insert into centros (id,nombre) select '00000000-0000-4000-f000-000000000001','Tarragona'
  where not exists (select 1 from centros);
insert into movimientos_stock (empresa_id,tipo,cantidad,centro_destino_id,cliente_id,producto_id,
    estado,documento_referencia,observaciones)
  select gen_random_uuid(),'entrada',10,'00000000-0000-4000-f000-000000000001',
    (select id from clientes limit 1),(select id from productos_neumaticos limit 1),
    'confirmado','ALB-1','nota interna'
  where not exists (select 1 from movimientos_stock);
insert into traspaso_lineas (traspaso_id,producto_id,cantidad_enviada)
  select (select id from traspasos limit 1),(select id from productos_neumaticos limit 1),5
  where not exists (select 1 from traspaso_lineas);
insert into tc_cat_aplicaciones_neumatico (codigo) select 'DIR'
  where not exists (select 1 from tc_cat_aplicaciones_neumatico);
insert into tc_cat_modelos_neumatico (marca_id,nombre,aplicacion,activo)
  select (select id from tc_cat_marcas_neumatico limit 1),'M1','DESCONOCIDA',true
  where not exists (select 1 from tc_cat_modelos_neumatico);
update traspasos set estado='preparado', tipo_entrega='directa' where estado is null;
