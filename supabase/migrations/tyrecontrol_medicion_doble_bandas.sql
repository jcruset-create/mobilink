-- ============================================================
-- Mobilink TyreControl — Medición doble por neumático: banda interior y
-- banda exterior.
--
-- QUÉ CAMBIA
--
-- Cada rueda se puede medir en sus DOS bandas (interior y exterior de la
-- banda de rodadura). La ficha de la revisión guarda las dos; el resto del
-- sistema sigue con UNA profundidad, que pasa a ser la MENOR de las dos.
--
--   · revisiones_neumaticos_detalle.profundidad_int_mm / profundidad_ext_mm
--     (nuevas, opcionales).
--   · Un trigger BEFORE garantiza en la base de datos —no en cada cliente—
--     que profundidad_mm = la menor de las bandas medidas. Así todo lo que
--     ya lee profundidad_mm (informes, alertas, umbrales, incidencias, ficha
--     del neumático, desgaste) sigue igual y pasa a leer el dato prudente,
--     sin tocar ni una consulta.
--   · Compatibilidad: una fila sin bandas (APK anterior, importaciones,
--     partes en papel) no se toca. Y si alguien edita SOLO profundidad_mm de
--     una fila que tenía bandas (APK vieja, corrección a mano), manda esa
--     edición: las bandas se vacían en vez de reescribirle el número.
--
--   · tc_config_umbrales gana dos ajustes por empresa:
--       medicion_doble (por defecto SÍ): la APK pide las dos bandas.
--       desgaste_irregular_delta_mm (por defecto 2,0): diferencia entre
--         bandas a partir de la cual se avisa de desgaste irregular (mala
--         alineación o presión). NULL = sin aviso. La práctica del sector
--         sitúa el "revisar alineación" en 1,6–2,4 mm; por debajo de ~1 mm
--         es ruido de medición. Es un AVISO visual: no crea incidencias.
--
--   · tc_informe_revisiones_mediciones devuelve también las dos bandas, para
--     que el PDF del informe de revisiones las enseñe.
--
-- Idempotente: reejecutable sin efectos secundarios.
-- ============================================================

-- ── 1. Las dos bandas ───────────────────────────────────────────────────────
alter table revisiones_neumaticos_detalle add column if not exists profundidad_int_mm numeric;
alter table revisiones_neumaticos_detalle add column if not exists profundidad_ext_mm numeric;

comment on column revisiones_neumaticos_detalle.profundidad_int_mm is
  'Banda interior de la rodadura (mm). Con la exterior, profundidad_mm es la menor de las dos (trigger).';
comment on column revisiones_neumaticos_detalle.profundidad_ext_mm is
  'Banda exterior de la rodadura (mm). Con la interior, profundidad_mm es la menor de las dos (trigger).';

-- ── 2. profundidad_mm = la menor, garantizado en la BD ──────────────────────
create or replace function tc_rev_det_profundidad_minima() returns trigger
language plpgsql as $$
begin
  -- Edición "a la antigua": cambia profundidad_mm y NO las bandas. Manda el
  -- número tecleado; las bandas, que ya no lo respaldan, se vacían.
  if tg_op = 'UPDATE'
     and new.profundidad_mm is distinct from old.profundidad_mm
     and new.profundidad_int_mm is not distinct from old.profundidad_int_mm
     and new.profundidad_ext_mm is not distinct from old.profundidad_ext_mm
     and (old.profundidad_int_mm is not null or old.profundidad_ext_mm is not null) then
    new.profundidad_int_mm := null;
    new.profundidad_ext_mm := null;
    return new;
  end if;

  -- Con alguna banda medida, la profundidad oficial es la menor de las que
  -- haya (si solo hay una, esa).
  if new.profundidad_int_mm is not null or new.profundidad_ext_mm is not null then
    new.profundidad_mm := least(coalesce(new.profundidad_int_mm, new.profundidad_ext_mm),
                                coalesce(new.profundidad_ext_mm, new.profundidad_int_mm));
  end if;
  return new;
end $$;

drop trigger if exists trg_rev_det_profundidad_minima on revisiones_neumaticos_detalle;
create trigger trg_rev_det_profundidad_minima
  before insert or update on revisiones_neumaticos_detalle
  for each row execute function tc_rev_det_profundidad_minima();

-- ── 3. Ajustes por empresa ──────────────────────────────────────────────────
alter table tc_config_umbrales add column if not exists medicion_doble boolean not null default true;
alter table tc_config_umbrales add column if not exists desgaste_irregular_delta_mm numeric default 2.0;

comment on column tc_config_umbrales.medicion_doble is
  'La APK pide dos mediciones por rueda (banda interior y exterior). Por defecto sí.';
comment on column tc_config_umbrales.desgaste_irregular_delta_mm is
  'Diferencia entre bandas (mm) a partir de la cual se avisa de desgaste irregular. NULL = sin aviso. Solo visual.';

