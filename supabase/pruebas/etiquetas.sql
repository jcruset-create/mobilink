\set ON_ERROR_STOP on
-- ⛔ ESTO NO ES UNA MIGRACIÓN. NO LO PEGUES EN SUPABASE.
--
-- Banco desechable para un PostgreSQL vacío. Crea tablas de mentira y
-- REDEFINE las funciones de permisos. Contra una base real eso abriría los
-- permisos de par en par. Las migraciones están en supabase/migrations/.
do $$
begin
  if exists (select 1 from pg_tables where schemaname='public' and tablename='tc_vehiculos') then
    raise exception 'ESTE FICHERO NO ES UNA MIGRACIÓN: banco desechable y esta base ya tiene TyreControl.';
  end if;
end $$;

-- ============================================================
-- Banco para tyrecontrol_etiquetas.sql
--
-- Dos cosas se vigilan por encima de todo:
--
--   1. Que etiquetar NO ES INVENTARIO. El banco crea las tablas que el módulo
--      tiene prohibido tocar —neumáticos, montajes, operaciones,
--      intervenciones y un libro de movimientos de almacén— y comprueba que
--      etiquetar un lote ENTERO las deja exactamente como estaban: vacías.
--
--   2. Que un cliente no ve lo del vecino. Y no mirando si la política existe,
--      sino entrando de verdad como `authenticated` y consultando.
--
-- Lo demás es la numeración del lote, que es donde se pisan dos tablets, y los
-- checks de estado.
-- ============================================================

do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
create schema if not exists auth;

-- Quién soy en cada momento. Las pruebas cambian esta fila para ponerse en la
-- piel de un operario de otra empresa o de un administrador.
create table auth_ctx (rol text, quien uuid, empresa uuid);
insert into auth_ctx values ('operador',
                             '00000000-0000-0000-0000-0000000000aa',
                             '00000000-0000-0000-0000-0000000000e1');

create or replace function auth.uid() returns uuid language sql stable as
  $$ select quien from auth_ctx limit 1 $$;
create or replace function tc_is_superadmin() returns boolean language sql stable as
  $$ select (select rol from auth_ctx limit 1) = 'superadmin' $$;
create or replace function tc_is_admin() returns boolean language sql stable as
  $$ select (select rol from auth_ctx limit 1) = 'admin' $$;
create or replace function tc_operador_ve_empresa(e uuid) returns boolean language sql stable as
  $$ select e = (select empresa from auth_ctx limit 1) $$;
create or replace function tc_puede_ver_empresa(e uuid) returns boolean language sql stable as
  $$ select tc_is_superadmin() or tc_is_admin() or tc_operador_ve_empresa(e) $$;

create table tc_empresas (id uuid primary key, nombre text);
insert into tc_empresas values ('00000000-0000-0000-0000-0000000000e1','Plana'),
                               ('00000000-0000-0000-0000-0000000000e2','Otra');

-- ── Las tablas que este módulo NO puede tocar ───────────────────────────────
-- Existen solo para poder demostrar que siguen vacías al final.
create table tc_neumaticos (id uuid primary key default gen_random_uuid(), numero_interno text);
create table tc_montajes_actuales (id uuid primary key default gen_random_uuid());
create table operaciones_neumaticos (id uuid primary key default gen_random_uuid(), coste numeric);
create table tc_intervenciones (id uuid primary key default gen_random_uuid(), facturable boolean);
create table movimientos_stock (id uuid primary key default gen_random_uuid(), signo int, motivo text);

\ir ../migrations/tyrecontrol_etiquetas.sql
-- Segunda pasada: la migración tiene que ser idempotente.
\ir ../migrations/tyrecontrol_etiquetas.sql

create or replace function prueba(nombre text, obtenido anyelement, espera anyelement) returns void
language plpgsql as $$ begin
  if obtenido is not distinct from espera then raise notice 'PASA · %', nombre;
  else raise notice 'FALLA · % → esperaba %, dio %', nombre, espera, obtenido; end if;
end $$;

