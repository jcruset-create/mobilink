-- ─────────────────────────────────────────────────────────────────────────
-- DESHACER LAS TRES MIGRACIONES · histórico de Plana (PR #492)
--
-- GENERADO por scripts/produccion/generar-preflight-sql.py --deshacer
--
-- Borra lo que las migraciones CREAN: 9 tablas, 1 vista, 26 funciones y las
-- 22 columnas que añaden a tablas que ya existían.
--
-- ── El orden, que importa ────────────────────────────────────────────────
--
--   1º  vuelta-atras-produccion.sql  (el fichero que guardaste ANTES de
--       migrar: devuelve a su definición de siempre las tres funciones y la
--       vista que ya existían).
--   2º  este fichero.
--
-- Al revés no vale: las definiciones nuevas de los informes leen la columna
-- `importacion_lote_id`, y si se borra la columna antes de restaurarlas, los
-- informes del panel se quedan rotos. La guarda de abajo lo comprueba y se
-- niega a seguir.
--
-- ── Lo que NO hace ───────────────────────────────────────────────────────
--
-- No borra datos importados. Si hay lotes aplicados, hay que deshacerlos
-- antes con `tc_deshacer_importacion`, que es quien sabe qué quitar y qué
-- conservar. Esta vuelta atrás es para «las migraciones están puestas y no
-- queremos seguir», no para «hay que borrar lo importado».
--
-- No toca tc_marcas_contadores: esa vista ya existía y se restaura con el
-- fichero del paso 1, no borrándola.
--
-- Todo va en una transacción: o se deshace entero, o no se deshace nada.
-- ─────────────────────────────────────────────────────────────────────────

begin;
set local lock_timeout = '15s';
set local statement_timeout = '15min';

-- ── 0. Guardas ───────────────────────────────────────────────────────────
do $guardas$
declare n bigint; def text;
begin
  if to_regclass('public.tc_importacion_lotes') is not null then
    execute 'select count(*) from tc_importacion_lotes' into n;
    if n > 0 then
      raise exception 'Hay % lote(s) de importación aplicados. Deshazlos primero con tc_deshacer_importacion: esto no borra datos importados.', n;
    end if;
  end if;

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'operaciones_neumaticos'
                and column_name = 'importacion_lote_id') then
    execute 'select count(*) from operaciones_neumaticos where importacion_lote_id is not null' into n;
    if n > 0 then
      raise exception 'Quedan % fila(s) de importación en operaciones_neumaticos. Deshaz la importación antes.', n;
    end if;
  end if;

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'tc_intervencion_servicios'
                and column_name = 'importacion_lote_id') then
    execute 'select count(*) from tc_intervencion_servicios where importacion_lote_id is not null' into n;
    if n > 0 then
      raise exception 'Quedan % fila(s) de importación en tc_intervencion_servicios. Deshaz la importación antes.', n;
    end if;
  end if;

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'tc_intervenciones'
                and column_name = 'importacion_lote_id') then
    execute 'select count(*) from tc_intervenciones where importacion_lote_id is not null' into n;
    if n > 0 then
      raise exception 'Quedan % fila(s) de importación en tc_intervenciones. Deshaz la importación antes.', n;
    end if;
  end if;

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'tc_neumaticos'
                and column_name = 'importacion_lote_id') then
    execute 'select count(*) from tc_neumaticos where importacion_lote_id is not null' into n;
    if n > 0 then
      raise exception 'Quedan % fila(s) de importación en tc_neumaticos. Deshaz la importación antes.', n;
    end if;
  end if;

  -- El paso 1 tiene que estar hecho: si los informes siguen con la versión
  -- nueva, borrar la columna los dejaría rotos.
  if to_regprocedure('public.tc_informes_inventario_por(uuid, text)') is not null then
    def := pg_get_functiondef(to_regprocedure('public.tc_informes_inventario_por(uuid, text)'));
    if def like '%importacion_lote_id%' then
      raise exception 'Primero hay que restaurar las definiciones de siempre (vuelta-atras-produccion.sql): tc_informes_inventario_por todavía es la versión nueva.';
    end if;
  end if;
  if to_regclass('public.tc_marcas_contadores') is not null then
    if pg_get_viewdef('public.tc_marcas_contadores', true) like '%importacion_lote_id%' then
      raise exception 'Primero hay que restaurar la vista tc_marcas_contadores (vuelta-atras-produccion.sql).';
    end if;
  end if;
end
$guardas$;

-- ── 1. La vista que el PR crea nueva ─────────────────────────────────────
drop view if exists public.tc_reconstruccion_intervalos;