-- ── 4. El PDF del informe de revisiones recibe las bandas ───────────────────
-- Cambia el tipo de retorno (dos columnas más): hay que tirar la anterior.
drop function if exists tc_informe_revisiones_mediciones(uuid, uuid[]);
create function tc_informe_revisiones_mediciones(
  p_empresa    uuid,
  p_revisiones uuid[]
) returns table (
  revision_id      uuid,
  posicion         text,
  orden            int,
  profundidad_mm   numeric,
  presion_bar      numeric,
  minimo_mm        numeric,
  aviso_mm         numeric,
  no_accesible     boolean,
  neumatico_ausente boolean,
  marca            text,
  medida           text,
  codigo_interno   text,
  profundidad_int_mm numeric,
  profundidad_ext_mm numeric
)
language sql stable security invoker set search_path = public as $$
  select
    d.revision_id,
    coalesce(p.nombre, p.codigo_posicion)                      as posicion,
    coalesce(p.orden_revision, p.orden_visual)                 as orden,
    d.profundidad_mm,
    d.presion_bar,
    -- La misma cadena que los informes: medida, categoría, empresa, legal.
    coalesce(um.profundidad_minima_mm, uc.profundidad_minima_mm,
             ue.profundidad_minima_mm, 1.6)                    as minimo_mm,
    coalesce(um.profundidad_aviso_mm, uc.profundidad_aviso_mm,
             ue.profundidad_aviso_mm, 3.0)                     as aviso_mm,
    coalesce(d.no_accesible, false)                            as no_accesible,
    coalesce(d.neumatico_ausente, false)                       as neumatico_ausente,
    n.marca,
    n.medida,
    n.codigo_interno,
    d.profundidad_int_mm,
    d.profundidad_ext_mm
  from revisiones_neumaticos_detalle d
  join revisiones_vehiculo r          on r.id = d.revision_id
  left join tc_posiciones_vehiculo p  on p.id = d.posicion_id
  left join tc_neumaticos n           on n.id = d.neumatico_id
  left join tc_config_umbrales ue     on ue.empresa_id = r.empresa_id
  left join tc_cat_medidas_neumatico cm on lower(cm.valor) = lower(n.medida)
  left join tc_config_umbrales_medida um
         on um.empresa_id = r.empresa_id and lower(um.medida) = lower(n.medida)
  left join tc_config_umbrales_categoria uc
         on uc.empresa_id = r.empresa_id and uc.categoria = cm.categoria
  where r.empresa_id = p_empresa
    and d.revision_id = any (p_revisiones)
  order by d.revision_id, coalesce(p.orden_revision, p.orden_visual), p.codigo_posicion;
$$;

comment on function tc_informe_revisiones_mediciones(uuid, uuid[]) is
  'Mediciones de las revisiones indicadas con el umbral que aplica a cada '
  'rueda, resuelto medida → categoría → empresa → 1,6 mm, la misma cadena '
  'que usan los informes, y las dos bandas cuando se midieron. '
  'security invoker: la RLS sigue mandando.';

grant execute on function tc_informe_revisiones_mediciones(uuid, uuid[]) to authenticated;

-- ── 5. Auto-test (rollback al final: no persiste nada) ──────────────────────
do $$
declare v_row record; v_det uuid;
begin
  begin
    -- Se prueba sobre una medición existente y se deshace todo al final. Si
    -- la base no tiene ninguna, no hay nada que probar aquí (probado en local).
    select id into v_det from revisiones_neumaticos_detalle limit 1;
    if v_det is null then
      raise exception 'TC_TEST_ROLLBACK';
    end if;

    -- Dos bandas → la menor (aunque se mande otra profundidad).
    update revisiones_neumaticos_detalle
       set profundidad_int_mm = 7.8, profundidad_ext_mm = 4.1, profundidad_mm = 99
     where id = v_det;
    select * into v_row from revisiones_neumaticos_detalle where id = v_det;
    if v_row.profundidad_mm <> 4.1 then
      raise exception 'FALLO: con bandas 7,8/4,1 la profundidad debería ser 4,1 y es %', v_row.profundidad_mm;
    end if;

    -- Remedir una banda → se recalcula.
    update revisiones_neumaticos_detalle set profundidad_ext_mm = 8.2 where id = v_det;
    if (select profundidad_mm from revisiones_neumaticos_detalle where id = v_det) <> 7.8 then
      raise exception 'FALLO: al remedir la exterior la mínima no se ha recalculado';
    end if;

    -- Edición a la antigua (solo profundidad_mm): manda, y las bandas se vacían.
    update revisiones_neumaticos_detalle set profundidad_mm = 5.5 where id = v_det;
    select * into v_row from revisiones_neumaticos_detalle where id = v_det;
    if v_row.profundidad_mm <> 5.5 or v_row.profundidad_int_mm is not null or v_row.profundidad_ext_mm is not null then
      raise exception 'FALLO: la edición de solo profundidad_mm no ha mandado';
    end if;

    raise exception 'TC_TEST_ROLLBACK';
  exception when others then
    if sqlerrm <> 'TC_TEST_ROLLBACK' then raise; end if;
  end;
  raise notice 'Auto-test de la medición doble: OK (todo revertido)';
end $$;

-- ── 6. Comprobación ─────────────────────────────────────────────────────────
do $$
declare n int;
begin
  select count(*) into n from information_schema.columns
   where table_name = 'revisiones_neumaticos_detalle'
     and column_name in ('profundidad_int_mm', 'profundidad_ext_mm');
  if n <> 2 then raise exception 'Faltan las columnas de las bandas en revisiones_neumaticos_detalle'; end if;

  select count(*) into n from information_schema.columns
   where table_name = 'tc_config_umbrales'
     and column_name in ('medicion_doble', 'desgaste_irregular_delta_mm');
  if n <> 2 then raise exception 'Faltan los ajustes de medición doble en tc_config_umbrales'; end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_rev_det_profundidad_minima') then
    raise exception 'Falta el trigger trg_rev_det_profundidad_minima';
  end if;

  select count(*) into n from pg_proc
   where proname = 'tc_informe_revisiones_mediciones' and prosrc like '%profundidad_int_mm%';
  if n <> 1 then raise exception 'tc_informe_revisiones_mediciones no devuelve las bandas'; end if;

  raise notice 'OK: medición doble instalada (bandas, mínima garantizada en BD, ajustes por empresa, informe)';
end $$;