-- Para las pruebas que esperan un error: se queda con el mensaje.
create or replace function falla(nombre text, sentencia text, trozo text) returns void
language plpgsql as $$
declare v_msg text;
begin
  execute sentencia;
  raise notice 'FALLA · % → no dio ningún error', nombre;
exception when others then
  v_msg := sqlerrm;
  if position(trozo in v_msg) > 0 then raise notice 'PASA · %', nombre;
  else raise notice 'FALLA · % → esperaba un error con «%», dio «%»', nombre, trozo, v_msg; end if;
end $$;

-- ── Abrir lotes: la numeración ──────────────────────────────────────────────
do $$ declare r jsonb; v_dia text := to_char(now(),'YYYYMMDD'); begin
  r := tc_etiquetas_abrir_lote('00000000-0000-0000-0000-0000000000e1');
  perform prueba('el primer lote del día es el 001', r->>'codigo', 'ETQ-'||v_dia||'-001');
  perform prueba('devuelve también el id', (r->>'id') is not null, true);

  r := tc_etiquetas_abrir_lote('00000000-0000-0000-0000-0000000000e1');
  perform prueba('el segundo es el 002', r->>'codigo', 'ETQ-'||v_dia||'-002');
end $$;

-- Otra empresa numera por su cuenta: dos clientes abriendo lote el mismo día
-- tienen los dos su 001.
do $$ declare r jsonb; v_dia text := to_char(now(),'YYYYMMDD'); begin
  update auth_ctx set empresa='00000000-0000-0000-0000-0000000000e2';
  r := tc_etiquetas_abrir_lote('00000000-0000-0000-0000-0000000000e2');
  perform prueba('cada empresa tiene su propio 001', r->>'codigo', 'ETQ-'||v_dia||'-001');
  update auth_ctx set empresa='00000000-0000-0000-0000-0000000000e1';
end $$;

-- ── Permisos ────────────────────────────────────────────────────────────────
select falla('un operario no abre lote en una empresa que no es la suya',
             $$ select tc_etiquetas_abrir_lote('00000000-0000-0000-0000-0000000000e2') $$,
             'Sin permiso sobre esta empresa');

do $$ declare r jsonb; begin
  update auth_ctx set rol='admin';
  r := tc_etiquetas_abrir_lote('00000000-0000-0000-0000-0000000000e2');
  perform prueba('un administrador sí puede', (r->>'codigo') like 'ETQ-%-002', true);
  update auth_ctx set rol='operador';
end $$;

-- El unique es el que sostiene de verdad la numeración, no el count.
select falla('dos lotes con el mismo código en la misma empresa: imposible',
             $$ insert into tc_etiquetas_lote (empresa_id, codigo)
                select empresa_id, codigo from tc_etiquetas_lote limit 1 $$,
             'duplicate key');

do $$ declare v_cod text := 'ETQ-19991231-777'; n int; begin
  insert into tc_etiquetas_lote (empresa_id, codigo) values
    ('00000000-0000-0000-0000-0000000000e1', v_cod),
    ('00000000-0000-0000-0000-0000000000e2', v_cod);
  select count(*) into n from tc_etiquetas_lote where codigo = v_cod;
  perform prueba('el mismo código en DOS empresas distintas sí vale', n, 2);
  delete from tc_etiquetas_lote where codigo = v_cod;
end $$;

-- ── Estados ─────────────────────────────────────────────────────────────────
do $$ declare v_lote uuid; begin
  select id into v_lote from tc_etiquetas_lote
   where empresa_id='00000000-0000-0000-0000-0000000000e1' order by created_at limit 1;
  perform set_config('prueba.lote', v_lote::text, false);
end $$;

select falla('un lote no puede quedarse en un estado inventado',
             $$ update tc_etiquetas_lote set estado='a_medias'
                 where id = current_setting('prueba.lote')::uuid $$,
             'tc_etiquetas_lote_estado_check');

