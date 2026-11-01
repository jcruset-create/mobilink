\set ON_ERROR_STOP on
-- ⛔ ESTO NO ES UNA MIGRACIÓN. NO LO PEGUES EN SUPABASE.
do $$ begin
  if exists (select 1 from pg_tables where schemaname='public' and tablename='tc_vehiculos') then
    raise exception 'ESTE FICHERO NO ES UNA MIGRACIÓN: banco desechable y esta base ya tiene TyreControl.';
  end if;
end $$;

-- ============================================================
-- Banco para tyrecontrol_importacion_historico.sql
--
-- Lo que se comprueba:
--   · la simulación no escribe NADA (ni filas ni numeración);
--   · B2_26/4905: 1 intervención, 4 operaciones (2 nuevas eje 1 deducido,
--     2 usadas sin posición), 3 servicios, 10 líneas; km en la operación y
--     en la intervención, NUNCA en el vehículo;
--   · 6 nuevas de una referencia → 2 al eje 1 y 4 al eje 2; dos referencias
--     → sin posición; plano sin ejes compatibles → sin posición;
--   · ni montajes actuales, ni neumáticos, ni stock, ni revisiones se tocan;
--   · recargar = ya presente; otra huella = cambiado, sin sobrescribir;
--   · vehículo inexistente / de otra empresa → bloqueado;
--   · duplicado probable con una intervención del taller → no se importa,
--     salvo forzar_docs;
--   · permisos: solo admin de la empresa o superadmin;
--   · el histórico se reconoce por importacion_lote_id, no por source;
--   · deshacer: bloqueado si hay cambios (anulada, adjunto, servicio añadido),
--     parcial con p_excluir (queda «parcialmente_deshecho»), completo deja
--     todo como estaba;
--   · un lote que falla a medias no deja nada.
-- ============================================================

create extension if not exists pgcrypto;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
do $$ begin create role anon; exception when duplicate_object then null; end $$;

create schema if not exists auth;
create table auth_ctx (quien uuid, rol text, empresa uuid);
insert into auth_ctx values ('00000000-0000-0000-0000-0000000000aa', 'admin', '00000000-0000-0000-0000-0000000000e1');
create or replace function auth.uid() returns uuid language sql stable as $$ select quien from auth_ctx limit 1 $$;
create or replace function tc_is_superadmin() returns boolean language sql stable as $$ select (select rol from auth_ctx limit 1) = 'superadmin' $$;
create or replace function tc_is_admin() returns boolean language sql stable as $$ select (select rol from auth_ctx limit 1) = 'admin' $$;
create or replace function tc_auth_empresa_id() returns uuid language sql stable as $$ select empresa from auth_ctx limit 1 $$;
create or replace function tc_puede_ver_empresa(e uuid) returns boolean language sql stable as $$ select true $$;

-- ── El esquema mínimo de TyreControl que toca la importación ────────────────
create table tc_empresas (id uuid primary key, nombre text);
create table tc_usuarios (id uuid primary key);
create table tc_tipos_vehiculo (id uuid primary key default gen_random_uuid(), nombre text unique);
create table tc_posiciones_vehiculo (
  id uuid primary key default gen_random_uuid(), tipo_vehiculo_id uuid references tc_tipos_vehiculo(id),
  codigo_posicion text, eje int, lado text, interior_exterior text, orden_visual int default 0, activo boolean default true,
  unique (tipo_vehiculo_id, codigo_posicion));
create table tc_vehiculos (
  id uuid primary key default gen_random_uuid(), empresa_id uuid references tc_empresas(id),
  tipo_vehiculo_id uuid references tc_tipos_vehiculo(id), matricula text not null, km_actual numeric not null default 0,
  origen_km text default 'manual', activo boolean default true, unique (empresa_id, matricula));
-- Ficha de neumático: las columnas que de verdad usa la fase 2.
create table tc_neumaticos (id uuid primary key default gen_random_uuid(), empresa_id uuid not null,
  numero_interno text not null, codigo_interno text, numero_serie text, dot text, rfid_epc text,
  marca text, modelo text, medida text,
  estado text not null default 'almacen' check (estado in ('almacen','reservado','montado','reparacion','descartado',
    'stock_nuevo','stock_usado','stock_recauchutado','pendiente_desmontaje','pendiente_reparacion','en_reparacion',
    'pendiente_recauchutado','en_recauchutado','cuarentena','pendiente_clasificacion','pendiente_validar',
    'pendiente_reciclaje','no_localizado','vendido','extraviado')),
  activo boolean not null default true, vehiculo_id uuid, posicion_id uuid,
  origen text, creado_automaticamente boolean not null default false, control_individual boolean not null default false,
  fecha_compra date, coste_compra numeric,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (numero_interno));
-- El generador de la casa, igual que en tyrecontrol_fase8_operaciones.sql.
create table tc_cat_marcas_neumatico (id uuid primary key default gen_random_uuid(), nombre text);
create table tc_cat_modelos_neumatico (id uuid primary key default gen_random_uuid(), marca_id uuid, activo boolean default true);
create table tc_contadores_numero_interno (anio int primary key, ultimo int not null default 0);
create or replace function tc_generar_numero_interno() returns text language plpgsql as $$
declare v_anio int; v_sig int;
begin
  v_anio := extract(year from now())::int;
  insert into tc_contadores_numero_interno (anio, ultimo) values (v_anio, 1)
    on conflict (anio) do update set ultimo = tc_contadores_numero_interno.ultimo + 1 returning ultimo into v_sig;
  return 'NT-' || v_anio || '-' || lpad(v_sig::text, 6, '0');
end $$;
create table tc_montajes_actuales (id uuid primary key default gen_random_uuid(), empresa_id uuid, vehiculo_id uuid, posicion_id uuid, neumatico_id uuid);
create table tc_historial_montajes (id uuid primary key default gen_random_uuid(), vehiculo_id uuid, neumatico_id uuid);
create table movimientos_stock (id uuid primary key default gen_random_uuid(), cantidad int);
create table revisiones_vehiculo (id uuid primary key default gen_random_uuid(), empresa_id uuid, vehiculo_id uuid, fecha_revision date);
create table revisiones_neumaticos_detalle (id uuid primary key default gen_random_uuid(), revision_id uuid, neumatico_id uuid);
create table tc_incidencias (id uuid primary key default gen_random_uuid(), neumatico_id uuid);

create table tc_intervenciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references tc_empresas(id),
  vehiculo_id uuid references tc_vehiculos(id) on delete set null,
  fecha date not null default current_date,
  tecnico_id uuid references tc_usuarios(id),
  resumen text, resumen_ia text, observaciones text,
  n_operaciones int not null default 0, n_neumaticos int,
  numero text, cerrada_at timestamptz default now(), inicio_at timestamptz, fin_at timestamptz,
  mecanico_km numeric, lugar_servicio text,
  created_at timestamptz not null default now());
create unique index idx_interv_numero on tc_intervenciones (numero);

create sequence tc_operaciones_numero_seq;
create table operaciones_neumaticos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references tc_empresas(id),
  vehiculo_id uuid references tc_vehiculos(id) on delete set null,
  neumatico_id uuid references tc_neumaticos(id) on delete set null,
  intervencion_id uuid references tc_intervenciones(id) on delete set null,
  tipo_operacion text not null,
  posicion_origen_id uuid references tc_posiciones_vehiculo(id),
  posicion_destino_id uuid references tc_posiciones_vehiculo(id),
  montaje_destino_id uuid, km_vehiculo numeric,
  fecha_operacion date not null default current_date,
  motivo text, estado_anterior text, estado_nuevo text, destino text, observaciones text,
  numero_operacion bigint default nextval('tc_operaciones_numero_seq'),
  status text not null default 'completada', source text not null default 'desktop_web',
  is_anulada boolean not null default false, is_correccion boolean not null default false,
  operacion_anulada_id uuid references operaciones_neumaticos(id) on delete set null,
  operacion_prevista_id uuid references operaciones_neumaticos(id) on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
-- Los mismos triggers que en producción, para comprobar que no estorban.
create or replace function tc_op_valida_transicion() returns trigger language plpgsql as $$ begin
  if old.status = 'completada' and new.status <> 'anulada' then raise exception 'TRANSICION_ILEGAL'; end if; return new; end $$;
create trigger trg_op_valida_transicion before update of status on operaciones_neumaticos
  for each row when (old.status is distinct from new.status) execute function tc_op_valida_transicion();

create table tc_cat_servicios (codigo text primary key, nombre text, unidad text default 'unidad');
insert into tc_cat_servicios (codigo, nombre) values ('desmontar_montar_cubierta','Desmontar/Montar cubierta'),('quitar_poner_rueda','Quitar y poner rueda'),('equilibrado','Equilibrados'),('valvulas','Válvulas');
create table tc_intervencion_servicios (
  id uuid primary key default gen_random_uuid(),
  intervencion_id uuid not null references tc_intervenciones(id) on delete cascade,
  servicio text not null references tc_cat_servicios(codigo),
  cantidad numeric not null check (cantidad > 0), observaciones text,
  created_at timestamptz not null default now(), unique (intervencion_id, servicio));
create table tc_operacion_adjuntos (id uuid primary key default gen_random_uuid(), operacion_id uuid references operaciones_neumaticos(id) on delete cascade, file_url text);
create table tc_operacion_movimientos (id uuid primary key default gen_random_uuid(), operacion_id uuid references operaciones_neumaticos(id) on delete cascade, neumatico_id uuid);
create table tc_operacion_estado_historial (id uuid primary key default gen_random_uuid(), operacion_id uuid references operaciones_neumaticos(id) on delete cascade);
create table tc_operacion_auditoria (id uuid primary key default gen_random_uuid(), operacion_id uuid references operaciones_neumaticos(id) on delete set null, accion text, datos_anteriores jsonb, datos_nuevos jsonb, motivo text, created_at timestamptz default now());
create table autorizaciones_operaciones (id uuid primary key default gen_random_uuid(), operacion_id uuid references operaciones_neumaticos(id) on delete set null);
create table tc_reservas_neumatico (id uuid primary key default gen_random_uuid(), operacion_id uuid references operaciones_neumaticos(id) on delete set null, neumatico_id uuid, status text default 'activa', liberado_at timestamptz, liberado_por uuid, motivo_liberacion text);
create table tc_partes_guiados (clave uuid primary key, intervencion_id uuid references tc_intervenciones(id) on delete cascade);
create table tc_incidencia_problemas (id uuid primary key default gen_random_uuid(), operacion_id uuid references operaciones_neumaticos(id));
create table tc_incidencia_operaciones (id uuid primary key default gen_random_uuid(), operacion_neumatico_id uuid references operaciones_neumaticos(id));

create or replace function prueba(nombre text, obtenido anyelement, espera anyelement) returns void
language plpgsql as $$ begin
  if obtenido is not distinct from espera then raise notice 'PASA · %', nombre;
  else raise notice 'FALLA · % → esperaba %, dio %', nombre, espera, obtenido; end if;
end $$;

\i supabase/migrations/tyrecontrol_importacion_historico.sql
\i supabase/migrations/tyrecontrol_importacion_historico_fase2.sql
\i supabase/migrations/tyrecontrol_importacion_historico_fase3.sql

-- ── Datos ───────────────────────────────────────────────────────────────────
insert into tc_empresas values ('00000000-0000-0000-0000-0000000000e1','Plana'), ('00000000-0000-0000-0000-0000000000e2','Otra');
insert into tc_usuarios values ('00000000-0000-0000-0000-0000000000aa');
-- Autocar 2x4: eje 1 con 2 posiciones, eje 2 con 4.
insert into tc_tipos_vehiculo (id, nombre) values ('00000000-0000-0000-0000-00000000000a','autocar_2x4'), ('00000000-0000-0000-0000-00000000000b','furgo_2x2');
insert into tc_posiciones_vehiculo (tipo_vehiculo_id, codigo_posicion, eje, lado, interior_exterior, orden_visual) values
  ('00000000-0000-0000-0000-00000000000a','E1_IZQ',1,'izq',null,1), ('00000000-0000-0000-0000-00000000000a','E1_DER',1,'der',null,2),
  ('00000000-0000-0000-0000-00000000000a','E2_IZQ_EXT',2,'izq','ext',3), ('00000000-0000-0000-0000-00000000000a','E2_IZQ_INT',2,'izq','int',4),
  ('00000000-0000-0000-0000-00000000000a','E2_DER_INT',2,'der','int',5), ('00000000-0000-0000-0000-00000000000a','E2_DER_EXT',2,'der','ext',6),
  ('00000000-0000-0000-0000-00000000000b','E1_IZQ',1,'izq',null,1), ('00000000-0000-0000-0000-00000000000b','E1_DER',1,'der',null,2),
  ('00000000-0000-0000-0000-00000000000b','E2_IZQ',2,'izq',null,3), ('00000000-0000-0000-0000-00000000000b','E2_DER',2,'der',null,4);
insert into tc_vehiculos (id, empresa_id, tipo_vehiculo_id, matricula, km_actual) values
  ('00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000a','7724KBM', 300000),
  ('00000000-0000-0000-0000-00000000000d','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000a','9005KMR', 500000),
  ('00000000-0000-0000-0000-00000000000e','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000b','0591JGV', 100000),
  ('00000000-0000-0000-0000-00000000000f','00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-00000000000a','1111AAA', 1);
-- Un montaje actual y una goma de verdad, para comprobar que nadie los toca.
insert into tc_neumaticos (id, empresa_id, numero_interno, codigo_interno, medida, estado) values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e1','NT-REAL-000001','NT-REAL-000001','315/80R22.5','montado');
insert into tc_montajes_actuales (empresa_id, vehiculo_id, posicion_id, neumatico_id)
  select '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000c', id, '00000000-0000-0000-0000-000000000001' from tc_posiciones_vehiculo where codigo_posicion='E1_IZQ' and tipo_vehiculo_id='00000000-0000-0000-0000-00000000000a';
insert into movimientos_stock (cantidad) values (10);
insert into revisiones_vehiculo (empresa_id, vehiculo_id, fecha_revision) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000c', '2026-10-01');

-- Fotografía de lo que NO debe cambiar.
create or replace function foto() returns text language sql as $$
  select md5(coalesce((select string_agg(m::text, '|' order by m.id) from tc_montajes_actuales m), '') || '#' ||
             coalesce((select string_agg(n::text, '|' order by n.id) from tc_neumaticos n where n.importacion_lote_id is null), '') || '#' ||
             coalesce((select string_agg(s::text, '|' order by s.id) from movimientos_stock s), '') || '#' ||
             coalesce((select string_agg(r::text, '|' order by r.id) from revisiones_vehiculo r), '') || '#' ||
             coalesce((select string_agg(h::text, '|' order by h.id) from tc_historial_montajes h), '') || '#' ||
             coalesce((select string_agg(v.id::text || v.km_actual || v.origen_km, '|' order by v.id) from tc_vehiculos v), ''))
$$;
create table _foto as select foto() as antes;

-- ── Los albaranes de prueba, como los manda el navegador ────────────────────
create or replace function alb_4905(p_huella text default 'h4905') returns jsonb language sql as $$
  select jsonb_build_object(
    'origen_doc','B2_26/4905|7724KBM','documento','B2_26/4905','matricula','7724KBM','fecha','2026-10-10','km',268659,
    'huella_origen',p_huella,'resumen','Albarán B2_26/4905 · 2 nuevas 315/80R22.5 Hankook AH51 · 2 usadas 315/80R22.5',
    'observaciones','Revisión de flota (sin mediciones) · Nº vehículo 1495','estado_documento','Pendiente',
    'operaciones', jsonb_build_array(
      jsonb_build_object('origen_linea','B2_26/4905|7724KBM|H1|M31580225N2|1|u1/2','grupo','10000000-0000-0000-0000-000000000001','condicion','nueva','marca','Hankook','modelo','AH51 156L','medida','315/80R22.5','observaciones','Salida almacén B2_26/4905 · mov. DC_0016005'),
      jsonb_build_object('origen_linea','B2_26/4905|7724KBM|H1|M31580225N2|1|u2/2','grupo','10000000-0000-0000-0000-000000000001','condicion','nueva','marca','Hankook','modelo','AH51 156L','medida','315/80R22.5','observaciones','Salida almacén B2_26/4905 · mov. DC_0016005'),
      jsonb_build_object('origen_linea','B2_26/4905|7724KBM|H1|M31580225U2|1|u1/2','grupo','10000000-0000-0000-0000-000000000002','condicion','usada','medida','315/80R22.5','observaciones','[USADO]'),
      jsonb_build_object('origen_linea','B2_26/4905|7724KBM|H1|M31580225U2|1|u2/2','grupo','10000000-0000-0000-0000-000000000002','condicion','usada','medida','315/80R22.5','observaciones','[USADO]')),
    'servicios', jsonb_build_array(
      jsonb_build_object('servicio','desmontar_montar_cubierta','cantidad',2,'grupo','10000000-0000-0000-0000-000000000011'),
      jsonb_build_object('servicio','quitar_poner_rueda','cantidad',4,'grupo','10000000-0000-0000-0000-000000000012'),
      jsonb_build_object('servicio','equilibrado','cantidad',2,'grupo','10000000-0000-0000-0000-000000000013')),
    'lineas', (select jsonb_agg(jsonb_build_object('origen_linea','B2_26/4905|7724KBM|H1|'||c||'|'||i,'hoja','H1','codigo',c,'descripcion',d,'uds',u,'precio_unidad',pu,'pct_dto',dto,'importe_linea',pt,'pct_iva',21,'estado_documento','Pendiente','papel',pp,'grupo',g))
                from (values ('M31580225N2','MONTA 2 CUBIERTAS NUEVAS 315/80R22.5 AH51',1,0,0,0,'anotacion','10000000-0000-0000-0000-000000000001',1),
                             ('M31580225U2','MONTA 2 CUBIERTAS USADAS 315/80X22.5',1,0,0,0,'anotacion','10000000-0000-0000-0000-000000000002',1),
                             ('9001099990017','MONTAJE CAMION MAYOR 19.5"',2,18.54,99.99,0.0037,'mano_obra_montaje','10000000-0000-0000-0000-000000000011',1),
                             ('9001999990010','MONTAJE FIJACIÓN(QUIT.PONER)CM',4,17.14,99.99,0.0069,'mano_obra','10000000-0000-0000-0000-000000000012',1),
                             ('9001099990004','EQUILIBRADO CAMION',2,19.14,99.99,0.0038,'mano_obra','10000000-0000-0000-0000-000000000013',1),
                             ('P2815','CONTRAPESA ADHESIVA CAMION 150GR',2,3.45,0,6.9,'material',null,1),
                             ('P2820','CONTRAPESA ADHESIVA CAMION 200GR',2,4.25,0,8.5,'material',null,1),
                             ('RF','REVISION DE FLOTA',1,0.0001,0,0.0001,'revision_flota',null,1),
                             ('PLANA','NºVEHICULO:1495',1,0.01,0,0.01,'num_vehiculo',null,1)) t(c,d,u,pu,dto,pt,pp,g,i))
              || jsonb_build_array(jsonb_build_object('origen_linea','B2_26/4905|7724KBM|H2|0107092270002|DC_0016005|-2|1','hoja','H2','articulo','0107092270002','descripcion','315/80X22.5 HANKOOK AH51 156L','carcasa_mov','DC_0016005','uds',-2,'tipo_mov','salida','hora_origen','2026-10-10T09:09:12+02:00','papel','salida','grupo','10000000-0000-0000-0000-000000000001')))
