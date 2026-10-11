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
create table tc_neumaticos (id uuid primary key default gen_random_uuid(), empresa_id uuid, numero_interno text, medida text, marca text, modelo text);
create table tc_montajes_actuales (id uuid primary key default gen_random_uuid(), empresa_id uuid, vehiculo_id uuid, posicion_id uuid, neumatico_id uuid);
create table tc_historial_montajes (id uuid primary key default gen_random_uuid(), vehiculo_id uuid);
create table movimientos_stock (id uuid primary key default gen_random_uuid(), cantidad int);
create table revisiones_vehiculo (id uuid primary key default gen_random_uuid(), empresa_id uuid, vehiculo_id uuid, fecha_revision date);
create table revisiones_neumaticos_detalle (id uuid primary key default gen_random_uuid(), revision_id uuid);

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
create table tc_operacion_movimientos (id uuid primary key default gen_random_uuid(), operacion_id uuid references operaciones_neumaticos(id) on delete cascade);
create table tc_operacion_estado_historial (id uuid primary key default gen_random_uuid(), operacion_id uuid references operaciones_neumaticos(id) on delete cascade);
create table tc_operacion_auditoria (id uuid primary key default gen_random_uuid(), operacion_id uuid references operaciones_neumaticos(id) on delete set null, accion text, datos_anteriores jsonb, datos_nuevos jsonb, motivo text, created_at timestamptz default now());
create table autorizaciones_operaciones (id uuid primary key default gen_random_uuid(), operacion_id uuid references operaciones_neumaticos(id) on delete set null);
create table tc_reservas_neumatico (id uuid primary key default gen_random_uuid(), operacion_id uuid references operaciones_neumaticos(id) on delete set null, status text default 'activa', liberado_at timestamptz, liberado_por uuid, motivo_liberacion text);
create table tc_partes_guiados (clave uuid primary key, intervencion_id uuid references tc_intervenciones(id) on delete cascade);
create table tc_incidencia_problemas (id uuid primary key default gen_random_uuid(), operacion_id uuid references operaciones_neumaticos(id));
create table tc_incidencia_operaciones (id uuid primary key default gen_random_uuid(), operacion_neumatico_id uuid references operaciones_neumaticos(id));

create or replace function prueba(nombre text, obtenido anyelement, espera anyelement) returns void
language plpgsql as $$ begin
  if obtenido is not distinct from espera then raise notice 'PASA · %', nombre;
  else raise notice 'FALLA · % → esperaba %, dio %', nombre, espera, obtenido; end if;
end $$;

\i supabase/migrations/tyrecontrol_importacion_historico.sql

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
insert into tc_neumaticos (id, empresa_id, medida) values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e1','315/80R22.5');
insert into tc_montajes_actuales (empresa_id, vehiculo_id, posicion_id, neumatico_id)
  select '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000c', id, '00000000-0000-0000-0000-000000000001' from tc_posiciones_vehiculo where codigo_posicion='E1_IZQ' and tipo_vehiculo_id='00000000-0000-0000-0000-00000000000a';
insert into movimientos_stock (cantidad) values (10);
insert into revisiones_vehiculo (empresa_id, vehiculo_id, fecha_revision) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000c', '2026-10-01');

-- Fotografía de lo que NO debe cambiar.
create or replace function foto() returns text language sql as $$
  select md5(coalesce((select string_agg(m::text, '|' order by m.id) from tc_montajes_actuales m), '') || '#' ||
             coalesce((select string_agg(n::text, '|' order by n.id) from tc_neumaticos n), '') || '#' ||
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
    (select count(*) from operaciones_neumaticos where intervencion_id = v and tipo_operacion='montaje' and status='completada' and km_vehiculo=268659 and fecha_operacion='2026-10-10' and neumatico_id is null), 4::bigint);
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
  perform prueba('cambiado: las operaciones siguen siendo 4', (select count(*) from operaciones_neumaticos), 4::bigint);
end $$;