do $$ declare v_id uuid; r record; begin
  insert into tc_etiquetas_foto (lote_id, empresa_id, foto_url)
  values (current_setting('prueba.lote')::uuid,
          '00000000-0000-0000-0000-0000000000e1',
          'etiquetas/lote/1.jpg')
  returning id into v_id;
  perform set_config('prueba.foto', v_id::text, false);

  select * into r from tc_etiquetas_foto where id=v_id;
  perform prueba('una foto recién subida está «pendiente»', r.estado, 'pendiente');
  perform prueba('y no nace dudosa', r.dudoso, false);
  perform prueba('ni con número', r.serie_detectada is null, true);
  perform prueba('la foto hereda la empresa de su lote', r.empresa_id,
                 '00000000-0000-0000-0000-0000000000e1'::uuid);
end $$;

select falla('una foto tampoco admite un estado inventado',
             $$ update tc_etiquetas_foto set estado='casi'
                 where id = current_setting('prueba.foto')::uuid $$,
             'tc_etiquetas_foto_estado_check');

-- Lo que leyó la máquina no se pisa cuando una persona corrige: es lo único
-- que permite saber después si el lector acierta.
do $$ declare r record; begin
  update tc_etiquetas_foto
     set serie_detectada='1234567890123', confianza=0.42, dudoso=true, estado='revisar'
   where id = current_setting('prueba.foto')::uuid;
  update tc_etiquetas_foto
     set serie_confirmada='1234567890124', estado='confirmada',
         revisado_por='00000000-0000-0000-0000-0000000000aa', revisado_at=now()
   where id = current_setting('prueba.foto')::uuid;
  select * into r from tc_etiquetas_foto where id = current_setting('prueba.foto')::uuid;
  perform prueba('al corregir, lo que leyó la IA se conserva', r.serie_detectada, '1234567890123');
  perform prueba('y lo que se imprimirá es lo que dijo la persona',
                 r.serie_confirmada, '1234567890124');
  perform prueba('queda quién lo revisó', r.revisado_por,
                 '00000000-0000-0000-0000-0000000000aa'::uuid);
end $$;

-- ── LA PRUEBA DEL ENCARGO: etiquetar no es inventario ───────────────────────
--
-- Se etiqueta un lote entero, de principio a fin, y se comprueba que las
-- tablas de inventario, operaciones y almacén siguen vacías.
do $$
declare v_lote uuid; r jsonb; n int;
begin
  r := tc_etiquetas_abrir_lote('00000000-0000-0000-0000-0000000000e1');
  v_lote := (r->>'id')::uuid;

  insert into tc_etiquetas_foto (lote_id, empresa_id, foto_url, serie_detectada,
                                 confianza, estado)
  select v_lote, '00000000-0000-0000-0000-0000000000e1',
         'etiquetas/'||v_lote||'/'||g||'.jpg', lpad(g::text, 13, '0'), 0.97, 'detectada'
    from generate_series(1,12) g;

  update tc_etiquetas_foto
     set serie_confirmada=serie_detectada, estado='confirmada',
         revisado_por=auth.uid(), revisado_at=now()
   where lote_id=v_lote;
  update tc_etiquetas_foto set estado='impresa', impreso_at=now() where lote_id=v_lote;
  update tc_etiquetas_lote set estado='cerrado', cerrado_at=now() where id=v_lote;

  select count(*) into n from tc_etiquetas_foto where lote_id=v_lote and estado='impresa';
  perform prueba('el lote se etiqueta entero: 12 impresas', n, 12);

  select count(*) into n from tc_neumaticos;
  perform prueba('etiquetar NO crea neumáticos', n, 0);
  select count(*) into n from tc_montajes_actuales;
  perform prueba('etiquetar NO monta nada', n, 0);
  select count(*) into n from operaciones_neumaticos;
  perform prueba('etiquetar NO genera operaciones ni costes', n, 0);
  select count(*) into n from tc_intervenciones;
  perform prueba('etiquetar NO genera trabajo facturable', n, 0);
  select count(*) into n from movimientos_stock;
  perform prueba('etiquetar NO mueve una sola unidad de almacén', n, 0);
end $$;