$$;

-- 4310: N4 + N2 = 6 nuevas de la misma referencia → 2 al eje 1 y 4 al eje 2.
create or replace function alb_n(p_doc text, p_mat text, p_n int, p_refs int, p_cond text default 'nueva') returns jsonb language sql as $$
  select jsonb_build_object('origen_doc',p_doc||'|'||p_mat,'documento',p_doc,'matricula',p_mat,'fecha','2026-09-20','km',null,'huella_origen','h'||p_doc,
    'operaciones',(select jsonb_agg(jsonb_build_object('origen_linea',p_doc||'|'||p_mat||'|H1|M|1|u'||i||'/'||p_n,'condicion',p_cond,'marca','Hankook',
                                                       'modelo', case when p_refs = 1 or i <= p_n/2 then 'AH51' else 'DH35' end,'medida','295/80R22.5'))
                     from generate_series(1,p_n) i),
    'servicios','[]'::jsonb,'lineas','[]'::jsonb)
$$;
create or replace function lote(p_periodo text, variadic p_albs jsonb[]) returns jsonb language sql as $$
  select jsonb_build_object('periodo', p_periodo, 'fichero', 'plana.xlsx', 'albaranes', to_jsonb(p_albs))
$$;

-- ── 1. Simular no escribe nada ──────────────────────────────────────────────
do $$ declare r jsonb; seq_antes bigint; begin
  seq_antes := nextval('tc_operaciones_numero_seq');
  r := tc_importar_historico('00000000-0000-0000-0000-0000000000e1', 'genes', lote('2026-10', alb_4905()), true);
  perform prueba('simulación: 1 se crearía', (r->>'creadas')::int, 1);
  perform prueba('simulación: dice 4 operaciones, 3 servicios, 10 líneas, 2 posiciones deducidas',
    (r->'albaranes'->0->>'operaciones')||'/'||(r->'albaranes'->0->>'servicios')||'/'||(r->'albaranes'->0->>'lineas')||'/'||(r->'albaranes'->0->>'posiciones_deducidas'), '4/3/10/2');
  perform prueba('simulación: no hay intervenciones', (select count(*) from tc_intervenciones), 0::bigint);
  perform prueba('simulación: no hay cargas ni lotes', (select count(*) from tc_importacion_cargas) + (select count(*) from tc_importacion_lotes), 0::bigint);
  perform prueba('simulación: la numeración no se ha movido', nextval('tc_operaciones_numero_seq'), seq_antes + 1);
end $$;

-- ── 2. Importar B2_26/4905 ──────────────────────────────────────────────────
do $$ declare r jsonb; v uuid; begin
  r := tc_importar_historico('00000000-0000-0000-0000-0000000000e1', 'genes', lote('2026-10', alb_4905()), false);
  perform prueba('importa 1', (r->>'creadas')::int, 1);
  v := (r->'albaranes'->0->>'intervencion_id')::uuid;
  perform prueba('1 intervención cerrada, hora desconocida, con el km del albarán',
    (select cerrada_at is not null and hora_desconocida and mecanico_km = 268659 and n_operaciones = 4 and fecha = '2026-10-10' from tc_intervenciones where id = v), true);
  perform prueba('número legible sin consumir el contador', (select numero from tc_intervenciones where id = v), 'B2_26/4905 · 7724KBM');
  perform prueba('4 operaciones de montaje, completadas, con km y fecha del albarán',
    (select count(*) from operaciones_neumaticos where intervencion_id = v and tipo_operacion='montaje' and status='completada' and km_vehiculo=268659 and fecha_operacion='2026-10-10'), 4::bigint);
  perform prueba('las 2 nuevas tienen ficha con número interno NT-',
    (select count(*) from operaciones_neumaticos o join tc_neumaticos n on n.id=o.neumatico_id
      where o.intervencion_id=v and o.condicion='nueva' and n.numero_interno like 'NT-%' and n.identidad_reconstruida), 2::bigint);
  perform prueba('las 2 usadas siguen sin ficha',
    (select count(*) from operaciones_neumaticos where intervencion_id=v and condicion='usada' and neumatico_id is null), 2::bigint);
  perform prueba('4 salidas por sustitución, enlazadas y sin identidad',
    (select count(*) from operaciones_neumaticos where intervencion_id=v and tipo_operacion='desmontaje'
       and estado_anterior='montado' and neumatico_id is null and identidad_retirado='desconocida'
       and grupo_sustitucion is not null and destino is null), 4::bigint);
  perform prueba('cada entrada tiene exactamente una salida con su grupo',
    (select bool_and(n=2) from (select grupo_sustitucion g, count(*) n from operaciones_neumaticos
       where intervencion_id=v and grupo_sustitucion is not null group by 1) x), true);
  perform prueba('la ficha histórica no está disponible para montar ni montada',
    (select bool_and(estado='pendiente_clasificacion' and vehiculo_id is null and posicion_id is null and activo
                     and not control_individual and numero_serie is null and dot is null and rfid_epc is null
                     and fecha_compra is null and coste_compra is null)
       from tc_neumaticos where importacion_lote_id is not null), true);
  perform prueba('2 nuevas en el eje 1, deducidas',
    (select string_agg(p.codigo_posicion, ',' order by p.codigo_posicion) from operaciones_neumaticos o join tc_posiciones_vehiculo p on p.id=o.posicion_destino_id where o.intervencion_id=v and o.condicion='nueva' and o.posicion_fuente='deducida'), 'E1_DER,E1_IZQ');
  perform prueba('2 usadas sin posición, desconocida',
    (select count(*) from operaciones_neumaticos where intervencion_id=v and condicion='usada' and posicion_destino_id is null and posicion_fuente='desconocida' and marca_txt is null and medida_txt='315/80R22.5'), 2::bigint);
  perform prueba('marca/modelo/medida en las nuevas', (select distinct marca_txt||' '||modelo_txt||' '||medida_txt from operaciones_neumaticos where intervencion_id=v and condicion='nueva'), 'Hankook AH51 156L 315/80R22.5');
  perform prueba('3 servicios con sus cantidades', (select string_agg(servicio||'='||cantidad, ',' order by servicio) from tc_intervencion_servicios where intervencion_id=v), 'desmontar_montar_cubierta=2,equilibrado=2,quitar_poner_rueda=4');
  perform prueba('10 líneas de origen con importes', (select count(*) from tc_importacion_lineas where intervencion_id=v), 10::bigint);
  perform prueba('los importes están una vez (contrapesas 15,40 €)', (select sum(importe_linea) from tc_importacion_lineas where intervencion_id=v and papel='material'), 15.4);
  perform prueba('todo lleva el vínculo importacion_lote_id',
    (select bool_and(importacion_lote_id is not null) from operaciones_neumaticos where intervencion_id=v) and (select bool_and(importacion_lote_id is not null) from tc_intervencion_servicios where intervencion_id=v) and (select importacion_lote_id is not null from tc_intervenciones where id=v), true);
  perform prueba('la fotografía tiene 4+3+10 ids', (select array_length(operacion_ids,1)||'/'||array_length(servicio_ids,1)||'/'||array_length(linea_ids,1) from tc_importacion_intervenciones where intervencion_id=v), '4/3/10');
  perform prueba('la fotografía guarda 2 fichas, 4 salidas y alcance 2',
    (select coalesce(array_length(neumatico_ids,1),0)||'/'||coalesce(array_length(salida_ids,1),0)||'/'||alcance from tc_importacion_intervenciones where intervencion_id=v), '2/4/2');
  perform prueba('km_actual del vehículo intacto', (select km_actual from tc_vehiculos where id='00000000-0000-0000-0000-00000000000c'), 300000::numeric);
  perform prueba('montajes, neumáticos, stock, revisiones y km: idénticos', foto(), (select antes from _foto));
end $$;

-- ── 3. Recarga, reordenación y documento cambiado ───────────────────────────
do $$ declare r jsonb; begin
  r := tc_importar_historico('00000000-0000-0000-0000-0000000000e1', 'genes', lote('2026-10', alb_4905()), false);
  perform prueba('recargar: ya presente, 0 creadas', (r->>'ya_presentes')||'/'||(r->>'creadas'), '1/0');
  perform prueba('recargar: sigue habiendo 1 intervención', (select count(*) from tc_intervenciones), 1::bigint);
  perform prueba('recargar sin nada nuevo no deja lotes ni cargas vacíos', (select count(*) from tc_importacion_lotes) + (select count(*) from tc_importacion_cargas), 2::bigint);
  perform prueba('la carga queda completa aunque haya bloqueados', (select estado from tc_importacion_cargas limit 1), 'completa');
  r := tc_importar_historico('00000000-0000-0000-0000-0000000000e1', 'genes', lote('2026-10', alb_4905('otra-huella')), false);
  perform prueba('huella distinta: cambiado, no sobrescribe', (r->>'cambiados')||'/'||(r->>'creadas')||'/'||(r->'albaranes'->0->>'estado'), '1/0/cambiado');
  perform prueba('cambiado: las entradas siguen siendo 4', (select count(*) from operaciones_neumaticos where tipo_operacion='montaje'), 4::bigint);
  perform prueba('recargar no crea fichas ni consume numeración',
    (select count(*) from tc_neumaticos where importacion_lote_id is not null)||'/'||(select ultimo from tc_contadores_numero_interno), '2/2');
end $$;

-- ── 4. Posiciones: 6 nuevas, dos referencias, plano incompatible ────────────
do $$ declare r jsonb; begin
  r := tc_importar_historico('00000000-0000-0000-0000-0000000000e1', 'genes',
        lote('2026-09', alb_n('B2_26/4310','9005KMR',6,1), alb_n('B2_26/4508','9005KMR',6,2), alb_n('B2_26/0591','0591JGV',4,1), alb_n('B2_26/0002','0591JGV',2,1),
             alb_n('B2_26/0003','0591JGV',6,1)), false);
  perform prueba('se crean 5', (r->>'creadas')::int, 5);
  -- 6 nuevas de una referencia en un 2x4: el vehículo entero, 2 al eje 1 y 4 al eje 2.
  perform prueba('4310: 6 nuevas → 2 al eje 1 y 4 al eje 2',
    (select string_agg(p.codigo_posicion, ',' order by p.eje, p.codigo_posicion) from operaciones_neumaticos o join tc_intervenciones i on i.id=o.intervencion_id join tc_posiciones_vehiculo p on p.id=o.posicion_destino_id where i.origen_doc='B2_26/4310|9005KMR' and o.tipo_operacion='montaje'),
    'E1_DER,E1_IZQ,E2_DER_EXT,E2_DER_INT,E2_IZQ_EXT,E2_IZQ_INT');
  perform prueba('4310: las 6 quedan marcadas como deducidas, ninguna confirmada',
    (select count(*) filter (where posicion_fuente='deducida')||'/'||count(*) from operaciones_neumaticos o join tc_intervenciones i on i.id=o.intervencion_id where i.origen_doc='B2_26/4310|9005KMR' and o.tipo_operacion='montaje'), '6/6');
  perform prueba('6 nuevas en un 2x2 (el plano no tiene 2+4) → sin posición',
    (select count(*) from operaciones_neumaticos o join tc_intervenciones i on i.id=o.intervencion_id where i.origen_doc='B2_26/0003|0591JGV' and o.tipo_operacion='montaje' and o.posicion_destino_id is null and o.posicion_fuente='desconocida'), 6::bigint);
  perform prueba('4508: dos referencias → sin posición', (select count(*) from operaciones_neumaticos o join tc_intervenciones i on i.id=o.intervencion_id where i.origen_doc='B2_26/4508|9005KMR' and o.tipo_operacion='montaje' and o.posicion_destino_id is null), 6::bigint);
  perform prueba('4 nuevas en un 2x2 (eje 2 con 2 posiciones) → sin posición', (select count(*) from operaciones_neumaticos o join tc_intervenciones i on i.id=o.intervencion_id where i.origen_doc='B2_26/0591|0591JGV' and o.tipo_operacion='montaje' and o.posicion_destino_id is null), 4::bigint);
  perform prueba('2 nuevas en un 2x2 → eje 1 deducido', (select string_agg(p.codigo_posicion, ',' order by p.codigo_posicion) from operaciones_neumaticos o join tc_intervenciones i on i.id=o.intervencion_id join tc_posiciones_vehiculo p on p.id=o.posicion_destino_id where i.origen_doc='B2_26/0002|0591JGV'), 'E1_DER,E1_IZQ');
  perform prueba('km ausente: queda null', (select bool_and(km_vehiculo is null) from operaciones_neumaticos o join tc_intervenciones i on i.id=o.intervencion_id where i.origen_doc='B2_26/4310|9005KMR'), true);
  perform prueba('ninguna posición se repite en el mismo albarán',
    (select count(*) from (select o.intervencion_id, o.posicion_destino_id from operaciones_neumaticos o where o.posicion_destino_id is not null and o.importacion_lote_id is not null group by 1,2 having count(*) > 1) d), 0::bigint);
end $$;

-- ── 5. Bloqueos: vehículo inexistente, de otra empresa, servicio raro, bloqueante del navegador ──
do $$ declare r jsonb; begin
  r := tc_importar_historico('00000000-0000-0000-0000-0000000000e1', 'genes',
        lote('2026-08', alb_n('B2_26/9001','ZZZZ999',2,1), alb_n('B2_26/9002','1111AAA',2,1),
             alb_n('B2_26/9003','7724KBM',2,1) || jsonb_build_object('bloqueante','Uds<>1 en línea M'),
             alb_n('B2_26/9004','7724KBM',2,1) || jsonb_build_object('servicios', jsonb_build_array(jsonb_build_object('servicio','inventado','cantidad',1)))), false);
  perform prueba('4 bloqueados, 0 creados', (r->>'bloqueados')||'/'||(r->>'creadas'), '4/0');
  perform prueba('matrícula inexistente', r->'albaranes'->0->>'motivo', 'Vehículo no encontrado en la empresa: ZZZZ999');
  perform prueba('vehículo de otra empresa no se encuentra', r->'albaranes'->1->>'motivo', 'Vehículo no encontrado en la empresa: 1111AAA');
  perform prueba('bloqueante del navegador se respeta', r->'albaranes'->2->>'motivo', 'Uds<>1 en línea M');
  perform prueba('servicio fuera de catálogo', r->'albaranes'->3->>'motivo', 'Servicio desconocido: inventado');
  perform prueba('el lote con errores no deja intervenciones', (select count(*) from tc_intervenciones where fecha='2026-09-20' and origen_doc like 'B2_26/900%'), 0::bigint);
end $$;

-- ── 6. Duplicado probable con una intervención del taller ───────────────────
do $$ declare r jsonb; v uuid; begin
  insert into tc_intervenciones (id, empresa_id, vehiculo_id, fecha, numero) values ('00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000d','2026-09-20','OP-2026-000001');
  insert into operaciones_neumaticos (empresa_id, vehiculo_id, intervencion_id, tipo_operacion, medida_txt, condicion) select '00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000d','00000000-0000-0000-0000-00000000d001','montaje','295/80R22.5','nueva' from generate_series(1,2);
  r := tc_importar_historico('00000000-0000-0000-0000-0000000000e1', 'genes', lote('2026-09', alb_n('B2_26/7777','9005KMR',2,1)), true);
  perform prueba('duplicado probable: no se importa', (r->>'duplicados_probables')||'/'||(r->>'creadas'), '1/0');
  r := tc_importar_historico('00000000-0000-0000-0000-0000000000e1', 'genes', lote('2026-09', alb_n('B2_26/7777','9005KMR',2,1)) || jsonb_build_object('forzar_docs', jsonb_build_array('B2_26/7777|9005KMR')), true);
  perform prueba('forzado: se crearía', (r->>'creadas')::int, 1);
  r := tc_importar_historico('00000000-0000-0000-0000-0000000000e1', 'genes', lote('2026-09', alb_n('B2_26/7778','9005KMR',4,1)), true);
  perform prueba('mismo día, distinta cantidad: no es duplicado', (r->>'creadas')::int, 1);
end $$;

-- ── 7. El histórico se reconoce por el vínculo, no por source ───────────────
do $$ begin
  insert into operaciones_neumaticos (empresa_id, vehiculo_id, intervencion_id, tipo_operacion, source) values ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000d','00000000-0000-0000-0000-00000000d001','montaje','import');
  perform prueba('una operación con source=import pero sin vínculo NO es histórico de albarán',
    (select count(*) from operaciones_neumaticos where source='import' and importacion_lote_id is null), 1::bigint);
  perform prueba('las importadas tienen vínculo', (select count(*) from operaciones_neumaticos where importacion_lote_id is not null and tipo_operacion='montaje'), 4+6+6+4+2+6::bigint);
  perform prueba('cada entrada histórica tiene su salida', (select count(*) from operaciones_neumaticos where importacion_lote_id is not null and tipo_operacion='desmontaje'), 4+6+6+4+2+6::bigint);
end $$;

-- ── 8. Permisos ─────────────────────────────────────────────────────────────
update auth_ctx set rol='operador';
do $$ begin
  perform tc_importar_historico('00000000-0000-0000-0000-0000000000e1', 'genes', lote('2026-07', alb_n('B2_26/5','7724KBM',2,1)), true);
  perform prueba('operador no puede ni simular', false, true);
exception when insufficient_privilege then perform prueba('operador no puede ni simular', true, true); end $$;
update auth_ctx set rol='admin', empresa='00000000-0000-0000-0000-0000000000e2';
do $$ begin
  perform tc_importar_historico('00000000-0000-0000-0000-0000000000e1', 'genes', lote('2026-07', alb_n('B2_26/5','7724KBM',2,1)), true);
  perform prueba('admin de otra empresa no puede', false, true);
exception when insufficient_privilege then perform prueba('admin de otra empresa no puede', true, true); end $$;
update auth_ctx set rol='admin', empresa='00000000-0000-0000-0000-0000000000e1';