-- ── 4. Posiciones: 6 nuevas, dos referencias, plano incompatible ────────────
do $$ declare r jsonb; begin
  r := tc_importar_historico('00000000-0000-0000-0000-0000000000e1', 'genes',
        lote('2026-09', alb_n('B2_26/4310','9005KMR',6,1), alb_n('B2_26/4508','9005KMR',6,2), alb_n('B2_26/0591','0591JGV',4,1), alb_n('B2_26/0002','0591JGV',2,1),
             alb_n('B2_26/0003','0591JGV',6,1)), false);
  perform prueba('se crean 5', (r->>'creadas')::int, 5);
  -- 6 nuevas de una referencia en un 2x4: el vehículo entero, 2 al eje 1 y 4 al eje 2.
  perform prueba('4310: 6 nuevas → 2 al eje 1 y 4 al eje 2',
    (select string_agg(p.codigo_posicion, ',' order by p.eje, p.codigo_posicion) from operaciones_neumaticos o join tc_intervenciones i on i.id=o.intervencion_id join tc_posiciones_vehiculo p on p.id=o.posicion_destino_id where i.origen_doc='B2_26/4310|9005KMR'),
    'E1_DER,E1_IZQ,E2_DER_EXT,E2_DER_INT,E2_IZQ_EXT,E2_IZQ_INT');
  perform prueba('4310: las 6 quedan marcadas como deducidas, ninguna confirmada',
    (select count(*) filter (where posicion_fuente='deducida')||'/'||count(*) from operaciones_neumaticos o join tc_intervenciones i on i.id=o.intervencion_id where i.origen_doc='B2_26/4310|9005KMR'), '6/6');
  perform prueba('6 nuevas en un 2x2 (el plano no tiene 2+4) → sin posición',
    (select count(*) from operaciones_neumaticos o join tc_intervenciones i on i.id=o.intervencion_id where i.origen_doc='B2_26/0003|0591JGV' and o.posicion_destino_id is null and o.posicion_fuente='desconocida'), 6::bigint);
  perform prueba('4508: dos referencias → sin posición', (select count(*) from operaciones_neumaticos o join tc_intervenciones i on i.id=o.intervencion_id where i.origen_doc='B2_26/4508|9005KMR' and o.posicion_destino_id is null), 6::bigint);
  perform prueba('4 nuevas en un 2x2 (eje 2 con 2 posiciones) → sin posición', (select count(*) from operaciones_neumaticos o join tc_intervenciones i on i.id=o.intervencion_id where i.origen_doc='B2_26/0591|0591JGV' and o.posicion_destino_id is null), 4::bigint);
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
  perform prueba('las importadas tienen vínculo', (select count(*) from operaciones_neumaticos where importacion_lote_id is not null), 4+6+6+4+2+6::bigint);
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
  perform prueba('nada borrado', (select count(*) from operaciones_neumaticos where intervencion_id=v4905), 4::bigint);
  perform prueba('el lote queda parcialmente deshecho', (select estado from tc_importacion_lotes where id=l), 'parcialmente_deshecho');
  perform prueba('la carga queda parcialmente deshecha', (select estado from tc_importacion_cargas where id=(select carga_id from tc_importacion_lotes where id=l)), 'parcialmente_deshecha');
  perform prueba('queda constancia de por qué se conservó', (select motivo_conservada is not null and conservada_at is not null from tc_importacion_intervenciones where intervencion_id=v4905), true);

  -- El lote de septiembre: añadir un servicio a 4310 y excluirla; el resto se borra.
  select importacion_lote_id, id into l, v4310 from tc_intervenciones where origen_doc='B2_26/4310|9005KMR';
  insert into tc_intervencion_servicios (intervencion_id, servicio, cantidad) values (v4310, 'valvulas', 1);
  r := tc_deshacer_importacion(l, '{}', false);
  perform prueba('septiembre sin excluir: 4 borradas, 1 conservada (servicio añadido)', (r->>'borradas')||'/'||(r->>'conservadas'), '4/1');
  perform prueba('4310 sigue con sus 6 operaciones y su servicio', (select count(*) from operaciones_neumaticos where intervencion_id=v4310) + (select count(*) from tc_intervencion_servicios where intervencion_id=v4310), 7::bigint);
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