-- Y no hay ninguna referencia a inventario ni en las columnas ni en las FK.
do $$ declare n int; begin
  select count(*) into n from information_schema.columns
   where table_name in ('tc_etiquetas_lote','tc_etiquetas_foto')
     and (column_name like '%neumatico%' or column_name like '%numero_interno%'
       or column_name like '%stock%' or column_name like '%coste%');
  perform prueba('las tablas no tienen ni una columna de inventario', n, 0);

  select count(*) into n
    from information_schema.table_constraints tc
    join information_schema.constraint_column_usage u
      on u.constraint_name = tc.constraint_name
   where tc.table_name in ('tc_etiquetas_lote','tc_etiquetas_foto')
     and tc.constraint_type = 'FOREIGN KEY'
     and u.table_name not in ('tc_etiquetas_lote','tc_empresas');
  perform prueba('sus únicas claves ajenas son al lote y a la empresa', n, 0);
end $$;

-- ── Borrados ────────────────────────────────────────────────────────────────
do $$ declare v_lote uuid; n int; begin
  select id into v_lote from tc_etiquetas_lote where estado='cerrado' limit 1;
  delete from tc_etiquetas_lote where id=v_lote;
  select count(*) into n from tc_etiquetas_foto where lote_id=v_lote;
  perform prueba('al borrar un lote se van sus fotos, no quedan huérfanas', n, 0);
end $$;

-- ── Aislamiento entre clientes, entrando de verdad como authenticated ───────
do $$ declare v_lote uuid; begin
  -- Un lote de la otra empresa, con una foto, para intentar verlo desde la
  -- primera.
  update auth_ctx set rol='admin';
  select (tc_etiquetas_abrir_lote('00000000-0000-0000-0000-0000000000e2')->>'id')::uuid into v_lote;
  insert into tc_etiquetas_foto (lote_id, empresa_id, foto_url, serie_detectada)
  values (v_lote, '00000000-0000-0000-0000-0000000000e2', 'etiquetas/otra/1.jpg', '9999999999999');
  update auth_ctx set rol='operador';
end $$;

grant usage on schema auth to authenticated;
grant select on auth_ctx to authenticated;
grant select, insert, update, delete on tc_etiquetas_lote, tc_etiquetas_foto to authenticated;

set role authenticated;
do $$ declare n int; begin
  select count(*) into n from tc_etiquetas_lote
   where empresa_id='00000000-0000-0000-0000-0000000000e2';
  perform prueba('un operario no ve los LOTES de otro cliente', n, 0);
  select count(*) into n from tc_etiquetas_foto
   where empresa_id='00000000-0000-0000-0000-0000000000e2';
  perform prueba('ni sus FOTOS, ni sus números de serie', n, 0);
  select count(*) into n from tc_etiquetas_lote
   where empresa_id='00000000-0000-0000-0000-0000000000e1';
  perform prueba('los suyos sí los ve', n > 0, true);
end $$;

select falla('ni puede colar una foto en la empresa del vecino',
             $$ insert into tc_etiquetas_foto (lote_id, empresa_id, foto_url)
                select id, '00000000-0000-0000-0000-0000000000e2', 'x.jpg'
                  from tc_etiquetas_lote limit 1 $$,
             'row-level security');
reset role;

do $$ declare n int; begin
  select count(*) into n from pg_tables
   where tablename in ('tc_etiquetas_lote','tc_etiquetas_foto') and rowsecurity;
  perform prueba('la RLS está activada en las dos tablas', n, 2);
end $$;

-- Si se va la empresa se va todo lo suyo: no se queda un número de serie sin
-- dueño en una base de datos.
do $$ declare n int; begin
  delete from tc_empresas where id='00000000-0000-0000-0000-0000000000e2';
  select count(*) into n from tc_etiquetas_lote
   where empresa_id='00000000-0000-0000-0000-0000000000e2';
  perform prueba('al borrar la empresa no queda ningún lote suyo', n, 0);
  select count(*) into n from tc_etiquetas_foto
   where empresa_id='00000000-0000-0000-0000-0000000000e2';
  perform prueba('ni ninguna foto suya', n, 0);
end $$;