-- ── 9. Deshacer: bloqueado, parcial, completo ───────────────────────────────
do $$ declare r jsonb; l uuid; v4905 uuid; v4310 uuid; op uuid; begin
  select importacion_lote_id, id into l, v4905 from tc_intervenciones where origen_doc='B2_26/4905|7724KBM';
  -- Simular no toca nada
  r := tc_deshacer_importacion(l, '{}', true);
  perform prueba('deshacer simulado: 1 borrable', (r->>'borradas')::int, 1);
  perform prueba('deshacer simulado: sigue ahí', (select count(*) from tc_intervenciones where id=v4905), 1::bigint);
  -- Cambios posteriores: anular una operación y colgar un adjunto a otra
  select id into op from operaciones_neumaticos where intervencion_id=v4905 order by origen_linea limit 1;
  update operaciones_neumaticos set status='anulada', is_anulada=true where id=op;
  insert into tc_operacion_adjuntos (operacion_id, file_url) select id, 'foto.jpg' from operaciones_neumaticos where intervencion_id=v4905 and id<>op limit 1;
  r := tc_deshacer_importacion(l, '{}', false);
  perform prueba('con cambios: 0 borradas, 1 conservada', (r->>'borradas')||'/'||(r->>'conservadas'), '0/1');
  perform prueba('motivos claros', (r->'detalle'->0->'motivos')::text like '%huella del estado no coincide%' and (r->'detalle'->0->'motivos')::text like '%adjuntos%', true);
  perform prueba('nada borrado', (select count(*) from operaciones_neumaticos where intervencion_id=v4905 and tipo_operacion='montaje'), 4::bigint);
  perform prueba('el lote queda parcialmente deshecho', (select estado from tc_importacion_lotes where id=l), 'parcialmente_deshecho');
  perform prueba('la carga queda parcialmente deshecha', (select estado from tc_importacion_cargas where id=(select carga_id from tc_importacion_lotes where id=l)), 'parcialmente_deshecha');
  perform prueba('queda constancia de por qué se conservó', (select motivo_conservada is not null and conservada_at is not null from tc_importacion_intervenciones where intervencion_id=v4905), true);

  -- El lote de septiembre: añadir un servicio a 4310 y excluirla; el resto se borra.
  select importacion_lote_id, id into l, v4310 from tc_intervenciones where origen_doc='B2_26/4310|9005KMR';
  insert into tc_intervencion_servicios (intervencion_id, servicio, cantidad) values (v4310, 'valvulas', 1);
  r := tc_deshacer_importacion(l, '{}', false);
  perform prueba('septiembre sin excluir: 4 borradas, 1 conservada (servicio añadido)', (r->>'borradas')||'/'||(r->>'conservadas'), '4/1');
  perform prueba('4310 sigue con sus 6 operaciones y su servicio', (select count(*) from operaciones_neumaticos where intervencion_id=v4310 and tipo_operacion='montaje') + (select count(*) from tc_intervencion_servicios where intervencion_id=v4310), 7::bigint);
  perform prueba('4508 y las del 2x2 ya no están', (select count(*) from tc_intervenciones where origen_doc in ('B2_26/4508|9005KMR','B2_26/0591|0591JGV','B2_26/0002|0591JGV','B2_26/0003|0591JGV')), 0::bigint);
  perform prueba('ninguna operación huérfana', (select count(*) from operaciones_neumaticos where intervencion_id is null), 0::bigint);
  -- Y deshacer con exclusión explícita no la vuelve a tocar.
  r := tc_deshacer_importacion(l, array[v4310], false);
  perform prueba('ya conservada: no se reevalúa', (r->>'borradas')||'/'||(r->>'conservadas'), '0/0');
  perform prueba('la intervención del taller y sus 3 operaciones siguen', (select count(*) from operaciones_neumaticos where intervencion_id='00000000-0000-0000-0000-00000000d001'), 3::bigint);
end $$;

-- ── 10. Deshacer completo deja la base como estaba ──────────────────────────
do $$ declare r jsonb; l uuid; begin
  r := tc_importar_historico('00000000-0000-0000-0000-0000000000e1', 'genes', lote('2026-06', alb_n('B2_26/6001','7724KBM',2,1), alb_n('B2_26/6002','0591JGV',2,1)), false);
  l := (r->>'lote_id')::uuid;
  r := tc_deshacer_importacion(l, '{}', false);
  perform prueba('completo: 2 borradas', (r->>'borradas')||'/'||(r->>'estado'), '2/deshecho');
  perform prueba('lote deshecho', (select estado from tc_importacion_lotes where id=l), 'deshecho');
  perform prueba('sin líneas ni fotografías del lote', (select count(*) from tc_importacion_lineas where lote_id=l) + (select count(*) from tc_importacion_intervenciones where lote_id=l), 0::bigint);
  perform prueba('deshacer dos veces no hace nada', (tc_deshacer_importacion(l, '{}', false)->>'borradas')::int, 0);
  perform prueba('montajes, neumáticos, stock, revisiones y km: idénticos al principio', foto(), (select antes from _foto));
end $$;

-- ── 11. Un lote que falla a medias no deja nada ─────────────────────────────
do $$ declare n_antes bigint; begin
  n_antes := (select count(*) from tc_intervenciones);
  begin
    -- El segundo albarán viola el índice único de operación (misma origen_linea que el primero).
    perform tc_importar_historico('00000000-0000-0000-0000-0000000000e1', 'genes',
      lote('2026-05', alb_n('B2_26/5001','7724KBM',2,1),
           alb_n('B2_26/5002','0591JGV',2,1) || jsonb_build_object('operaciones', alb_n('B2_26/5001','7724KBM',2,1)->'operaciones')), false);
    perform prueba('debería haber fallado', false, true);
  exception when unique_violation then
    perform prueba('el lote falla entero por el índice único', true, true);
  end;
  perform prueba('y no deja ni el primero', (select count(*) from tc_intervenciones), n_antes);
  perform prueba('ni cargas a medias', (select count(*) from tc_importacion_lotes where periodo='2026-05'), 0::bigint);
end $$;

-- ── 12. Concurrencia: dos cargas iguales se serializan por el índice único ───
-- (Sin dos sesiones en psql, se comprueba la invariante: la identidad del
-- documento es única por empresa y origen.)
do $$ begin
  begin
    insert into tc_intervenciones (empresa_id, vehiculo_id, fecha, numero, origen_sistema, origen_doc)
      values ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000c','2026-10-10','x','genes','B2_26/4905|7724KBM');
    perform prueba('dos intervenciones con la misma identidad de origen: imposible', false, true);
  exception when unique_violation then perform prueba('dos intervenciones con la misma identidad de origen: imposible', true, true); end;
end $$;

create or replace function sqlerrm_de(p uuid) returns text language plpgsql as $$
begin perform tc_anular_operacion(p, 'x'); return null; exception when others then return sqlerrm; end $$;

-- ── 13. Anular frente a deshacer ────────────────────────────────────────────
-- Una anulación normal sigue funcionando; anular una operación que deshacer
-- ya ha borrado se rechaza con un mensaje claro y no deja rastro.
do $$ declare r jsonb; l uuid; op uuid; op2 uuid; msg text; n_aud bigint; begin
  r := tc_importar_historico('00000000-0000-0000-0000-0000000000e1', 'genes', lote('2026-07', alb_n('B2_26/7001','7724KBM',2,1)), false);
  l := (r->>'lote_id')::uuid;
  select id into op from operaciones_neumaticos where importacion_lote_id=l order by origen_linea limit 1;
  select id into op2 from operaciones_neumaticos where importacion_lote_id=l and id<>op;
  insert into tc_reservas_neumatico (operacion_id) values (op);
  -- Anulación normal (el admin de auth_ctx sobre su empresa)
  perform tc_anular_operacion(op, 'prueba');
  perform prueba('anular normal: queda anulada', (select is_anulada and status='anulada' from operaciones_neumaticos where id=op), true);
  perform prueba('anular normal: auditoría con motivo', (select count(*) from tc_operacion_auditoria where operacion_id=op and accion='anular' and motivo='prueba'), 1::bigint);
  perform prueba('anular normal: reserva liberada', (select status from tc_reservas_neumatico where operacion_id=op), 'liberada');
  begin perform tc_anular_operacion(op, 'otra vez'); msg := null; exception when others then msg := sqlerrm; end;
  perform prueba('anular dos veces: rechazado', msg, 'La operación ya está anulada');
  begin perform tc_anular_operacion(op2, '  '); msg := null; exception when others then msg := sqlerrm; end;
  perform prueba('sin motivo: rechazado', msg, 'El motivo de anulación es obligatorio');
  -- La otra operación la borra deshacer (la anulada se conserva con motivo); anularla después debe decirlo.
  r := tc_deshacer_importacion(l, '{}', false);
  n_aud := (select count(*) from tc_operacion_auditoria);
  perform prueba('deshacer con una anulada: conservada', (r->>'borradas')||'/'||(r->>'conservadas'), '0/1');
  delete from operaciones_neumaticos where id=op2;  -- lo que haría deshacer sobre una fila sin cambios
  begin perform tc_anular_operacion(op2, 'tarde'); msg := null; exception when others then msg := sqlerrm; end;
  perform prueba('anular una operación que ya no existe: mensaje claro', msg, 'La operación ya no existe; no se ha realizado la anulación');
  perform prueba('y no deja auditoría huérfana', (select count(*) from tc_operacion_auditoria), n_aud);
  perform prueba('un uuid cualquiera: mismo mensaje', (select sqlerrm_de(gen_random_uuid())), 'La operación ya no existe; no se ha realizado la anulación');
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- FASE 2 · fichas, sustituciones, cadenas, bandeja, ampliación e informe
-- ════════════════════════════════════════════════════════════════════════════

-- Un albarán con fecha y km a elegir, para montar cronologías.
create or replace function alb_fk(p_doc text, p_mat text, p_n int, p_fecha date, p_km numeric, p_cond text default 'nueva')
returns jsonb language sql as $$
  select jsonb_build_object('origen_doc',p_doc||'|'||p_mat,'documento',p_doc,'matricula',p_mat,'fecha',p_fecha,'km',p_km,
    'huella_origen','h'||p_doc,
    'operaciones',(select jsonb_agg(jsonb_build_object('origen_linea',p_doc||'|'||p_mat||'|H1|M|1|u'||i||'/'||p_n,
       'condicion',p_cond,'marca','Hankook','modelo','AH51','medida','295/80R22.5')) from generate_series(1,p_n) i),
    'servicios','[]'::jsonb,'lineas','[]'::jsonb)
$$;

-- Vehículo limpio para las cadenas (2x4) y borrón de lo anterior.
do $$ begin
  delete from tc_reconstruccion_montajes;
  delete from tc_importacion_lineas; delete from tc_importacion_intervenciones;
  delete from tc_operacion_adjuntos; delete from operaciones_neumaticos where importacion_lote_id is not null;
  delete from tc_intervencion_servicios where importacion_lote_id is not null;
  delete from tc_intervenciones where importacion_lote_id is not null;
  delete from tc_neumaticos where importacion_lote_id is not null;
  delete from tc_importacion_lotes; delete from tc_importacion_cargas; delete from tc_importacion_eventos;
  insert into tc_vehiculos (id, empresa_id, tipo_vehiculo_id, matricula, km_actual)
    values ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000a','CADENA01', 999999)
    on conflict do nothing;
end $$;

-- ── 14. Cadena limpia: nuevo → nuevo en la misma posición ───────────────────
do $$ declare r jsonb; c uuid; n1 uuid; i record; begin
  r := tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes',
        lote('2026-01', alb_fk('B2_26/C1','CADENA01',2,'2026-01-10',100000)), false);
  c := (r->>'carga_id')::uuid;
  perform prueba('cadena: el primer montaje abre intervalo abierto',
    (select estado||'/'||nivel||'/'||km_montaje_conocido from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-0000000000c1' order by fecha_montaje limit 1), 'abierto/estimado/true');
  perform prueba('cadena: 2 intervalos abiertos, uno por rueda del eje 1',
    (select count(*) from tc_reconstruccion_montajes where vehiculo_id='00000000-0000-0000-0000-0000000000c1' and estado='abierto'), 2::bigint);
  select neumatico_id into n1 from tc_reconstruccion_montajes where vehiculo_id='00000000-0000-0000-0000-0000000000c1' order by posicion_id limit 1;

  r := tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes',
        lote('2026-04', alb_fk('B2_26/C2','CADENA01',2,'2026-04-10',150000)) || jsonb_build_object('carga_id', c), false);
  perform prueba('cadena: el segundo montaje cierra los dos intervalos',
    (select count(*) from tc_reconstruccion_montajes where vehiculo_id='00000000-0000-0000-0000-0000000000c1' and estado='cerrado'), 2::bigint);
  perform prueba('cadena: recorrido 50.000 km y fechas correctas',
    (select recorrido_km::int||'/'||fecha_montaje||'/'||fecha_desmontaje||'/'||km_estado
       from tc_reconstruccion_montajes where neumatico_id=n1), '50000/2026-01-10/2026-04-10/utilizables');
  perform prueba('cadena: nivel estimado, nunca confirmado',
    (select bool_and(nivel='estimado') from tc_reconstruccion_montajes where vehiculo_id='00000000-0000-0000-0000-0000000000c1' and estado='cerrado'), true);
  perform prueba('cadena: la salida del segundo albarán sabe a quién retiró',
    (select count(*) from operaciones_neumaticos o join tc_intervenciones i2 on i2.id=o.intervencion_id
      where i2.origen_doc='B2_26/C2|CADENA01' and o.tipo_operacion='desmontaje'
        and o.identidad_retirado='reconstruida' and o.neumatico_id is not null), 2::bigint);
  perform prueba('cadena: el primer albarán retiró a alguien desconocido',
    (select bool_and(identidad_retirado='desconocida' and neumatico_id is null) from operaciones_neumaticos o
       join tc_intervenciones i2 on i2.id=o.intervencion_id
      where i2.origen_doc='B2_26/C1|CADENA01' and o.tipo_operacion='desmontaje'), true);
  perform prueba('cadena: el último montaje queda ABIERTO, no se cierra contra el montaje actual',
    (select count(*) from tc_reconstruccion_montajes where vehiculo_id='00000000-0000-0000-0000-0000000000c1' and estado='abierto'), 2::bigint);
  perform prueba('cadena: ni montajes actuales ni historial confirmado se tocan',
    (select count(*) from tc_montajes_actuales where vehiculo_id='00000000-0000-0000-0000-0000000000c1')
    + (select count(*) from tc_historial_montajes), 0::bigint);
end $$;

-- ── 15. Un montaje sin posición interrumpe la continuidad ───────────────────
do $$ declare r jsonb; c uuid; begin
  -- Entre C1 (enero) y C2 (abril) se monta un USADO sin posición en febrero.
  r := tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes',
        lote('2026-02', alb_fk('B2_26/C3','CADENA01',1,'2026-02-15',120000,'usada')), false);
  perform prueba('interrupción: los intervalos de enero quedan interrumpidos, no cerrados',
    (select string_agg(distinct estado, ',') from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-0000000000c1' and fecha_montaje='2026-01-10'), 'interrumpido');
  perform prueba('interrupción: sin fecha ni kilómetros de salida',
    (select bool_and(fecha_desmontaje is null and km_desmontaje is null and not km_desmontaje_conocido)
       from tc_reconstruccion_montajes where fecha_montaje='2026-01-10'), true);
  perform prueba('interrupción: consta desde cuándo se desconoce la continuidad',
    (select bool_and(continuidad_desde='2026-02-15' and revisar) from tc_reconstruccion_montajes where fecha_montaje='2026-01-10'), true);
  perform prueba('interrupción: la salida de abril ya no afirma a quién retiró',
    (select bool_and(identidad_retirado='desconocida' and neumatico_id is null) from operaciones_neumaticos o
       join tc_intervenciones i2 on i2.id=o.intervencion_id
      where i2.origen_doc='B2_26/C2|CADENA01' and o.tipo_operacion='desmontaje'), true);
  perform prueba('interrupción: el usado sin posición no abre ocupación',
    (select count(*) from tc_reconstruccion_montajes where fecha_montaje='2026-02-15'), 0::bigint);
  perform prueba('interrupción: el usado sí deja su salida, con identidad desconocida',
    (select count(*) from operaciones_neumaticos o join tc_intervenciones i2 on i2.id=o.intervencion_id
      where i2.origen_doc='B2_26/C3|CADENA01' and o.tipo_operacion='desmontaje' and o.identidad_retirado='desconocida'), 1::bigint);
  perform prueba('interrupción: el usado no tiene ficha', (select count(*) from operaciones_neumaticos o
      join tc_intervenciones i2 on i2.id=o.intervencion_id where i2.origen_doc='B2_26/C3|CADENA01'
        and o.tipo_operacion='montaje' and o.neumatico_id is null), 1::bigint);
end $$;

-- ── 16. Bandeja: identificar una usada ──────────────────────────────────────
do $$ declare op uuid; ficha uuid; msg text; begin
  select o.id into op from operaciones_neumaticos o join tc_intervenciones i2 on i2.id=o.intervencion_id
    where i2.origen_doc='B2_26/C3|CADENA01' and o.tipo_operacion='montaje';
  begin perform tc_imp_identificar_unidad(op, null, false, 'sin motivo'); msg := null; exception when others then msg := sqlerrm; end;
  perform prueba('bandeja: sin ficha ni creación, se rechaza', msg, 'Hay que enlazar una ficha o pedir que se cree');
  begin perform tc_imp_identificar_unidad(op, '00000000-0000-0000-0000-000000000001', false, '  '); msg := null; exception when others then msg := sqlerrm; end;
  perform prueba('bandeja: hace falta decir en qué se basa', msg, 'Hace falta decir en qué se basa la identificación');
  begin perform tc_imp_identificar_unidad(op, '00000000-0000-0000-0000-000000000001', false, 'la de siempre'); msg := null; exception when others then msg := sqlerrm; end;
  perform prueba('bandeja: no se puede enlazar una ficha montada hoy', msg, 'Esa ficha está montada ahora mismo: no puede ser esta unidad histórica');
  -- Una ficha real, de la aplicación, libre.
  insert into tc_neumaticos (id, empresa_id, numero_interno, codigo_interno, medida, estado, identidad_reconstruida)
    values ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000e1','NT-REAL-000003','NT-REAL-000003','295/80R22.5','almacen', false);
  perform tc_imp_identificar_unidad(op, '00000000-0000-0000-0000-000000000003', false, 'el técnico la reconoció por el albarán');
  perform prueba('bandeja: la operación queda enlazada',
    (select neumatico_id from operaciones_neumaticos where id=op), '00000000-0000-0000-0000-000000000003'::uuid);
  perform prueba('bandeja: queda auditado con su motivo',
    (select count(*) from tc_importacion_eventos where accion='identificar_unidad' and detalle->>'motivo' like '%reconoció%'), 1::bigint);
  perform prueba('bandeja: no se crea ficha nueva al enlazar una existente',
    (select count(*) from tc_neumaticos where importacion_lote_id is not null), 4::bigint);
  begin perform tc_imp_identificar_unidad(op, '00000000-0000-0000-0000-000000000003', false, 'otra vez'); msg := null; exception when others then msg := sqlerrm; end;
  perform prueba('bandeja: no se identifica dos veces', msg, 'Esta unidad ya tiene ficha');
end $$;

-- ── 17. Deshacer entre lotes: reabrir el intervalo del otro ─────────────────
do $$ declare r jsonb; l_abr uuid; l_ene uuid; begin
  select importacion_lote_id into l_abr from tc_intervenciones where origen_doc='B2_26/C2|CADENA01';
  select importacion_lote_id into l_ene from tc_intervenciones where origen_doc='B2_26/C1|CADENA01';
  r := tc_deshacer_importacion(l_abr, '{}', false);
  perform prueba('entre lotes: se deshace el de abril', (r->>'borradas')||'/'||(r->>'conservadas'), '1/0');
  perform prueba('entre lotes: el intervalo de enero vuelve a estar sin cerrar',
    (select string_agg(distinct estado, ',') from tc_reconstruccion_montajes where fecha_montaje='2026-01-10'), 'interrumpido');
  perform prueba('entre lotes: las fichas de enero siguen ahí',
    (select count(*) from tc_neumaticos where importacion_lote_id=l_ene), 2::bigint);
  -- Y ahora el de enero, cuyas fichas ya no usa nadie.
  r := tc_deshacer_importacion(l_ene, '{}', false);
  perform prueba('entre lotes: enero se deshace entero', (r->>'borradas')||'/'||(r->>'conservadas'), '1/0');
  perform prueba('entre lotes: sus fichas se van', (select count(*) from tc_neumaticos where importacion_lote_id=l_ene), 0::bigint);
  perform prueba('entre lotes: no quedan intervalos de enero', (select count(*) from tc_reconstruccion_montajes where fecha_montaje='2026-01-10'), 0::bigint);
end $$;

-- ── 18. Una ficha identificada después NO se borra ──────────────────────────
do $$ declare r jsonb; l uuid; f uuid; begin
  r := tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes',
        lote('2026-05', alb_fk('B2_26/C4','CADENA01',2,'2026-05-10',200000)), false);
  l := (r->>'lote_id')::uuid;
  select id into f from tc_neumaticos where importacion_lote_id=l limit 1;
  update tc_neumaticos set numero_serie='SERIE-REAL-1', control_individual=true, identidad_reconstruida=false where id=f;
  r := tc_deshacer_importacion(l, '{}', false);
  perform prueba('ficha identificada: la intervención se conserva', (r->>'borradas')||'/'||(r->>'conservadas'), '0/1');
  perform prueba('ficha identificada: el motivo lo dice', (r->'detalle'->0->'motivos')::text like '%identificada después%', true);
  perform prueba('ficha identificada: sigue existiendo', (select count(*) from tc_neumaticos where id=f), 1::bigint);
  perform prueba('ficha identificada: la carga queda parcialmente deshecha',
    (select estado from tc_importacion_lotes where id=l), 'parcialmente_deshecho');
end $$;

-- ── 19. Ampliar una carga antigua (alcance 1 → 2) ──────────────────────────
do $$ declare r jsonb; c uuid; l uuid; v uuid; h text; begin
  r := tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes',
        lote('2026-07', alb_fk('B2_26/C5','CADENA01',2,'2026-07-10',300000)), false);
  c := (r->>'carga_id')::uuid; l := (r->>'lote_id')::uuid;
  select intervencion_id into v from tc_importacion_intervenciones where lote_id=l;
  -- Se simula una carga de la fase 1: sin fichas, sin salidas, alcance 1.
  delete from operaciones_neumaticos where intervencion_id=v and tipo_operacion='desmontaje';
  update operaciones_neumaticos set neumatico_id=null, grupo_sustitucion=null where intervencion_id=v;
  delete from tc_reconstruccion_montajes where lote_montaje_id=l;
  delete from tc_neumaticos where importacion_lote_id=l;
  update tc_importacion_intervenciones set alcance=1, neumatico_ids='{}', salida_ids='{}',
         huella_estado=tc_imp_huella_estado(v) where intervencion_id=v;
  update tc_importacion_lotes set alcance=1 where id=l;
  update tc_importacion_cargas set alcance=1 where id=c;

  r := tc_imp_ampliar_carga(c, true);
  perform prueba('ampliar: la simulación dice qué haría', (r->>'ampliadas')||'/'||(r->>'fichas')||'/'||(r->>'salidas'), '1/2/2');
  perform prueba('ampliar: la simulación no escribe nada',
    (select count(*) from tc_neumaticos where importacion_lote_id=l) + (select count(*) from operaciones_neumaticos where intervencion_id=v and tipo_operacion='desmontaje'), 0::bigint);

  r := tc_imp_ampliar_carga(c, false);
  perform prueba('ampliar: crea 2 fichas y 2 salidas', (r->>'ampliadas')||'/'||(r->>'fichas')||'/'||(r->>'salidas'), '1/2/2');
  perform prueba('ampliar: no duplica entradas, servicios ni líneas',
    (select count(*) from operaciones_neumaticos where intervencion_id=v and tipo_operacion='montaje')||'/'||
    (select count(*) from tc_importacion_lineas where intervencion_id=v), '2/0');
  perform prueba('ampliar: la fotografía se actualiza con fichas, salidas y alcance',
    (select array_length(neumatico_ids,1)||'/'||array_length(salida_ids,1)||'/'||alcance from tc_importacion_intervenciones where intervencion_id=v), '2/2/2');
  perform prueba('ampliar: el lote y la carga quedan en alcance 2',
    (select l2.alcance||'/'||c2.alcance from tc_importacion_lotes l2 join tc_importacion_cargas c2 on c2.id=l2.carga_id where l2.id=l), '2/2');
  perform prueba('ampliar: queda auditado', (select count(*) from tc_importacion_eventos where accion='ampliar_alcance' and intervencion_id=v), 1::bigint);
  perform prueba('ampliar: la cronología se rehace', (select count(*) from tc_reconstruccion_montajes where lote_montaje_id=l), 2::bigint);

  r := tc_imp_ampliar_carga(c, false);
  perform prueba('ampliar dos veces no hace nada', (r->>'ampliadas')||'/'||(r->>'fichas')||'/'||(r->>'salidas'), '0/0/0');
  perform prueba('ampliar dos veces: sigue habiendo 2 fichas y 2 salidas',
    (select count(*) from tc_neumaticos where importacion_lote_id=l)||'/'||
    (select count(*) from operaciones_neumaticos where intervencion_id=v and tipo_operacion='desmontaje'), '2/2');

  -- Y si alguien tocó la intervención por fuera, no se amplía a ciegas.
  h := (select huella_estado from tc_importacion_intervenciones where intervencion_id=v);
  update tc_importacion_intervenciones set alcance=1, huella_estado='huella-que-no-cuadra' where intervencion_id=v;
  r := tc_imp_ampliar_carga(c, false);
  perform prueba('ampliar: con la huella cambiada no se toca y se dice por qué',
    (r->>'ampliadas')||'/'||(r->>'sin_ampliar')||'/'||(r->'detalle'->0->>'motivo'),
    '0/1/Modificada después de importarla: la huella del estado no coincide');
  perform prueba('ampliar: la huella no se sustituye para tapar el cambio',
    (select huella_estado from tc_importacion_intervenciones where intervencion_id=v), 'huella-que-no-cuadra');
  update tc_importacion_intervenciones set alcance=2, huella_estado=h where intervencion_id=v;