-- ── 2. Las funciones nuevas ──────────────────────────────────────────────
drop function if exists public.tc_deshacer_importacion(uuid, uuid[], boolean);
drop function if exists public.tc_imp_ampliar_carga(uuid, boolean);
drop function if exists public.tc_imp_ampliar_intervencion(uuid);
drop function if exists public.tc_imp_anotar_bloqueado(uuid, uuid, text, jsonb, text);
drop function if exists public.tc_imp_bloquear(uuid, text);
drop function if exists public.tc_imp_desfase_mano_obra(uuid);
drop function if exists public.tc_imp_exigir_admin(uuid);
drop function if exists public.tc_imp_ficha_historica(uuid, uuid, text, text, uuid, text, text, text);
drop function if exists public.tc_imp_fijar_limite_km_dia(uuid, numeric);
drop function if exists public.tc_imp_huella_estado(uuid);
drop function if exists public.tc_imp_huella_intervalo(uuid);
drop function if exists public.tc_imp_identificar_unidad(uuid, uuid, boolean, text);
drop function if exists public.tc_imp_intervalo_duda_continuidad(tc_reconstruccion_montajes);
drop function if exists public.tc_imp_intervalo_duda_km(tc_reconstruccion_montajes);
drop function if exists public.tc_imp_intervalo_en_medias(tc_reconstruccion_montajes);
drop function if exists public.tc_imp_intervalo_motivos(tc_reconstruccion_montajes);
drop function if exists public.tc_imp_limite_km_dia(uuid);
drop function if exists public.tc_imp_medianoche(date);
drop function if exists public.tc_imp_num(numeric);
drop function if exists public.tc_imp_posiciones_norma(uuid, int, boolean);
drop function if exists public.tc_imp_reconstruir_vehiculo(uuid);
drop function if exists public.tc_imp_revisar_intervalo(uuid, text, text, text);
drop function if exists public.tc_importar_historico(uuid, text, jsonb, boolean);
drop function if exists public.tc_informes_inventario_resumen(uuid);
drop function if exists public.tc_informes_montajes(uuid, date, date, text);
drop function if exists public.tc_informes_recorridos_estimados(uuid, date, date, uuid);

-- ── 3. Las tablas nuevas ─────────────────────────────────────────────────
-- `cascade` por las claves ajenas entre ellas y sus políticas; nada de
-- fuera depende de estas tablas, y la guarda de arriba ya ha comprobado
-- que están vacías de lotes.
drop table if exists public.tc_importacion_bloqueados cascade;
drop table if exists public.tc_importacion_cargas cascade;
drop table if exists public.tc_importacion_eventos cascade;
drop table if exists public.tc_importacion_intervenciones cascade;
drop table if exists public.tc_importacion_lineas cascade;
drop table if exists public.tc_importacion_lotes cascade;
drop table if exists public.tc_reconstruccion_ajustes cascade;
drop table if exists public.tc_reconstruccion_montajes cascade;
drop table if exists public.tc_reconstruccion_revisiones cascade;

-- ── 4. Los índices y las columnas añadidas a tablas vivas ────────────────
drop index if exists public.idx_interv_imp_lote;
drop index if exists public.idx_op_imp_lote;
alter table public.operaciones_neumaticos
 drop column if exists condicion,
 drop column if exists grupo_origen,
 drop column if exists grupo_sustitucion,
 drop column if exists identidad_retirado,
 drop column if exists importacion_lote_id,
 drop column if exists marca_txt,
 drop column if exists medida_txt,
 drop column if exists modelo_txt,
 drop column if exists origen_linea,
 drop column if exists origen_sistema,
 drop column if exists posicion_fuente;
alter table public.tc_intervencion_servicios
 drop column if exists grupo_origen,
 drop column if exists importacion_lote_id;
alter table public.tc_intervenciones
 drop column if exists hora_desconocida,
 drop column if exists importacion_lote_id,
 drop column if exists origen_doc,
 drop column if exists origen_sistema;
alter table public.tc_neumaticos
 drop column if exists grupo_origen,
 drop column if exists identidad_reconstruida,
 drop column if exists importacion_lote_id,
 drop column if exists origen_doc,
 drop column if exists origen_linea;

-- ── 5. Comprobación, todavía dentro de la transacción ────────────────────
select 'antes de commit' as momento,
       (select count(*) from pg_tables
         where schemaname = 'public' and tablename like 'tc\_importacion\_%') tablas_importacion,
       (select count(*) from pg_tables
         where schemaname = 'public' and tablename like 'tc\_reconstruccion\_%') tablas_reconstruccion,
       (select count(*) from information_schema.columns
         where table_schema = 'public' and column_name = 'importacion_lote_id') columnas_de_lote;

commit;

-- Las tres tienen que dar cero. Si alguna no da cero, NO se ha deshecho todo.
select 'después del commit' as momento,
       (select count(*) from pg_tables
         where schemaname = 'public' and tablename like 'tc\_importacion\_%') tablas_importacion,
       (select count(*) from pg_tables
         where schemaname = 'public' and tablename like 'tc\_reconstruccion\_%') tablas_reconstruccion,
       (select count(*) from information_schema.columns
         where table_schema = 'public' and column_name = 'importacion_lote_id') columnas_de_lote;