end $$;

-- ── 20. Informe «Montajes de neumáticos» ───────────────────────────────────
do $$ declare r jsonb; v uuid; n uuid; begin
  -- Operaciones NORMALES (sin vínculo de importación) para contrastar.
  insert into tc_neumaticos (id, empresa_id, numero_interno, codigo_interno, marca, modelo, medida, estado)
    values ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-0000000000e1','NT-REAL-000010','NT-REAL-000010','Michelin','X Multi','315/80R22.5','montado');
  insert into tc_intervenciones (id, empresa_id, vehiculo_id, fecha, numero)
    values ('00000000-0000-0000-0000-00000000e001','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000c1','2026-07-10','OP-NORMAL-1');
  insert into operaciones_neumaticos (empresa_id, vehiculo_id, intervencion_id, neumatico_id, tipo_operacion, status, fecha_operacion, estado_anterior, observaciones)
    values -- una entrada normal desde almacén
      ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000e001','00000000-0000-0000-0000-000000000010','montaje','completada','2026-07-10','almacen',null),
      -- una sustitución: la que SALE no cuenta como montaje
      ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000e001','00000000-0000-0000-0000-000000000010','sustitucion','completada','2026-07-10','montado',null),
      -- y la que ENTRA en esa sustitución, usada
      ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000e001','00000000-0000-0000-0000-000000000010','sustitucion','completada','2026-07-10','almacen','montada [USADO]'),
      -- lo que el vehículo ya llevaba: no es trabajo de ese día
      ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000e001','00000000-0000-0000-0000-000000000010','montaje','completada','2026-07-10','catalogo','Lo que ya llevaba, declarado en el parte [DECLARADO]');
  insert into operaciones_neumaticos (empresa_id, vehiculo_id, intervencion_id, neumatico_id, tipo_operacion, status, fecha_operacion, estado_anterior, is_correccion)
    values ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000e001','00000000-0000-0000-0000-000000000010','correccion_montado','completada','2026-07-10','almacen',true);
  insert into operaciones_neumaticos (empresa_id, vehiculo_id, intervencion_id, neumatico_id, tipo_operacion, status, fecha_operacion, estado_anterior, is_anulada)
    values ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000e001','00000000-0000-0000-0000-000000000010','montaje','anulada','2026-07-10','almacen',true);

  r := tc_informes_montajes('00000000-0000-0000-0000-0000000000e1','2026-07-01','2026-07-31','ambos');
  -- Histórico: las 2 nuevas del albarán C5. Normal: la entrada de almacén y la
  -- entrada de la sustitución. La que sale, la declarada, la corrección y la
  -- anulada NO cuentan.
  perform prueba('informe: 4 entradas (2 históricas + 2 normales)',
    (r->>'total')||'/'||(r->>'total_historico')||'/'||(r->>'total_normal'), '4/2/2');
  perform prueba('informe: una sustitución cuenta UNA entrada, no dos',
    (select count(*) from operaciones_neumaticos where intervencion_id='00000000-0000-0000-0000-00000000e001' and tipo_operacion='sustitucion'), 2::bigint);
  perform prueba('informe: desmontajes y registros por separado',
    (r->>'desmontajes')||'/'||(r->>'registros'), '3/7');
  perform prueba('informe: excluye anuladas, correcciones y declaradas',
    (r->'excluidas'->>'anuladas')||'/'||(r->'excluidas'->>'correcciones')||'/'||(r->'excluidas'->>'declaradas'), '1/1/1');
  perform prueba('informe: nuevas y usadas separadas',
    (select string_agg(x->>'condicion'||'='||(x->>'n'), ',' order by x->>'condicion') from jsonb_array_elements(r->'por_condicion') x), 'nueva=3,usada=1');
  perform prueba('informe: las filas por referencia suman el total',
    (select sum((x->>'n')::int)::int from jsonb_array_elements(r->'por_referencia') x), 4);
  perform prueba('informe: posiciones deducidas y desconocidas por separado',
    (select string_agg(x->>'clase'||'='||(x->>'n'), ',' order by x->>'clase') from jsonb_array_elements(r->'por_posicion') x), 'deducida=2,desconocida=2');
  r := tc_informes_montajes('00000000-0000-0000-0000-0000000000e1','2026-07-01','2026-07-31','historico');
  perform prueba('informe: solo histórico', (r->>'total')||'/'||(r->>'total_normal'), '2/0');
  r := tc_informes_montajes('00000000-0000-0000-0000-0000000000e1','2026-07-01','2026-07-31','normal');
  perform prueba('informe: solo normal', (r->>'total')||'/'||(r->>'total_historico'), '2/0');
  perform prueba('informe: la marca de las normales sale de la ficha',
    (select bool_or(x->>'marca' = 'Michelin') from jsonb_array_elements(r->'por_referencia') x), true);
  r := tc_informes_montajes('00000000-0000-0000-0000-0000000000e1','2026-07-11','2026-07-31','ambos');
  perform prueba('informe: fuera del rango no cuenta nada', (r->>'total')::int, 0);
  r := tc_informes_montajes('00000000-0000-0000-0000-0000000000e2','2026-07-01','2026-07-31','ambos');
  perform prueba('informe: aislamiento por empresa', (r->>'total')::int, 0);
  -- Una usada del albarán sin marca ni modelo: tiene que salir, no desaparecer.
  perform tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes', jsonb_build_object(
    'periodo','2026-07','fichero','plana.xlsx','albaranes', jsonb_build_array(jsonb_build_object(
      'origen_doc','B2_26/SM|CADENA01','documento','B2_26/SM','matricula','CADENA01','fecha','2026-07-20','km',310000,
      'huella_origen','h-sin-marca',
      'operaciones', jsonb_build_array(jsonb_build_object('origen_linea','B2_26/SM|CADENA01|H1|M|1|u1/1','condicion','usada','medida','295/80R22.5')),
      'servicios','[]'::jsonb,'lineas','[]'::jsonb))), false);
  r := tc_informes_montajes('00000000-0000-0000-0000-0000000000e1','2026-07-01','2026-07-31','historico');
  perform prueba('informe: «No informado» conserva las unidades sin marca',
    (select (x->>'n')::int from jsonb_array_elements(r->'por_referencia') x
      where x->>'marca'='No informado' and x->>'modelo'='No informado' and x->>'condicion'='usada'), 1);
  perform prueba('informe: y suman en el total', (r->>'total')::int, 3);
end $$;

-- ── 21. Inventario: las fichas históricas no son existencias ───────────────
do $$ declare r jsonb; begin
  perform prueba('inventario: el inventario por marca ignora las fichas históricas',
    (select coalesce(sum(total),0)::int from tc_informes_inventario_por('00000000-0000-0000-0000-0000000000e1','marca')),
    (select count(*)::int from tc_neumaticos where empresa_id='00000000-0000-0000-0000-0000000000e1' and importacion_lote_id is null));
  perform prueba('inventario: hay fichas históricas que NO se cuentan',
    (select count(*) > 0 from tc_neumaticos where importacion_lote_id is not null), true);
  perform prueba('inventario: marca+medida tampoco las cuenta',
    (select coalesce(sum(total),0)::int from tc_informes_inventario_marca_medida('00000000-0000-0000-0000-0000000000e1')),
    (select count(*)::int from tc_neumaticos where empresa_id='00000000-0000-0000-0000-0000000000e1' and importacion_lote_id is null));
  r := tc_informes_inventario_resumen('00000000-0000-0000-0000-0000000000e1');
  perform prueba('inventario: el resumen separa reales, históricas y pendientes',
    ((r->>'neumaticos_reales')::int > 0) and ((r->>'fichas_historicas')::int > 0) and ((r->>'unidades_sin_ficha')::int >= 0), true);
  perform prueba('inventario: ninguna ficha histórica está disponible para montar',
    (select count(*) from tc_neumaticos where importacion_lote_id is not null and estado in ('almacen','reservado')), 0::bigint);
  perform prueba('inventario: los contadores por estado de los KPI no las ven',
    (select count(*) from tc_neumaticos where importacion_lote_id is not null
       and estado in ('montado','almacen','reparacion','descartado')), 0::bigint);
end $$;

-- ── 22. Evidencia explícita de posición (lo que daría una OR) ──────────────
-- Prioridad: una posición indicada por una OR manda sobre la deducción, y un
-- montaje con posición conocida solo afecta a SU posición: no interrumpe los
-- demás ejes del vehículo. (La lectura de OR no existe todavía; aquí se
-- comprueba que el modelo la soporta.)
do $$ declare r jsonb; l uuid; op uuid; pos uuid; begin
  insert into tc_vehiculos (id, empresa_id, tipo_vehiculo_id, matricula, km_actual)
    values ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000a','CADENA02', 999999)
    on conflict do nothing;
  -- Enero: 4 nuevas al eje 2 (deducido).
  r := tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes',
        lote('2026-01', alb_fk('B2_26/E1','CADENA02',4,'2026-01-10',100000)), false);
  -- Marzo: un USADO. Sin evidencia, rompe la continuidad del eje 2.
  r := tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes',
        lote('2026-03', alb_fk('B2_26/E2','CADENA02',1,'2026-03-10',120000,'usada')), false);
  perform prueba('sin evidencia: el usado sin posición interrumpe el eje 2',
    (select count(*) from tc_reconstruccion_montajes where vehiculo_id='00000000-0000-0000-0000-0000000000c2' and estado='interrumpido'), 4::bigint);

  -- Llega la OR y dice que ese usado fue al eje 1 izquierda. Se anota como
  -- INDICADA (no deducida) y se rehace la cadena del vehículo.
  select o.id into op from operaciones_neumaticos o join tc_intervenciones i on i.id=o.intervencion_id
    where i.origen_doc='B2_26/E2|CADENA02' and o.tipo_operacion='montaje';
  select id into pos from tc_posiciones_vehiculo where tipo_vehiculo_id='00000000-0000-0000-0000-00000000000a' and codigo_posicion='E1_IZQ';
  update operaciones_neumaticos set posicion_destino_id=pos, posicion_fuente='indicada' where id=op;
  update operaciones_neumaticos set posicion_origen_id=pos, posicion_fuente='indicada'
    where grupo_sustitucion=(select grupo_sustitucion from operaciones_neumaticos where id=op) and tipo_operacion='desmontaje';
  perform tc_imp_reconstruir_vehiculo('00000000-0000-0000-0000-0000000000c2');
  perform prueba('con evidencia: el eje 2 deja de estar interrumpido',
    (select count(*) from tc_reconstruccion_montajes where vehiculo_id='00000000-0000-0000-0000-0000000000c2' and estado='interrumpido'), 0::bigint);
  perform prueba('con evidencia: el eje 2 sigue abierto y el usado abre su propia ocupación',
    (select count(*) from tc_reconstruccion_montajes where vehiculo_id='00000000-0000-0000-0000-0000000000c2' and estado='abierto'), 5::bigint);
  perform prueba('la posición indicada no se degrada a deducida',
    (select posicion_fuente from tc_reconstruccion_montajes where vehiculo_id='00000000-0000-0000-0000-0000000000c2' and fecha_montaje='2026-03-10'), 'indicada');
  -- Y el informe la cuenta como REGISTRADA, no como deducida.
  r := tc_informes_montajes('00000000-0000-0000-0000-0000000000e1','2026-03-01','2026-03-31','historico');
  perform prueba('el informe separa la posición registrada de la deducida',
    (select string_agg(x->>'clase'||'='||(x->>'n'), ',' order by x->>'clase') from jsonb_array_elements(r->'por_posicion') x), 'registrada=1');
end $$;

-- ── 23. Un vehículo sin ninguna evidencia sigue siendo importable ──────────
do $$ declare r jsonb; begin
  insert into tc_vehiculos (id, empresa_id, tipo_vehiculo_id, matricula, km_actual)
    values ('00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000a','SINOR01', 50000)
    on conflict do nothing;
  r := tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes',
        lote('2026-02', alb_fk('B2_26/S1','SINOR01',3,'2026-02-10',60000), alb_fk('B2_26/S2','SINOR01',2,'2026-05-10',70000,'recauchutada')), false);
  perform prueba('sin OR: se importa igual', (r->>'creadas')::int, 2);
  perform prueba('sin OR: 3 nuevas sin posición (la norma no cubre el 3) y 2 recauchutadas tampoco',
    (select count(*) from operaciones_neumaticos o join tc_intervenciones i on i.id=o.intervencion_id
      where i.vehiculo_id='00000000-0000-0000-0000-0000000000c3' and o.tipo_operacion='montaje' and o.posicion_fuente='desconocida'), 5::bigint);
  perform prueba('sin OR: sus salidas constan igual, con identidad desconocida',
    (select count(*) from operaciones_neumaticos o join tc_intervenciones i on i.id=o.intervencion_id
      where i.vehiculo_id='00000000-0000-0000-0000-0000000000c3' and o.tipo_operacion='desmontaje' and o.identidad_retirado='desconocida'), 5::bigint);
  perform prueba('sin OR: sin posición no se abre ninguna ocupación ni se atribuye recorrido',
    (select count(*) from tc_reconstruccion_montajes where vehiculo_id='00000000-0000-0000-0000-0000000000c3'), 0::bigint);
  perform prueba('sin OR: las 3 nuevas tienen ficha igual',
    (select count(*) from operaciones_neumaticos o join tc_intervenciones i on i.id=o.intervencion_id
      where i.vehiculo_id='00000000-0000-0000-0000-0000000000c3' and o.condicion='nueva' and o.neumatico_id is not null), 3::bigint);
end $$;

-- ── 24. Desfase de mano de obra: AVISO, no movimiento ─────────────────────
-- Cobrar 4 «quitar y poner rueda» montando 2 gomas NO demuestra una permuta
-- ni identifica ruedas movidas. Avisa, y nada más: no interrumpe la cadena.
do $$ declare r jsonb; begin
  insert into tc_vehiculos (id, empresa_id, tipo_vehiculo_id, matricula, km_actual)
    values ('00000000-0000-0000-0000-0000000000c4','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000a','PERMUTA1', 999999)
    on conflict do nothing;
  r := tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes',
        lote('2026-01', alb_fk('B2_26/P1','PERMUTA1',2,'2026-01-10',100000)), false);
  r := tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes',
        lote('2026-03', alb_fk('B2_26/P2','PERMUTA1',2,'2026-03-10',120000)
          || jsonb_build_object('servicios', jsonb_build_array(jsonb_build_object('servicio','quitar_poner_rueda','cantidad',4)))), false);
  perform prueba('desfase: se detecta el albarán con más mano de obra que gomas',
    (select origen_doc from tc_imp_desfase_mano_obra('00000000-0000-0000-0000-0000000000c4')), 'B2_26/P2|PERMUTA1');
  perform prueba('desfase: NO interrumpe nada; el eje 1 de enero se cierra con sus kilómetros',
    (select estado||'/'||km_desmontaje from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-0000000000c4' and fecha_montaje='2026-01-10' limit 1), 'cerrado/120000');
  perform prueba('desfase: lo montado ese día sigue ABIERTO',
    (select bool_and(estado='abierto') from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-0000000000c4' and fecha_montaje='2026-03-10'), true);
  perform prueba('desfase: solo deja un aviso prudente, sin contar ruedas ni inventar movimientos',
    (select bool_and(revisar and motivo_revision like '%Posible trabajo adicional de ruedas%'
                     and motivo_revision not like '%permuta%' and motivo_revision not like '%rueda(s) movidas%')
       from tc_reconstruccion_montajes where vehiculo_id='00000000-0000-0000-0000-0000000000c4'), true);
  perform prueba('desfase: no crea ninguna operación de más',
    (select count(*) from operaciones_neumaticos o join tc_intervenciones i on i.id=o.intervencion_id
      where i.origen_doc='B2_26/P2|PERMUTA1'), 4::bigint);
end $$;

-- ── 25. Lo que SÍ interrumpe: un montaje real sin posición ────────────────
do $$ declare r jsonb; begin
  insert into tc_vehiculos (id, empresa_id, tipo_vehiculo_id, matricula, km_actual)
    values ('00000000-0000-0000-0000-0000000000c5','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000a','SINPOS01', 999999)
    on conflict do nothing;
  r := tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes',
        lote('2026-01', alb_fk('B2_26/Q1','SINPOS01',4,'2026-01-10',100000)), false);
  r := tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes',
        lote('2026-03', alb_fk('B2_26/Q2','SINPOS01',1,'2026-03-10',120000,'usada')), false);
  perform prueba('montaje real sin posición: interrumpe el eje 2',
    (select count(*) from tc_reconstruccion_montajes where vehiculo_id='00000000-0000-0000-0000-0000000000c5'
       and estado='interrumpido' and continuidad_desde='2026-03-10'), 4::bigint);
end $$;

-- ── 26. Un movimiento con posición conocida no toca los demás ejes ────────
do $$ declare r jsonb; op uuid; pos uuid; begin
  insert into tc_vehiculos (id, empresa_id, tipo_vehiculo_id, matricula, km_actual)
    values ('00000000-0000-0000-0000-0000000000c6','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000a','CONPOS01', 999999)
    on conflict do nothing;
  r := tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes',
        lote('2026-01', alb_fk('B2_26/R1','CONPOS01',4,'2026-01-10',100000)), false);
  r := tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes',
        lote('2026-03', alb_fk('B2_26/R2','CONPOS01',1,'2026-03-10',120000,'usada')), false);
  -- La OR dice que esa usada fue al eje 1 izquierda.
  select o.id into op from operaciones_neumaticos o join tc_intervenciones i on i.id=o.intervencion_id
    where i.origen_doc='B2_26/R2|CONPOS01' and o.tipo_operacion='montaje';
  select id into pos from tc_posiciones_vehiculo where tipo_vehiculo_id='00000000-0000-0000-0000-00000000000a' and codigo_posicion='E1_IZQ';
  update operaciones_neumaticos set posicion_destino_id=pos, posicion_fuente='indicada' where id=op;
  update operaciones_neumaticos set posicion_origen_id=pos, posicion_fuente='indicada'
    where grupo_sustitucion=(select grupo_sustitucion from operaciones_neumaticos where id=op) and tipo_operacion='desmontaje';
  perform tc_imp_reconstruir_vehiculo('00000000-0000-0000-0000-0000000000c6');
  perform prueba('posición conocida: el eje 2 sigue abierto, sin interrumpir',
    (select count(*) from tc_reconstruccion_montajes where vehiculo_id='00000000-0000-0000-0000-0000000000c6'
       and estado='abierto' and posicion_fuente='deducida'), 4::bigint);
  perform prueba('posición conocida: ningún intervalo interrumpido en ese vehículo',
    (select count(*) from tc_reconstruccion_montajes where vehiculo_id='00000000-0000-0000-0000-0000000000c6' and estado='interrumpido'), 0::bigint);
  perform prueba('posición conocida: el intervalo de la usada es OCUPACIÓN, no unidad',
    (select clase||'/'||coalesce(neumatico_id::text,'sin ficha') from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-0000000000c6' and fecha_montaje='2026-03-10'), 'ocupacion/sin ficha');
  perform prueba('posición conocida: la referencia de la unidad es su operación de entrada, sin ficha ficticia',
    (select operacion_entrada_id = op from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-0000000000c6' and fecha_montaje='2026-03-10'), true);
  perform prueba('las nuevas con ficha sí son intervalos de UNIDAD',
    (select bool_and(clase='unidad' and neumatico_id is not null) from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-0000000000c6' and fecha_montaje='2026-01-10'), true);
end $$;

-- ── 27. Planos: la norma solo se aplica donde encaja ──────────────────────
do $$ declare r jsonb; begin
  -- 2x4x2 (camión de tres ejes, como el que enseñan las OR de 4452MSG)
  insert into tc_tipos_vehiculo (id, nombre) values ('00000000-0000-0000-0000-0000000000d1','camion_2x4x2_pruebas') on conflict (id) do nothing;
  insert into tc_posiciones_vehiculo (tipo_vehiculo_id, codigo_posicion, eje, lado, interior_exterior, orden_visual) values
    ('00000000-0000-0000-0000-0000000000d1','E1_IZQ',1,'izq',null,1), ('00000000-0000-0000-0000-0000000000d1','E1_DER',1,'der',null,2),
    ('00000000-0000-0000-0000-0000000000d1','E2_IZQ_EXT',2,'izq','ext',3), ('00000000-0000-0000-0000-0000000000d1','E2_IZQ_INT',2,'izq','int',4),
    ('00000000-0000-0000-0000-0000000000d1','E2_DER_INT',2,'der','int',5), ('00000000-0000-0000-0000-0000000000d1','E2_DER_EXT',2,'der','ext',6),
    ('00000000-0000-0000-0000-0000000000d1','E3_IZQ',3,'izq',null,7), ('00000000-0000-0000-0000-0000000000d1','E3_DER',3,'der',null,8)
    on conflict do nothing;
  -- 2x2x2: el eje 2 solo tiene 2 posiciones
  insert into tc_tipos_vehiculo (id, nombre) values ('00000000-0000-0000-0000-0000000000d2','camion_2x2x2_pruebas') on conflict (id) do nothing;
  insert into tc_posiciones_vehiculo (tipo_vehiculo_id, codigo_posicion, eje, lado, interior_exterior, orden_visual) values
    ('00000000-0000-0000-0000-0000000000d2','E1_IZQ',1,'izq',null,1), ('00000000-0000-0000-0000-0000000000d2','E1_DER',1,'der',null,2),
    ('00000000-0000-0000-0000-0000000000d2','E2_IZQ',2,'izq',null,3), ('00000000-0000-0000-0000-0000000000d2','E2_DER',2,'der',null,4),
    ('00000000-0000-0000-0000-0000000000d2','E3_IZQ',3,'izq',null,5), ('00000000-0000-0000-0000-0000000000d2','E3_DER',3,'der',null,6)
    on conflict do nothing;
  -- Un tipo SIN plano
  insert into tc_tipos_vehiculo (id, nombre) values ('00000000-0000-0000-0000-0000000000d3','sin_plano_pruebas') on conflict (id) do nothing;

  insert into tc_vehiculos (id, empresa_id, tipo_vehiculo_id, matricula, km_actual) values
    ('00000000-0000-0000-0000-0000000000e4','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000d1','PLANO242', 1),
    ('00000000-0000-0000-0000-0000000000e5','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000d2','PLANO222', 1),
    ('00000000-0000-0000-0000-0000000000e6','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000d3','SINPLANO', 1)
    on conflict do nothing;

  r := tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes', lote('2026-08',
        alb_fk('B2_26/T1','PLANO242',2,'2026-08-01',10000), alb_fk('B2_26/T2','PLANO242',4,'2026-08-02',10001),
        alb_fk('B2_26/T3','PLANO242',6,'2026-08-03',10002),
        alb_fk('B2_26/T4','PLANO222',2,'2026-08-04',10003), alb_fk('B2_26/T5','PLANO222',4,'2026-08-05',10004),
        alb_fk('B2_26/T6','PLANO222',6,'2026-08-06',10005),
        alb_fk('B2_26/T7','SINPLANO',2,'2026-08-07',10006)), false);
  perform prueba('2x4x2: 2 nuevas → eje 1',
    (select string_agg(p.codigo_posicion,',' order by p.codigo_posicion) from operaciones_neumaticos o
       join tc_intervenciones i on i.id=o.intervencion_id join tc_posiciones_vehiculo p on p.id=o.posicion_destino_id
      where i.origen_doc='B2_26/T1|PLANO242' and o.tipo_operacion='montaje'), 'E1_DER,E1_IZQ');
  perform prueba('2x4x2: 4 nuevas → eje 2 (las cuatro gemelas)',
    (select count(*) from operaciones_neumaticos o join tc_intervenciones i on i.id=o.intervencion_id
       join tc_posiciones_vehiculo p on p.id=o.posicion_destino_id
      where i.origen_doc='B2_26/T2|PLANO242' and p.eje=2), 4::bigint);
  perform prueba('2x4x2: 6 nuevas → 2 al eje 1 y 4 al eje 2, nada al eje 3',
    (select string_agg(distinct p.eje::text,',' order by p.eje::text) from operaciones_neumaticos o
       join tc_intervenciones i on i.id=o.intervencion_id join tc_posiciones_vehiculo p on p.id=o.posicion_destino_id
      where i.origen_doc='B2_26/T3|PLANO242' and o.tipo_operacion='montaje'), '1,2');
  perform prueba('2x2x2: 2 nuevas → eje 1 (encaja)',
    (select count(*) from operaciones_neumaticos o join tc_intervenciones i on i.id=o.intervencion_id
      where i.origen_doc='B2_26/T4|PLANO222' and o.posicion_destino_id is not null), 2::bigint);
  perform prueba('2x2x2: 4 nuevas → el eje 2 solo tiene 2: sin posición',
    (select count(*) from operaciones_neumaticos o join tc_intervenciones i on i.id=o.intervencion_id
      where i.origen_doc='B2_26/T5|PLANO222' and o.tipo_operacion='montaje' and o.posicion_fuente='desconocida'), 4::bigint);
  perform prueba('2x2x2: 6 nuevas → el plano no es 2+4: sin posición',
    (select count(*) from operaciones_neumaticos o join tc_intervenciones i on i.id=o.intervencion_id
      where i.origen_doc='B2_26/T6|PLANO222' and o.tipo_operacion='montaje' and o.posicion_fuente='desconocida'), 6::bigint);
  perform prueba('tipo sin plano: sin posición, pero se importa igual',
    (select count(*) from operaciones_neumaticos o join tc_intervenciones i on i.id=o.intervencion_id
      where i.origen_doc='B2_26/T7|SINPLANO' and o.tipo_operacion='montaje' and o.posicion_fuente='desconocida'), 2::bigint);
end $$;

-- ── 28. Kilómetros: ausentes, incompatibles y utilizables ─────────────────
-- Un dato incompatible NO se convierte en ausente: el valor se conserva y se
-- clasifica. Y un recorrido cero no es un error por sí solo.
do $$ declare r jsonb; v uuid; begin
  insert into tc_vehiculos (id, empresa_id, tipo_vehiculo_id, matricula, km_actual) values
    ('00000000-0000-0000-0000-00000000ab01','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000a','KM0001', 1),
    ('00000000-0000-0000-0000-00000000ab02','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000a','KM0002', 1),
    ('00000000-0000-0000-0000-00000000ab03','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000a','KM0003', 1),
    ('00000000-0000-0000-0000-00000000ab04','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000a','KM0004', 1)
    on conflict do nothing;
  -- Utilizables: 100.000 → 130.000
  perform tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes', lote('2026-01', alb_fk('B2_26/K1','KM0001',2,'2026-01-10',100000)), false);
  perform tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes', lote('2026-03', alb_fk('B2_26/K2','KM0001',2,'2026-03-10',130000)), false);
  perform prueba('km utilizables: recorrido calculado y clasificado',
    (select km_estado||'/'||recorrido_km::int||'/'||revisar from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ab01' and estado='cerrado' limit 1), 'utilizables/30000/false');
  -- Incompatibles: 200.000 → 180.000 (decreciente). Los valores se conservan.
  perform tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes', lote('2026-01', alb_fk('B2_26/K3','KM0002',2,'2026-01-10',200000)), false);
  perform tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes', lote('2026-03', alb_fk('B2_26/K4','KM0002',2,'2026-03-10',180000)), false);
  perform prueba('km incompatibles: se clasifican como tales, no como ausentes',
    (select km_estado||'/'||coalesce(recorrido_km::text,'—')||'/'||revisar from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ab02' and estado='cerrado' limit 1), 'incompatibles/—/true');
  perform prueba('km incompatibles: los valores originales NO se borran',
    (select km_montaje::int||' → '||km_desmontaje::int||' ('||km_desmontaje_conocido||')' from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ab02' and estado='cerrado' limit 1), '200000 → 180000 (true)');
  perform prueba('km incompatibles: el motivo dice los dos valores',
    (select motivo_revision like '%200000%180000%' from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ab02' and estado='cerrado' limit 1), true);
  -- Ausentes: sin km en el cierre
  perform tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes', lote('2026-01', alb_fk('B2_26/K5','KM0003',2,'2026-01-10',300000)), false);
  perform tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes', lote('2026-03', alb_fk('B2_26/K6','KM0003',2,'2026-03-10',null)), false);
  perform prueba('km ausentes: ni recorrido ni aviso; solo constan como ausentes',
    (select km_estado||'/'||coalesce(recorrido_km::text,'—')||'/'||revisar from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ab03' and estado='cerrado' limit 1), 'ausentes/—/false');
  perform prueba('km ausentes: el motivo dice qué extremo falta',
    (select motivo_revision from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ab03' and estado='cerrado' limit 1), 'Kilómetros ausentes en el desmontaje');
  -- Iguales el mismo día: recorrido 0 y SIN aviso.
  perform tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes',
    lote('2026-01', alb_fk('B2_26/K7','KM0004',2,'2026-01-10',400000)), false);
  perform tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes',
    lote('2026-01', alb_fk('B2_26/K8','KM0004',2,'2026-01-10',400000)), false);
  -- Mismo día: el recorrido 0 es normal y NO genera aviso por sí mismo (el
  -- aviso que sí sale es el de dos albaranes el mismo día, que es otra cosa).
  perform prueba('km iguales el mismo día: recorrido 0 y utilizable',
    (select km_estado||'/'||recorrido_km::int from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ab04' and estado='cerrado' limit 1), 'utilizables/0');
  perform prueba('km iguales el mismo día: no se avisa por el recorrido cero',
    (select coalesce(motivo_revision,'') not like '%recorrido cero%' from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ab04' and estado='cerrado' limit 1), true);
  -- Iguales con días de por medio: recorrido 0 pero a revisar.
  perform tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes',
    lote('2026-05', alb_fk('B2_26/K9','KM0004',2,'2026-05-10',400000)), false);
  perform prueba('km iguales tras meses: recorrido 0 pero marcado para revisar',
    (select km_estado||'/'||recorrido_km::int||'/'||revisar from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ab04' and fecha_montaje='2026-01-10' and estado='cerrado'
        and fecha_desmontaje='2026-05-10' limit 1), 'utilizables/0/true');
  perform prueba('km iguales tras meses: el motivo lo explica',
    (select motivo_revision like '%recorrido cero%' from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ab04' and fecha_desmontaje='2026-05-10' limit 1), true);
  perform prueba('un intervalo sin cerrar no clasifica kilómetros',
    (select bool_and(km_estado='sin_cierre' and recorrido_km is null) from tc_reconstruccion_montajes where estado <> 'cerrado'), true);
end $$;

-- ── 29. Planos 2+4, 2+4+2 y 2+4+4 con seis nuevas ─────────────────────────
-- La regla es 2 al eje 1 y 4 al eje 2. Que exista un tercer eje NO impide
-- aplicarla: lo que importa es que el eje 1 tenga 2 posiciones activas y el
-- eje 2 tenga 4. Un plano 2+2 no la admite (ya se comprueba en la 27).
do $$ declare r jsonb; begin
  -- 2x4x4: tractora de cuatro ejes con eje 2 gemelo y eje 3 gemelo
  insert into tc_tipos_vehiculo (id, nombre) values ('00000000-0000-0000-0000-0000000000d4','camion_2x4x4_pruebas') on conflict (id) do nothing;
  insert into tc_posiciones_vehiculo (tipo_vehiculo_id, codigo_posicion, eje, lado, interior_exterior, orden_visual) values
    ('00000000-0000-0000-0000-0000000000d4','E1_IZQ',1,'izq',null,1), ('00000000-0000-0000-0000-0000000000d4','E1_DER',1,'der',null,2),
    ('00000000-0000-0000-0000-0000000000d4','E2_IZQ_EXT',2,'izq','ext',3), ('00000000-0000-0000-0000-0000000000d4','E2_IZQ_INT',2,'izq','int',4),
    ('00000000-0000-0000-0000-0000000000d4','E2_DER_INT',2,'der','int',5), ('00000000-0000-0000-0000-0000000000d4','E2_DER_EXT',2,'der','ext',6),
    ('00000000-0000-0000-0000-0000000000d4','E3_IZQ_EXT',3,'izq','ext',7), ('00000000-0000-0000-0000-0000000000d4','E3_IZQ_INT',3,'izq','int',8),
    ('00000000-0000-0000-0000-0000000000d4','E3_DER_INT',3,'der','int',9), ('00000000-0000-0000-0000-0000000000d4','E3_DER_EXT',3,'der','ext',10)
    on conflict do nothing;
  insert into tc_vehiculos (id, empresa_id, tipo_vehiculo_id, matricula, km_actual) values
    ('00000000-0000-0000-0000-0000000000e7','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000d4','PLANO244', 1)
    on conflict do nothing;
  r := tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes', lote('2026-08',
        alb_fk('B2_26/T8','PLANO244',6,'2026-08-08',20000),
        alb_fk('B2_26/T9','PLANO244',2,'2026-08-09',20010),
        alb_fk('B2_26/TA','PLANO244',4,'2026-08-10',20020)), false);
  perform prueba('2x4x4: 6 nuevas → las 6 colocadas (el tercer eje no estorba)',
    (select count(*) from operaciones_neumaticos o join tc_intervenciones i on i.id=o.intervencion_id
      where i.origen_doc='B2_26/T8|PLANO244' and o.tipo_operacion='montaje' and o.posicion_destino_id is not null), 6::bigint);
  perform prueba('2x4x4: 6 nuevas → 2 al eje 1 y 4 al eje 2, nada al eje 3',
    (select string_agg(eje::text||':'||n, ',' order by eje) from (
       select p.eje, count(*) n from operaciones_neumaticos o
         join tc_intervenciones i on i.id=o.intervencion_id
         join tc_posiciones_vehiculo p on p.id=o.posicion_destino_id
        where i.origen_doc='B2_26/T8|PLANO244' and o.tipo_operacion='montaje' group by p.eje) x), '1:2,2:4');
  perform prueba('2x4x4: 6 nuevas → ejes tocados',
    (select string_agg(distinct p.eje::text, ',' order by p.eje::text) from operaciones_neumaticos o
       join tc_intervenciones i on i.id=o.intervencion_id join tc_posiciones_vehiculo p on p.id=o.posicion_destino_id
      where i.origen_doc='B2_26/T8|PLANO244'), '1,2');
  perform prueba('2x4x4: 2 nuevas → eje 1',
    (select string_agg(p.codigo_posicion,',' order by p.codigo_posicion) from operaciones_neumaticos o
       join tc_intervenciones i on i.id=o.intervencion_id join tc_posiciones_vehiculo p on p.id=o.posicion_destino_id
      where i.origen_doc='B2_26/T9|PLANO244'), 'E1_DER,E1_IZQ');
  perform prueba('2x4x4: 4 nuevas → eje 2, no el 3',
    (select string_agg(distinct p.eje::text,',') from operaciones_neumaticos o
       join tc_intervenciones i on i.id=o.intervencion_id join tc_posiciones_vehiculo p on p.id=o.posicion_destino_id
      where i.origen_doc='B2_26/TA|PLANO244'), '2');
  -- Y una posición desactivada no cuenta: el plano deja de encajar.
  update tc_posiciones_vehiculo set activo = false
   where tipo_vehiculo_id='00000000-0000-0000-0000-0000000000d4' and codigo_posicion='E2_DER_EXT';
  perform prueba('2x4x4 con una posición del eje 2 desactivada: 6 nuevas ya no encajan',
    tc_imp_posiciones_norma('00000000-0000-0000-0000-0000000000e7', 6, true), null);
  update tc_posiciones_vehiculo set activo = true
   where tipo_vehiculo_id='00000000-0000-0000-0000-0000000000d4' and codigo_posicion='E2_DER_EXT';
  perform prueba('2x4x4 reactivada: 6 nuevas vuelven a encajar',
    coalesce(array_length(tc_imp_posiciones_norma('00000000-0000-0000-0000-0000000000e7', 6, true), 1), 0), 6);
end $$;

-- ── 30. Plausibilidad: el criterio es el RITMO, no el recorrido total ─────
-- 180.000 km en tres años es creíble. Los mismos 180.000 km en 60 días no.
-- El recorrido se guarda en los dos casos.
do $$ begin
  insert into tc_vehiculos (id, empresa_id, tipo_vehiculo_id, matricula, km_actual) values
    ('00000000-0000-0000-0000-00000000ac01','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000a','RITMO01', 1),
    ('00000000-0000-0000-0000-00000000ac02','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000a','RITMO02', 1)
    on conflict do nothing;
  -- Largo pero plausible: 180.000 km en 1.096 días → 164 km/día
  perform tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes', lote('2023-01', alb_fk('B2_26/R1','RITMO01',2,'2023-01-10',100000)), false);
  perform tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes', lote('2026-01', alb_fk('B2_26/R2','RITMO01',2,'2026-01-10',280000)), false);
  perform prueba('recorrido largo pero plausible: utilizable, sin aviso de ritmo',
    (select km_estado||'/'||recorrido_km::int||'/'||revisar from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ac01' and estado='cerrado' limit 1), 'utilizables/180000/false');
  perform prueba('recorrido largo plausible: el ritmo queda guardado',
    (select tc_imp_num(round(ritmo_km_dia))||' km/día en '||dias_intervalo||' días' from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ac01' and estado='cerrado' limit 1), '164 km/día en 1096 días');
  -- Mismo recorrido, 60 días → 3.000 km/día: anómalo
  perform tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes', lote('2026-01', alb_fk('B2_26/R3','RITMO02',2,'2026-01-10',100000)), false);
  perform tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes', lote('2026-03', alb_fk('B2_26/R4','RITMO02',2,'2026-03-11',280000)), false);
  perform prueba('mismo recorrido en 60 días: anómalo, y el recorrido SE CONSERVA',
    (select km_estado||'/'||recorrido_km::int||'/'||revisar from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ac02' and estado='cerrado' limit 1), 'anomalos/180000/true');
  perform prueba('anómalo: los kilómetros originales siguen ahí',
    (select km_montaje::int||' → '||km_desmontaje::int from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ac02' and estado='cerrado' limit 1), '100000 → 280000');
  perform prueba('anómalo: el aviso dice días, ritmo y límite',
    (select motivo_revision like '%60 día(s)%3000 km/día%límite de 2000 km/día%' from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ac02' and estado='cerrado' limit 1), true);
  perform prueba('anómalo: el aviso dice que es para revisar, no una prueba',
    (select motivo_revision like '%no una prueba de que el dato sea falso%' from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ac02' and estado='cerrado' limit 1), true);
  perform prueba('anómalo pendiente: no entra en medias',
    (select tc_imp_intervalo_en_medias(rm) from tc_reconstruccion_montajes rm
      where rm.vehiculo_id='00000000-0000-0000-0000-00000000ac02' and rm.estado='cerrado' limit 1), false);
  perform prueba('anómalo pendiente: el motivo de exclusión es el suyo',
    (select array_to_string(tc_imp_intervalo_motivos(rm),',') from tc_reconstruccion_montajes rm
      where rm.vehiculo_id='00000000-0000-0000-0000-00000000ac02' and rm.estado='cerrado' limit 1), 'km_anomalos_pendientes');
  -- El límite es configurable: subirlo reclasifica sin tocar los datos.
  perform tc_imp_fijar_limite_km_dia('00000000-0000-0000-0000-0000000000e1', 5000);
  perform prueba('subir el límite a 5.000: el mismo intervalo pasa a utilizable',
    (select km_estado||'/'||recorrido_km::int||'/'||limite_km_dia::int from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ac02' and estado='cerrado' limit 1), 'utilizables/180000/5000');
  perform tc_imp_fijar_limite_km_dia('00000000-0000-0000-0000-0000000000e1', 2000);
  perform prueba('volver a 2.000: vuelve a ser anómalo',
    (select km_estado from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ac02' and estado='cerrado' limit 1), 'anomalos');
  perform prueba('el límite por defecto es 2.000 km/día', tc_imp_limite_km_dia('00000000-0000-0000-0000-0000000000e2'), 2000::numeric);
end $$;

-- ── 31. Intervalos de cero días: no se divide entre cero ──────────────────
do $$ begin
  insert into tc_vehiculos (id, empresa_id, tipo_vehiculo_id, matricula, km_actual) values
    ('00000000-0000-0000-0000-00000000ac03','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000a','CERO001', 1),
    ('00000000-0000-0000-0000-00000000ac04','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000a','CERO002', 1)
    on conflict do nothing;
  -- Mismo día, salto pequeño (300 km): plausible, y sin dividir entre cero.
  perform tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes', lote('2026-06', alb_fk('B2_26/Z1','CERO001',2,'2026-06-01',500000)), false);
  perform tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes', lote('2026-06', alb_fk('B2_26/Z2','CERO001',2,'2026-06-01',500300)), false);
  perform prueba('cero días con salto pequeño: utilizable, pero con el orden desconocido',
    (select km_estado||'/'||recorrido_km::int||'/'||dias_intervalo||'/'||orden_desconocido
       from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ac03' and estado='cerrado' limit 1), 'utilizables/300/0/true');
  perform prueba('cero días con salto pequeño: tampoco se publica un ritmo',
    (select ritmo_km_dia is null from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ac03' and estado='cerrado' limit 1), true);
  perform prueba('cero días con salto pequeño: fuera de las medias hasta revisar el orden',
    (select array_to_string(tc_imp_intervalo_motivos(rm),',') from tc_reconstruccion_montajes rm
      where rm.vehiculo_id='00000000-0000-0000-0000-00000000ac03' and rm.estado='cerrado' limit 1),
    'mismo_dia_orden_desconocido');
  -- Mismo día, salto imposible: anómalo, comparando con el límite de UN día.
  perform tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes', lote('2026-06', alb_fk('B2_26/Z3','CERO002',2,'2026-06-01',500000)), false);
  perform tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes', lote('2026-06', alb_fk('B2_26/Z4','CERO002',2,'2026-06-01',626290)), false);
  perform prueba('cero días con salto grande: el recorrido se conserva y se marca el orden desconocido',
    (select km_estado||'/'||recorrido_km::int||'/'||dias_intervalo||'/'||orden_desconocido
       from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ac04' and estado='cerrado' limit 1), 'anomalos/126290/0/true');
  -- Lo importante: NO se inventa un «km/día» que nadie ha observado.
  perform prueba('cero días: NO se publica ningún ritmo diario',
    (select ritmo_km_dia is null from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ac04' and estado='cerrado' limit 1), true);
  perform prueba('cero días: el aviso identifica la limitación (ni hora ni orden)',
    (select motivo_revision like '%No consta la hora ni el orden de los trabajos%'
         and motivo_revision like '%ni se puede calcular un ritmo diario%'
       from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ac04' and estado='cerrado' limit 1), true);
  perform prueba('cero días: la comparación con el límite de un día se presenta como auxiliar',
    (select motivo_revision like '%Comprobación auxiliar, que no es un ritmo observado%'
       from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ac04' and estado='cerrado' limit 1), true);
  perform prueba('cero días con recorrido positivo: fuera de las medias hasta revisarlo',
    (select tc_imp_intervalo_en_medias(rm)||'/'||array_to_string(tc_imp_intervalo_motivos(rm),',')
       from tc_reconstruccion_montajes rm
      where rm.vehiculo_id='00000000-0000-0000-0000-00000000ac04' and rm.estado='cerrado' limit 1),
    'false/km_anomalos_pendientes,mismo_dia_orden_desconocido');
  -- Y el kilometraje decreciente sigue siendo incompatible, no anómalo.
  perform prueba('decreciente no se convierte en anómalo',
    (select km_estado from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ab02' and estado='cerrado' limit 1), 'incompatibles');
end $$;

-- ── 32. 1445HWZ: el caso real, con el albarán bloqueado de por medio ──────
--
-- Las tres lecturas del Excel para esa matrícula:
--   B2_26/614   09/02/2026  127.424 km  se importa
--   B2_26/1590  07/04/2026  739.964 km  BLOQUEADO (Uds. = 4: ¿4 o 16 gomas?)
--   B2_26/2334  18/05/2026  753.714 km  se importa
--
-- El intervalo febrero→mayo tiene que avisar de DOS cosas a la vez: el ritmo
-- no es plausible Y hay un posible montaje intermedio sin importar. Resolver
-- una no resuelve la otra.
do $$ declare r jsonb; begin
  insert into tc_vehiculos (id, empresa_id, tipo_vehiculo_id, matricula, km_actual) values
    ('00000000-0000-0000-0000-00000000ad01','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000a','1445HWZ', 1)
    on conflict do nothing;
  perform tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes',
    lote('2026-02', alb_fk('B2_26/614','1445HWZ',2,'2026-02-09',127424)), false);
  -- El bloqueado va SOLO en su lote: así se comprueba además que un lote que
  -- no crea nada pero sí deja constancia de un bloqueado no se borra.
  r := tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes',
    lote('2026-04', alb_fk('B2_26/1590','1445HWZ',4,'2026-04-07',739964,'recauchutada')
      || jsonb_build_object('bloqueante','La anotación «MONTA0 4 CUBIERTAS RECAUCHUTADA 295/80X22.5 K25» lleva Uds. = 4: no se sabe si son 4 o 16 neumáticos')), false);
  perform prueba('bloqueado: ni creado ni importado', (r->>'bloqueados')||'/'||(r->>'creadas'), '1/0');
  perform prueba('bloqueado: NO crea intervención',
    (select count(*) from tc_intervenciones where origen_doc='B2_26/1590|1445HWZ'), 0::bigint);
  perform prueba('bloqueado: NO crea operaciones',
    (select count(*) from operaciones_neumaticos where origen_linea like 'B2_26/1590%'), 0::bigint);
  perform prueba('bloqueado: NO crea fichas',
    (select count(*) from tc_neumaticos where origen_doc = 'B2_26/1590|1445HWZ'), 0::bigint);
  perform prueba('bloqueado: queda la referencia, el motivo y su lectura de origen',
    (select origen_doc||'/'||posible_montaje||'/'||km_origen::int||'/'||fecha from tc_importacion_bloqueados
      where origen_doc='B2_26/1590|1445HWZ'), 'B2_26/1590|1445HWZ/true/739964/2026-04-07');
  perform prueba('bloqueado: el motivo se guarda literal',
    (select motivo like '%no se sabe si son 4 o 16 neumáticos%' from tc_importacion_bloqueados
      where origen_doc='B2_26/1590|1445HWZ'), true);
  perform prueba('bloqueado: el registro NO guarda cantidades (es justo lo que está en duda)',
    (select count(*) from information_schema.columns where table_name='tc_importacion_bloqueados'
       and (column_name like '%cantidad%' or column_name like '%unidades%' or column_name like '%uds%')), 0::bigint);
  -- Antes de cerrar: el intervalo abierto ya avisa del bloqueado.
  perform prueba('con el intervalo todavía abierto, el bloqueado ya avisa',
    (select bool_and('B2_26/1590|1445HWZ' = any(continuidad_docs)) from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ad01'), true);
  -- Y ahora el cierre de mayo.
  perform tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes',
    lote('2026-05', alb_fk('B2_26/2334','1445HWZ',2,'2026-05-18',753714)), false);
  perform prueba('1445HWZ: dos intervalos cerrados, los dos anómalos',
    (select count(*) from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ad01' and estado='cerrado' and km_estado='anomalos'), 2::bigint);
  perform prueba('1445HWZ: el recorrido aritmético se conserva',
    (select distinct recorrido_km::int from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ad01' and estado='cerrado'), 626290);
  perform prueba('1445HWZ: días, ritmo y límite guardados',
    (select distinct dias_intervalo||'/'||round(ritmo_km_dia)||'/'||limite_km_dia::int from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ad01' and estado='cerrado'), '98/6391/2000');
  perform prueba('1445HWZ: el aviso de ritmo da fechas, kilómetros y albaranes',
    (select bool_and(motivo_revision like '%09/02/2026%127424%B2_26/614%18/05/2026%753714%B2_26/2334%')
       from tc_reconstruccion_montajes where vehiculo_id='00000000-0000-0000-0000-00000000ad01' and estado='cerrado'), true);
  perform prueba('1445HWZ: el aviso de ritmo da los días, el ritmo y el límite',
    (select bool_and(motivo_revision like '%98 día(s), 6391 km/día, por encima del límite de 2000 km/día%')
       from tc_reconstruccion_montajes where vehiculo_id='00000000-0000-0000-0000-00000000ad01' and estado='cerrado'), true);
  perform prueba('1445HWZ: también avisa del posible montaje intermedio bloqueado',
    (select bool_and(motivo_revision like '%Posible montaje intermedio sin importar el 07/04/2026%739964%')
       from tc_reconstruccion_montajes where vehiculo_id='00000000-0000-0000-0000-00000000ad01' and estado='cerrado'), true);
  perform prueba('1445HWZ: el aviso de continuidad NO elige eje',
    (select bool_and(continuidad_motivo like '%No se sabe en qué posición fue, así que no se atribuye a ningún eje%')
       from tc_reconstruccion_montajes where vehiculo_id='00000000-0000-0000-0000-00000000ad01' and estado='cerrado'), true);
  perform prueba('1445HWZ: el documento bloqueado queda referido en el intervalo',
    (select distinct array_to_string(continuidad_docs,',') from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ad01' and estado='cerrado'), 'B2_26/1590|1445HWZ');
  perform prueba('1445HWZ: fuera de las medias, y por los DOS motivos',
    (select distinct array_to_string(tc_imp_intervalo_motivos(rm),',') from tc_reconstruccion_montajes rm
      where rm.vehiculo_id='00000000-0000-0000-0000-00000000ad01' and rm.estado='cerrado'),
    'km_anomalos_pendientes,continuidad_pendiente');
  perform prueba('1445HWZ: no entra en medias',
    (select bool_or(tc_imp_intervalo_en_medias(rm)) from tc_reconstruccion_montajes rm
      where rm.vehiculo_id='00000000-0000-0000-0000-00000000ad01' and rm.estado='cerrado'), false);
  perform prueba('1445HWZ: los montajes de mayo siguen abiertos y sin clasificar km',
    (select count(*) from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ad01' and estado='abierto' and km_estado='sin_cierre'), 2::bigint);
end $$;

-- ── 33. Un bloqueado SIN posible montaje no interrumpe por sí solo ────────
do $$ declare r jsonb; begin
  insert into tc_vehiculos (id, empresa_id, tipo_vehiculo_id, matricula, km_actual) values
    ('00000000-0000-0000-0000-00000000ad02','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000a','BLOQ002', 1)
    on conflict do nothing;
  perform tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes',
    lote('2026-02', alb_fk('B2_26/B1','BLOQ002',2,'2026-02-10',600000)), false);
  -- Un albarán bloqueado SIN gomas: solo servicios. No es evidencia de montaje.
  r := tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes',
    lote('2026-03', jsonb_build_object('origen_doc','B2_26/B2|BLOQ002','documento','B2_26/B2','matricula','BLOQ002',
      'fecha','2026-03-10','km',610000,'huella_origen','hB2','bloqueante','Fecha del documento ilegible',
      'operaciones','[]'::jsonb,'servicios','[]'::jsonb,'lineas','[]'::jsonb)), false);
  perform prueba('bloqueado sin gomas: bloqueado igual', (r->>'bloqueados')::int, 1);
  perform tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes',
    lote('2026-04', alb_fk('B2_26/B3','BLOQ002',2,'2026-04-10',620000)), false);
  perform prueba('bloqueado sin posible montaje: NO marca continuidad pendiente',
    (select bool_and(coalesce(array_length(continuidad_docs,1),0) = 0) from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ad02'), true);
  perform prueba('bloqueado sin posible montaje: el intervalo cierra limpio y entra en medias',
    (select km_estado||'/'||recorrido_km::int||'/'||tc_imp_intervalo_en_medias(rm) from tc_reconstruccion_montajes rm
      where rm.vehiculo_id='00000000-0000-0000-0000-00000000ad02' and rm.estado='cerrado' limit 1), 'utilizables/20000/true');
end $$;

-- ── 34. Revisión humana auditada: aceptar y rechazar ──────────────────────
-- La clasificación la hace la máquina; esto es otra cosa. Aceptar permite
-- usar el intervalo como ESTIMADO y nunca lo convierte en confirmado.
-- Rechazar no toca los kilómetros ni el recorrido.
do $$ declare iv uuid; r jsonb; begin
  select id into iv from tc_reconstruccion_montajes
   where vehiculo_id='00000000-0000-0000-0000-00000000ad01' and estado='cerrado'
   order by posicion_id limit 1;
  -- Motivo obligatorio
  begin
    perform tc_imp_revisar_intervalo(iv, 'kilometros', 'aceptado', '   ');
    perform prueba('revisar sin motivo no se puede', false, true);
  exception when invalid_parameter_value then perform prueba('revisar sin motivo no se puede', true, true); end;
  -- Decisión inventada
  begin
    perform tc_imp_revisar_intervalo(iv, 'kilometros', 'quizá', 'porque sí');
    perform prueba('decisión inventada no se puede', false, true);
  exception when invalid_parameter_value then perform prueba('decisión inventada no se puede', true, true); end;
  -- Aceptar
  r := tc_imp_revisar_intervalo(iv, 'kilometros', 'aceptado', 'Comprobado con el conductor: el cuentakilómetros se cambió en marzo');
  -- NO entra: sus kilómetros están aceptados, pero la continuidad sigue en
  -- duda por el albarán bloqueado. Aceptar una cosa no resuelve la otra.
  perform prueba('aceptar los km NO resuelve la continuidad: sigue fuera', (r->>'en_medias')::boolean, false);
  perform prueba('y lo dice en el motivo que queda', r->'motivos_exclusion'->>0, 'continuidad_pendiente');
  perform prueba('aceptado: el aviso dice que sigue siendo estimado y que no resuelve la continuidad',
    (r->>'aviso' like '%No lo convierte en rendimiento confirmado%') and (r->>'aviso' like '%NO resuelve su continuidad%'), true);
  perform prueba('aceptado: la clasificación automática NO cambia', r->>'km_estado', 'anomalos');
  perform prueba('aceptado: el recorrido sigue ahí', (r->>'recorrido_km')::int, 626290);
  perform prueba('aceptado: el nivel sigue siendo estimado',
    (select nivel from tc_reconstruccion_montajes where id=iv), 'estimado');
  -- Y ahora sí, la continuidad, que es una decisión aparte.
  r := tc_imp_revisar_intervalo(iv, 'continuidad', 'aceptado', 'Mirado el albarán bloqueado: era un pedido anulado, no hubo montaje');
  perform prueba('con las DOS decisiones, ya entra en las medias', (r->>'en_medias')::boolean, true);
  perform prueba('y las dos constan por separado',
    (r->>'uso_estadistico')||'/'||(r->>'continuidad_decision'), 'aceptado/aceptada');
  perform prueba('la auditoría guarda cada ámbito por su cuenta',
    (select string_agg(ambito||':'||decision, ',' order by ambito) from tc_reconstruccion_revisiones
      where operacion_entrada_id = (select operacion_entrada_id from tc_reconstruccion_montajes where id=iv)
        and invalidada_at is null), 'continuidad:aceptado,kilometros:aceptado');
  perform prueba('aceptado: queda usuario, fecha y motivo',
    (select (revisado_por is not null)||'/'||(revisado_at is not null)||'/'||(revisado_motivo like '%cuentakilómetros%')
       from tc_reconstruccion_montajes where id=iv), 'true/true/true');
  perform prueba('aceptado: hay una fila de auditoría con su motivo y su usuario',
    (select count(*) from tc_reconstruccion_revisiones
      where operacion_entrada_id = (select operacion_entrada_id from tc_reconstruccion_montajes where id=iv)
        and decision='aceptado' and usuario_id is not null and motivo like '%cuentakilómetros%'), 1::bigint);
  perform prueba('aceptado: la auditoría guarda el ritmo y el límite del momento',
    (select round(ritmo_km_dia)||'/'||limite_km_dia::int from tc_reconstruccion_revisiones
      where operacion_entrada_id = (select operacion_entrada_id from tc_reconstruccion_montajes where id=iv)
        and decision='aceptado' limit 1), '6391/2000');
  -- Rechazar el OTRO intervalo del mismo vehículo
  select id into iv from tc_reconstruccion_montajes
   where vehiculo_id='00000000-0000-0000-0000-00000000ad01' and estado='cerrado'
   order by posicion_id desc limit 1;
  r := tc_imp_revisar_intervalo(iv, 'kilometros', 'rechazado', 'La lectura de febrero no es creíble y no hay forma de confirmarla');
  perform prueba('rechazado: no entra en medias', (r->>'en_medias')::boolean, false);
  perform prueba('rechazado: los kilómetros NO pasan a ausentes ni a decrecientes',
    (select km_estado||'/'||recorrido_km::int||'/'||km_montaje::int||'/'||km_desmontaje::int
       from tc_reconstruccion_montajes where id=iv), 'anomalos/626290/127424/753714');
  perform prueba('rechazado: su motivo de exclusión lo dice',
    (select array_to_string(tc_imp_intervalo_motivos(rm),',') from tc_reconstruccion_montajes rm where rm.id=iv),
    'km_anomalos_rechazados,continuidad_pendiente');
  -- Aceptar la continuidad de un intervalo con los km rechazados no lo mete
  -- en las medias: la otra puerta sigue cerrada.
  perform tc_imp_revisar_intervalo(iv, 'continuidad', 'aceptado', 'El bloqueado no afecta a esta posición');
  perform prueba('con la continuidad aceptada pero los km rechazados, sigue fuera',
    (select tc_imp_intervalo_en_medias(rm) from tc_reconstruccion_montajes rm where rm.id=iv), false);
  perform prueba('y el motivo que queda es el de los kilómetros',
    (select array_to_string(tc_imp_intervalo_motivos(rm),',') from tc_reconstruccion_montajes rm where rm.id=iv),
    'km_anomalos_rechazados');
  -- Un intervalo sin recorrido no se puede aceptar ni rechazar
  select id into iv from tc_reconstruccion_montajes
   where vehiculo_id='00000000-0000-0000-0000-00000000ab03' and km_estado='ausentes' limit 1;
  begin
    perform tc_imp_revisar_intervalo(iv, 'kilometros', 'aceptado', 'da igual');
    perform prueba('sin recorrido no hay nada que aceptar', false, true);
  exception when invalid_parameter_value then perform prueba('sin recorrido no hay nada que aceptar', true, true); end;
end $$;
-- Permisos y aislamiento entre empresas
update auth_ctx set rol='operador';
do $$ declare iv uuid; begin
  select id into iv from tc_reconstruccion_montajes where vehiculo_id='00000000-0000-0000-0000-00000000ad01' and estado='cerrado' limit 1;
  begin
    perform tc_imp_revisar_intervalo(iv, 'kilometros', 'aceptado', 'no debería poder');
    perform prueba('un operador no puede revisar', false, true);
  exception when insufficient_privilege then perform prueba('un operador no puede revisar', true, true); end;
end $$;
update auth_ctx set rol='admin', empresa='00000000-0000-0000-0000-0000000000e2';
do $$ declare iv uuid; begin
  select id into iv from tc_reconstruccion_montajes where vehiculo_id='00000000-0000-0000-0000-00000000ad01' and estado='cerrado' limit 1;
  begin
    perform tc_imp_revisar_intervalo(iv, 'kilometros', 'aceptado', 'de otra empresa');
    perform prueba('el admin de otra empresa no puede revisar', false, true);
  exception when insufficient_privilege then perform prueba('el admin de otra empresa no puede revisar', true, true); end;
  begin
    perform tc_imp_fijar_limite_km_dia('00000000-0000-0000-0000-0000000000e1', 9999);
    perform prueba('el admin de otra empresa no puede cambiar el límite', false, true);
  exception when insufficient_privilege then perform prueba('el admin de otra empresa no puede cambiar el límite', true, true); end;
end $$;
update auth_ctx set rol='admin', empresa='00000000-0000-0000-0000-0000000000e1';

-- ── 35. Si cambia la evidencia, la aceptación caduca ──────────────────────
-- Y la auditoría no se borra: queda la decisión, queda su invalidación y
-- queda el motivo. Rehacer la cadena no puede hacer desaparecer una
-- decisión humana ni arrastrarla a una evidencia distinta.
do $$ declare iv uuid; oe uuid; begin
  insert into tc_vehiculos (id, empresa_id, tipo_vehiculo_id, matricula, km_actual) values
    ('00000000-0000-0000-0000-00000000ae01','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000a','CADUCA1', 1)
    on conflict do nothing;
  perform tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes',
    lote('2026-01', alb_fk('B2_26/E1','CADUCA1',2,'2026-01-05',700000)), false);
  perform tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes',
    lote('2026-05', alb_fk('B2_26/E3','CADUCA1',2,'2026-05-05',1100000)), false);
  select id, operacion_entrada_id into iv, oe from tc_reconstruccion_montajes
   where vehiculo_id='00000000-0000-0000-0000-00000000ae01' and estado='cerrado' order by posicion_id limit 1;
  perform prueba('caduca: el intervalo nace anómalo (400.000 km en 120 días)',
    (select km_estado from tc_reconstruccion_montajes where id=iv), 'anomalos');
  perform tc_imp_revisar_intervalo(iv, 'kilometros', 'aceptado', 'Revisado con el taller: la lectura es correcta');
  perform prueba('caduca: aceptado, entra en medias',
    (select tc_imp_intervalo_en_medias(rm) from tc_reconstruccion_montajes rm where rm.id=iv), true);
  -- Ahora aparece un albarán BLOQUEADO dentro del intervalo: la evidencia
  -- del intervalo ya no es la que había cuando se aceptó.
  perform tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes',
    lote('2026-03', alb_fk('B2_26/E2','CADUCA1',4,'2026-03-05',900000,'recauchutada')
      || jsonb_build_object('bloqueante','Uds. = 4 sin saber si son 4 o 16')), false);
  perform prueba('caduca: la aceptación deja de aplicarse',
    (select uso_estadistico from tc_reconstruccion_montajes where operacion_entrada_id=oe), 'pendiente');
  perform prueba('caduca: y el intervalo vuelve a quedar fuera de las medias',
    (select tc_imp_intervalo_en_medias(rm) from tc_reconstruccion_montajes rm where rm.operacion_entrada_id=oe), false);
  perform prueba('caduca: el intervalo pide revisión otra vez y lo explica',
    (select motivo_revision like '%ya no vale: la evidencia del intervalo ha cambiado%'
       from tc_reconstruccion_montajes where operacion_entrada_id=oe), true);
  perform prueba('caduca: la aceptación anterior sigue en la auditoría, marcada como invalidada',
    (select count(*) from tc_reconstruccion_revisiones
      where operacion_entrada_id=oe and decision='aceptado' and invalidada_at is not null), 1::bigint);
  perform prueba('caduca: la invalidación dice de qué ámbito era',
    (select ambito from tc_reconstruccion_revisiones where operacion_entrada_id=oe and decision='invalidada'), 'kilometros');
  perform prueba('caduca: el motivo original de la persona NO se ha borrado',
    (select motivo from tc_reconstruccion_revisiones where operacion_entrada_id=oe and decision='aceptado'),
    'Revisado con el taller: la lectura es correcta');
  perform prueba('caduca: hay constancia de la invalidación, escrita por el sistema',
    (select count(*) from tc_reconstruccion_revisiones
      where operacion_entrada_id=oe and decision='invalidada' and usuario_id is null), 1::bigint);
  perform prueba('caduca: nada se ha borrado de la auditoría',
    (select count(*) from tc_reconstruccion_revisiones where operacion_entrada_id=oe), 2::bigint);
  -- Y se puede volver a revisar sobre la evidencia nueva.
  select id into iv from tc_reconstruccion_montajes where operacion_entrada_id=oe;
  perform tc_imp_revisar_intervalo(iv, 'kilometros', 'aceptado', 'Visto el albarán bloqueado: no hubo montaje, era un pedido anulado');
  perform prueba('caduca: la revisión nueva sí se aplica',
    (select uso_estadistico from tc_reconstruccion_montajes where id=iv), 'aceptado');
  perform prueba('pero con el bloqueado dentro sigue fuera de las medias hasta decidir la continuidad',
    (select tc_imp_intervalo_en_medias(rm) from tc_reconstruccion_montajes rm where rm.id=iv), false);
  perform tc_imp_revisar_intervalo(iv, 'continuidad', 'aceptado', 'El albarán bloqueado no trajo montaje');
  perform prueba('con las dos, ya entra',
    (select tc_imp_intervalo_en_medias(rm) from tc_reconstruccion_montajes rm where rm.id=iv), true);
  perform prueba('caduca: y la decisión aguanta una reconstrucción que no cambia nada',
    (select uso_estadistico from tc_reconstruccion_montajes where operacion_entrada_id=oe
      and (select tc_imp_reconstruir_vehiculo('00000000-0000-0000-0000-00000000ae01')) >= 0), 'aceptado');
end $$;

-- ── 36. Deshacer: limpio, con revisión humana, y lo que NUNCA se revierte ─
do $$ declare r jsonb; l uuid; lmay uuid; v uuid; op uuid; obs text; c0 int; c1 int; f0 text; begin
  -- ── Una revisión humana conserva la intervención ───────────────────────
  select l2.id into l from tc_importacion_lotes l2 where l2.periodo='2026-02'
    and exists (select 1 from tc_importacion_intervenciones ii join tc_intervenciones i on i.id=ii.intervencion_id
                 where ii.lote_id=l2.id and i.origen_doc='B2_26/614|1445HWZ');
  r := tc_deshacer_importacion(l, '{}', true);
  perform prueba('deshacer con intervalos revisados a mano: se conserva',
    (r->'detalle'->0->>'resultado'), 'conservada');
  perform prueba('deshacer con intervalos revisados a mano: lo dice en el motivo',
    (r->'detalle'->0->'motivos')::text like '%revisión humana%', true);
  perform prueba('deshacer con intervalos revisados a mano: la simulación no ha tocado nada',
    (select count(*) from tc_intervenciones where origen_doc='B2_26/614|1445HWZ'), 1::bigint);

  -- ── Deshacer el lote que CIERRA invalida la decisión del otro lote ─────
  select l2.id into lmay from tc_importacion_lotes l2 where l2.periodo='2026-05'
    and exists (select 1 from tc_importacion_intervenciones ii join tc_intervenciones i on i.id=ii.intervencion_id
                 where ii.lote_id=l2.id and i.origen_doc='B2_26/2334|1445HWZ');
  perform tc_deshacer_importacion(lmay, '{}', false);
  perform prueba('deshecho el cierre: los intervalos de febrero vuelven a estar abiertos',
    (select count(*) from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ad01' and estado='abierto'), 2::bigint);
  perform prueba('deshecho el cierre: las decisiones humanas caducan (la evidencia ya no es la misma)',
    (select count(*) from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ad01' and uso_estadistico <> 'pendiente'), 0::bigint);
  -- Cuatro decisiones: kilómetros y continuidad en cada uno de los dos
  -- intervalos del eje. Ninguna se borra y todas quedan invalidadas.
  perform prueba('deshecho el cierre: la auditoría de las decisiones NO se ha borrado',
    (select count(*) from tc_reconstruccion_revisiones rv
      where rv.vehiculo_id='00000000-0000-0000-0000-00000000ad01' and rv.decision in ('aceptado','rechazado')), 4::bigint);
  perform prueba('deshecho el cierre: todas quedan marcadas como invalidadas',
    (select count(*) from tc_reconstruccion_revisiones rv
      where rv.vehiculo_id='00000000-0000-0000-0000-00000000ad01' and rv.invalidada_at is not null), 4::bigint);
  perform prueba('deshecho el cierre: la auditoría conserva empresa, actor, fecha, motivo y referencias',
    (select bool_and(empresa_id is not null and vehiculo_id is not null and operacion_entrada_id is not null
                     and fecha_montaje is not null and creado_at is not null and btrim(motivo) <> ''
                     and (usuario_id is not null or decision = 'invalidada'))
       from tc_reconstruccion_revisiones where vehiculo_id='00000000-0000-0000-0000-00000000ad01'), true);
  perform prueba('deshecho el cierre: el aviso del bloqueado sigue en pie',
    (select bool_and('B2_26/1590|1445HWZ' = any(continuidad_docs)) from tc_reconstruccion_montajes
      where vehiculo_id='00000000-0000-0000-0000-00000000ad01'), true);

  -- ── Deshacer limpio, y lo que no se revierte ───────────────────────────
  insert into tc_vehiculos (id, empresa_id, tipo_vehiculo_id, matricula, km_actual) values
    ('00000000-0000-0000-0000-00000000af01','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000a','LIMPIO1', 123456)
    on conflict do nothing;
  f0 := foto();
  c0 := coalesce((select ultimo from tc_contadores_numero_interno where anio = extract(year from now())::int), 0);
  r := tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes',
    lote('2026-07', alb_fk('B2_26/L1','LIMPIO1',2,'2026-07-01',800000)
      || jsonb_build_object('bloqueante', null)), false);
  select l2.id into l from tc_importacion_lotes l2 where l2.id = (r->>'lote_id')::uuid;
  c1 := (select ultimo from tc_contadores_numero_interno where anio = extract(year from now())::int);
  perform prueba('la importación ha emitido números internos', c1 > c0, true);

  -- Una modificación humana posterior NO se tapa al rehacer la cadena.
  select o.id, o.observaciones into op, obs from operaciones_neumaticos o
    join tc_intervenciones i on i.id=o.intervencion_id
   where i.origen_doc='B2_26/L1|LIMPIO1' and o.tipo_operacion='montaje' limit 1;
  update operaciones_neumaticos set observaciones = 'alguien escribió esto a mano' where id = op;
  perform tc_imp_reconstruir_vehiculo('00000000-0000-0000-0000-00000000af01');
  r := tc_deshacer_importacion(l, '{}', true);
  perform prueba('rehacer la cadena NO actualiza la huella para tapar un cambio ajeno',
    (r->'detalle'->0->'motivos')::text like '%Modificada después de importarla%', true);
  perform prueba('y por eso la intervención se conservaría', (r->'detalle'->0->>'resultado'), 'conservada');
  -- Deshecho el cambio humano, la huella vuelve a cuadrar.
  update operaciones_neumaticos set observaciones = obs where id = op;
  perform tc_imp_reconstruir_vehiculo('00000000-0000-0000-0000-00000000af01');
  r := tc_deshacer_importacion(l, '{}', false);
  perform prueba('deshacer limpio: se borra, nada conservado',
    (r->>'borradas')||'/'||(r->>'conservadas')||'/'||(r->>'estado'), '1/0/deshecho');
  perform prueba('deshacer limpio: no queda intervención',
    (select count(*) from tc_intervenciones where origen_doc='B2_26/L1|LIMPIO1'), 0::bigint);
  perform prueba('deshacer limpio: no quedan intervalos del vehículo',
    (select count(*) from tc_reconstruccion_montajes where vehiculo_id='00000000-0000-0000-0000-00000000af01'), 0::bigint);
  perform prueba('deshacer limpio: ni fichas de la importación',
    (select count(*) from tc_neumaticos where importacion_lote_id = l), 0::bigint);
  perform prueba('deshacer limpio: la fotografía de lo ajeno vuelve a cuadrar', foto(), f0);
  perform prueba('el contador de números internos NO vuelve atrás: lo emitido no se reutiliza',
    (select ultimo from tc_contadores_numero_interno where anio = extract(year from now())::int), c1);
  -- Y la numeración siguiente arranca por encima, sin reutilizar el hueco.
  perform tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes',
    lote('2026-07', alb_fk('B2_26/L2','LIMPIO1',2,'2026-07-02',800100)), false);
  perform prueba('la importación siguiente numera por encima del hueco',
    (select ultimo from tc_contadores_numero_interno where anio = extract(year from now())::int) > c1, true);
  perform prueba('el km del vehículo sigue siendo el suyo: la importación no lo toca',
    (select km_actual::int||'/'||origen_km from tc_vehiculos where id='00000000-0000-0000-0000-00000000af01'), '123456/manual');
end $$;

-- ── 37. Cobertura de las estadísticas estimadas ───────────────────────────
-- Ninguna media sin decir sobre cuántos intervalos se calcula, qué ha dejado
-- fuera y por qué, y sin mezclar unidades con ocupaciones de posición.
do $$ declare c jsonb; begin
  c := tc_informes_recorridos_estimados('00000000-0000-0000-0000-0000000000e1', null, null, null);
  perform prueba('la cobertura dice que es estimado', c->>'nivel', 'estimado');
  perform prueba('la cobertura avisa de que no es rendimiento confirmado',
    c->>'aviso' like '%No son rendimiento confirmado%', true);
  perform prueba('la cobertura publica el periodo analizado',
    (c->'periodo'->>'desde' is not null) and (c->'periodo'->>'hasta' is not null), true);
  perform prueba('la cobertura publica la población',
    (c->'poblacion'->>'intervalos')::int > 0 and (c->'poblacion'->>'vehiculos')::int > 0, true);
  perform prueba('la cobertura separa identidad respaldada, reconstruida y sin ficha, y suman',
    (c->'identidad'->>'respaldada')::int + (c->'identidad'->>'reconstruida')::int + (c->'identidad'->>'sin_ficha')::int
      = (c->'poblacion'->>'intervalos')::int, true);
  perform prueba('y distingue identificación física de tener ficha',
    (c->'identidad'->>'que_es' like '%no es lo mismo que «sin ficha»%'), true);
  perform prueba('publica el embudo: calculables frente a elegibles',
    (c->'embudo'->>'con_recorrido_aritmetico')::int >= (c->'embudo'->>'elegibles_tras_filtros')::int, true);
  perform prueba('y los elegibles son los que sostienen la media',
    (c->'embudo'->>'elegibles_tras_filtros'), (c->'incluidos'->>'n'));
  perform prueba('los incluidos y los excluidos suman la población',
    (c->'incluidos'->>'n')::int + (c->'excluidos'->>'n')::int = (c->'poblacion'->>'intervalos')::int, true);
  perform prueba('el recorrido viene en tres grupos, nunca en un solo número',
    (c->'recorrido'->'identidad_respaldada' is not null) and (c->'recorrido'->'ficha_reconstruida' is not null)
      and (c->'recorrido'->'ocupacion_sin_ficha' is not null), true);
  perform prueba('la ficha reconstruida se presenta como lo que es',
    c->'recorrido'->'ficha_reconstruida'->>'que_es' like '%NO demuestra qué neumático estuvo montado%', true);
  perform prueba('y la ocupación sin ficha, también',
    c->'recorrido'->'ocupacion_sin_ficha'->>'que_es' like '%No es el rendimiento de ningún neumático%', true);
  -- En el banco hay UNA ficha que una persona identificó (sección 16). Esa
  -- cuenta como unidad identificada; las demás, con ficha reconstruida por la
  -- importación, cuentan como ocupación de la posición.
  perform prueba('solo la ficha que una persona identificó cuenta como respaldada',
    (c->'identidad'->>'respaldada')||'/'||(c->'incluidos'->>'respaldada'), '1/1');
  perform prueba('las fichas reconstruidas van en su propio grupo, ni unidades ni sin ficha',
    (c->'incluidos'->>'respaldada')::int + (c->'incluidos'->>'reconstruida')::int
      + (c->'incluidos'->>'sin_ficha')::int = (c->'incluidos'->>'n')::int, true);
  perform prueba('se avisa de que los motivos se solapan', (c->'excluidos'->>'motivos_se_solapan')::boolean, true);
  perform prueba('las combinaciones de motivos SÍ suman el total de excluidos',
    (select sum((x->>'n')::int)::int from jsonb_array_elements(c->'excluidos'->'combinaciones') x), (c->'excluidos'->>'n')::int);
  perform prueba('los motivos sueltos, en cambio, pueden sumar más (se solapan)',
    (select sum((x->>'n')::int) from jsonb_array_elements(c->'excluidos'->'motivos') x) >= (c->'excluidos'->>'n')::int, true);
  perform prueba('entre los motivos está la continuidad pendiente',
    (select count(*) from jsonb_array_elements(c->'excluidos'->'motivos') x where x->>'motivo'='continuidad_pendiente') = 1, true);
  perform prueba('y los kilómetros anómalos aparecen como motivo propio',
    (select count(*) from jsonb_array_elements(c->'excluidos'->'motivos') x where x->>'motivo' like 'km_anomalos%') >= 1, true);
  perform prueba('el informe de montajes publica la cobertura en el mismo sitio',
    tc_informes_montajes('00000000-0000-0000-0000-0000000000e1','2026-01-01','2026-12-31')->'recorridos_estimados'->>'nivel', 'estimado');
  -- Un vehículo concreto
  c := tc_informes_recorridos_estimados('00000000-0000-0000-0000-0000000000e1', null, null, '00000000-0000-0000-0000-00000000ac01');
  perform prueba('por vehículo: la media sale de los que entran, como ficha reconstruida',
    (c->'recorrido'->'ficha_reconstruida'->>'n')||'/'||(c->'recorrido'->'ficha_reconstruida'->>'media'), '2/180000');
  perform prueba('por vehículo: y se dice cuántos entran y cuántos no',
    (c->'incluidos'->>'n')||' de '||(c->'poblacion'->>'intervalos')||', '||(c->'excluidos'->>'n')||' fuera',
    '2 de 4, 2 fuera');
  perform prueba('por vehículo: los que quedan fuera dicen por qué (aquí, sin cerrar)',
    c->'excluidos'->'motivos'->0->>'motivo', 'sin_cierre');
  perform prueba('por vehículo: no se inventa una media de identidad respaldada si no hay ninguna',
    c->'recorrido'->'identidad_respaldada'->>'media', null);
end $$;

-- ── 38. Qué entra REALMENTE en las medias ────────────────────────────────
-- No se comprueba caso a caso sino como invariante sobre TODOS los intervalos
-- del banco: si alguno entrara sin cumplir una de las condiciones, aquí se ve.
do $$ begin
  perform prueba('nadie entra sin estar cerrado y con recorrido calculable',
    (select count(*) from tc_reconstruccion_montajes rm where tc_imp_intervalo_en_medias(rm)
       and (rm.estado <> 'cerrado' or rm.recorrido_km is null
            or rm.km_estado not in ('utilizables','anomalos'))), 0::bigint);
  perform prueba('nadie entra con el uso estadístico rechazado',
    (select count(*) from tc_reconstruccion_montajes rm
      where tc_imp_intervalo_en_medias(rm) and rm.uso_estadistico = 'rechazado'), 0::bigint);
  perform prueba('ningún anómalo entra sin aceptación expresa de los kilómetros',
    (select count(*) from tc_reconstruccion_montajes rm
      where tc_imp_intervalo_en_medias(rm) and rm.km_estado = 'anomalos'
        and rm.uso_estadistico <> 'aceptado'), 0::bigint);
  perform prueba('ninguno del mismo día sin orden conocido entra sin revisar',
    (select count(*) from tc_reconstruccion_montajes rm
      where tc_imp_intervalo_en_medias(rm) and rm.orden_desconocido
        and rm.uso_estadistico <> 'aceptado'), 0::bigint);
  perform prueba('ninguno con continuidad en duda entra sin aceptarla expresamente',
    (select count(*) from tc_reconstruccion_montajes rm
      where tc_imp_intervalo_en_medias(rm) and tc_imp_intervalo_duda_continuidad(rm)
        and rm.continuidad_decision <> 'aceptada'), 0::bigint);
  perform prueba('ninguno con la continuidad rechazada entra',
    (select count(*) from tc_reconstruccion_montajes rm
      where tc_imp_intervalo_en_medias(rm) and rm.continuidad_decision = 'rechazada'), 0::bigint);
  -- Una decisión viva tiene que estar tomada sobre la evidencia de AHORA.
  perform prueba('ninguna decisión viva cuelga de una evidencia distinta de la actual',
    (select count(*) from tc_reconstruccion_montajes rm
      where (rm.uso_estadistico <> 'pendiente' and rm.revision_huella is distinct from tc_imp_huella_intervalo(rm.id))
         or (rm.continuidad_decision <> 'pendiente' and rm.continuidad_huella is distinct from tc_imp_huella_intervalo(rm.id))), 0::bigint);
  -- Motivos: los que entran no tienen ninguno; los que no, al menos uno.
  perform prueba('el que entra no tiene motivos de exclusión',
    (select count(*) from tc_reconstruccion_montajes rm
      where tc_imp_intervalo_en_medias(rm) and coalesce(array_length(tc_imp_intervalo_motivos(rm),1),0) > 0), 0::bigint);
  perform prueba('el que no entra tiene al menos uno',
    (select count(*) from tc_reconstruccion_montajes rm
      where not tc_imp_intervalo_en_medias(rm) and coalesce(array_length(tc_imp_intervalo_motivos(rm),1),0) = 0), 0::bigint);
end $$;
-- Y el recuento publicado tiene que cuadrar con la realidad de la tabla.
do $$ declare c jsonb; n_real bigint; n_arit bigint; begin
  c := tc_informes_recorridos_estimados('00000000-0000-0000-0000-0000000000e1', '2000-01-01', '2100-01-01', null);
  select count(*) into n_real from tc_reconstruccion_montajes rm
   where rm.empresa_id='00000000-0000-0000-0000-0000000000e1' and tc_imp_intervalo_en_medias(rm);
  select count(*) into n_arit from tc_reconstruccion_montajes
   where empresa_id='00000000-0000-0000-0000-0000000000e1' and estado='cerrado'
     and km_estado in ('utilizables','anomalos') and recorrido_km is not null;
  perform prueba('el número publicado es el que de verdad entra', (c->'incluidos'->>'n')::bigint, n_real);
  perform prueba('y el embudo publica también los aritméticamente calculables',
    (c->'embudo'->>'con_recorrido_aritmetico')::bigint, n_arit);
  perform prueba('calculables y elegibles NO son lo mismo en este banco', n_arit > n_real, true);
  perform prueba('las combinaciones de motivos suman el total de excluidos, sin contar dos veces',
    (select coalesce(sum((x->>'n')::int),0)::int from jsonb_array_elements(c->'excluidos'->'combinaciones') x),
    (c->'excluidos'->>'n')::int);
  perform prueba('la suma de motivos sueltos es mayor: se solapan',
    (select coalesce(sum((x->>'n')::int),0) from jsonb_array_elements(c->'excluidos'->'motivos') x)
      > (c->'excluidos'->>'n')::int, true);
  perform prueba('incluidos + excluidos = población, sin huecos',
    (c->'incluidos'->>'n')::int + (c->'excluidos'->>'n')::int, (c->'poblacion'->>'intervalos')::int);
end $$;

-- ── 39. Identidad: tres grupos que no se confunden ───────────────────────
-- Una ficha reconstruida NO es una unidad identificada, pero tampoco es «sin
-- ficha»: la ficha existe y sirve para enlazar el registro histórico.
do $$ declare c jsonb; begin
  c := tc_informes_recorridos_estimados('00000000-0000-0000-0000-0000000000e1', '2000-01-01', '2100-01-01', null);
  perform prueba('los tres grupos de identidad suman la población',
    (c->'identidad'->>'respaldada')::int + (c->'identidad'->>'reconstruida')::int
      + (c->'identidad'->>'sin_ficha')::int, (c->'poblacion'->>'intervalos')::int);
  perform prueba('hay fichas reconstruidas, y no se cuentan como respaldadas',
    (c->'identidad'->>'reconstruida')::int > 0 and (c->'identidad'->>'respaldada')::int
      < (c->'identidad'->>'reconstruida')::int, true);
  perform prueba('la ficha reconstruida tiene número interno: no es «sin ficha»',
    (select count(*) from tc_reconstruccion_montajes rm join tc_neumaticos n on n.id = rm.neumatico_id
      where n.identidad_reconstruida and n.numero_interno is not null) > 0, true);
  perform prueba('y el texto lo explica sin confundir las dos cosas',
    c->'identidad'->>'que_es' like '%no es lo mismo que «sin ficha»%', true);
  perform prueba('ninguna media de fichas reconstruidas se presenta como rendimiento individual',
    c->'recorrido'->'ficha_reconstruida'->>'que_es' like '%No es rendimiento individual%', true);
end $$;

-- ── 40. La auditoría es de verdad append-only, y aísla empresas ──────────
-- Se ejecuta como el rol `authenticated`, no como el dueño: el dueño se salta
-- la RLS y no probaría nada. Y se le conceden a posta los permisos que en
-- Supabase da la plataforma, para comprobar que aun con ellos la RLS niega
-- escribir.
grant usage on schema public to authenticated, anon;
grant select on auth_ctx to authenticated;
grant select, insert, update, delete on tc_reconstruccion_revisiones to authenticated;
grant select, insert, update, delete on tc_reconstruccion_montajes to authenticated;
create or replace function tc_puede_ver_empresa(e uuid) returns boolean language sql stable as
  $$ select e = (select empresa from auth_ctx limit 1) $$;
do $$ declare n bigint; iv uuid; oe uuid; begin
  select id, operacion_entrada_id into iv, oe from tc_reconstruccion_revisiones
    where empresa_id='00000000-0000-0000-0000-0000000000e1' limit 1;
  set local role authenticated;
  -- Leer: sí, lo de su empresa.
  select count(*) into n from tc_reconstruccion_revisiones;
  perform prueba('un usuario autenticado ve la auditoría de SU empresa', n > 0, true);
  -- Escribir: no, de ninguna de las tres formas.
  begin
    insert into tc_reconstruccion_revisiones (empresa_id, vehiculo_id, operacion_entrada_id, fecha_montaje,
      ambito, decision, motivo, huella_evidencia)
    values ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000ad01', oe, '2026-01-01',
            'kilometros','aceptado','decisión falsificada','x');
    perform prueba('no se puede INSERTAR una decisión a mano', false, true);
  exception when insufficient_privilege then perform prueba('no se puede INSERTAR una decisión a mano', true, true);
  end;
  begin
    update tc_reconstruccion_revisiones set motivo = 'reescrito' where id = iv;
    get diagnostics n = row_count;
    perform prueba('no se puede MODIFICAR una decisión', n, 0::bigint);
  exception when insufficient_privilege then perform prueba('no se puede MODIFICAR una decisión', true, true);
  end;
  begin
    delete from tc_reconstruccion_revisiones where id = iv;
    get diagnostics n = row_count;
    perform prueba('no se puede BORRAR una decisión', n, 0::bigint);
  exception when insufficient_privilege then perform prueba('no se puede BORRAR una decisión', true, true);
  end;
  -- Ni falsificar la decisión escribiendo directamente en el intervalo.
  begin
    update tc_reconstruccion_montajes set uso_estadistico = 'aceptado' where uso_estadistico = 'pendiente';
    get diagnostics n = row_count;
    perform prueba('no se puede marcar un intervalo como aceptado por escritura directa', n, 0::bigint);
  exception when insufficient_privilege then
    perform prueba('no se puede marcar un intervalo como aceptado por escritura directa', true, true);
  end;
  reset role;
end $$;
-- Aislamiento: el mismo rol, con la empresa de otro, no ve nada.
update auth_ctx set empresa='00000000-0000-0000-0000-0000000000e2';
do $$ declare n bigint; begin
  set local role authenticated;
  select count(*) into n from tc_reconstruccion_revisiones where empresa_id='00000000-0000-0000-0000-0000000000e1';
  perform prueba('con otra empresa no se ve la auditoría ajena', n, 0::bigint);
  select count(*) into n from tc_reconstruccion_montajes where empresa_id='00000000-0000-0000-0000-0000000000e1';
  perform prueba('ni los intervalos ajenos', n, 0::bigint);
  reset role;
end $$;
update auth_ctx set empresa='00000000-0000-0000-0000-0000000000e1';
-- Y `anon`, que en el banco no tiene ni permiso de tabla, falla ANTES de la
-- RLS: es un rechazo distinto y conviene no confundirlos.
do $$ declare n bigint; begin
  set local role anon;
  begin
    select count(*) into n from tc_reconstruccion_revisiones;
    perform prueba('anon no puede ni leer la auditoría', false, true);
  exception when insufficient_privilege then perform prueba('anon no puede ni leer la auditoría', true, true);
  end;
  reset role;
end $$;
-- Se deja el stub como estaba para no afectar a nada que venga después.
create or replace function tc_puede_ver_empresa(e uuid) returns boolean language sql stable as $$ select true $$;

-- ── 41. La auditoría sobrevive al deshacer con todo lo necesario ─────────
do $$ declare l uuid; n bigint; r jsonb; begin
  select l2.id into l from tc_importacion_lotes l2 where l2.periodo='2026-01'
    and exists (select 1 from tc_importacion_intervenciones ii join tc_intervenciones i on i.id=ii.intervencion_id
                 where ii.lote_id=l2.id and i.origen_doc='B2_26/E1|CADUCA1');
  if l is null then perform prueba('(no hay lote de CADUCA1 que deshacer)', true, true); return; end if;
  select count(*) into n from tc_reconstruccion_revisiones rv
   where rv.vehiculo_id='00000000-0000-0000-0000-00000000ae01';
  perform prueba('CADUCA1 tiene decisiones auditadas antes de deshacer', n > 0, true);
  r := tc_deshacer_importacion(l, '{}', false);
  -- Ese lote NO se deshace entero: su intervalo está revisado a mano y las
  -- decisiones humanas no se revierten en silencio.
  perform prueba('deshacer conserva la intervención con el intervalo revisado',
    (r->>'conservadas')::int > 0, true);
  perform prueba('y dice por qué', (r->'detalle'->0->'motivos')::text like '%revisión humana%', true);
  perform prueba('tras deshacer, la auditoría sigue entera',
    (select count(*) from tc_reconstruccion_revisiones rv where rv.vehiculo_id='00000000-0000-0000-0000-00000000ae01'), n);
  perform prueba('y conserva empresa, actor, fecha, motivo y referencias',
    (select bool_and(empresa_id is not null and vehiculo_id is not null and operacion_entrada_id is not null
                     and fecha_montaje is not null and creado_at is not null and btrim(motivo) <> '')
       from tc_reconstruccion_revisiones where vehiculo_id='00000000-0000-0000-0000-00000000ae01'), true);
  -- Y si la operación desaparece por fuera (alguien borra a mano, que es el
  -- único camino que queda), la auditoría tampoco se va con ella: no tiene
  -- clave ajena hacia la operación a propósito.
  delete from tc_reconstruccion_montajes where vehiculo_id='00000000-0000-0000-0000-00000000ae01';
  delete from operaciones_neumaticos where vehiculo_id='00000000-0000-0000-0000-00000000ae01';
  perform prueba('la auditoría sobrevive aunque la operación ya no exista',
    (select count(*) from tc_reconstruccion_revisiones rv
      where rv.vehiculo_id='00000000-0000-0000-0000-00000000ae01'
        and not exists (select 1 from operaciones_neumaticos o where o.id = rv.operacion_entrada_id)), n);
end $$;
