-- ============================================================
-- Mobilink TyreControl — El histórico, ordenado por lo que enseña
--
-- EL PROBLEMA (visto el 18-08-2026)
--
-- La lista del histórico saltaba: 18/08 13:45, 18/08 08:34, 17/08 20:45,
-- 17/08 23:26, 18/08 10:54… Sin orden aparente.
--
-- Lo tenía: ordenaba por `created_at` —cuándo se GRABÓ la fila— pero la
-- columna Hora enseña `medido_at` —cuándo se MIDIÓ la rueda—. Con la APK las
-- dos casi coinciden y no se notaba. Con el CheckPoint no: un informe semanal
-- se importa de una vez, así que todas sus revisiones tienen casi el mismo
-- created_at pero horas de medición repartidas por toda la semana. Al ordenar
-- por una y pintar la otra, el resultado parece aleatorio.
--
-- POR QUÉ UNA COLUMNA Y NO UN ORDER BY
--
-- Lo suyo sería `order by coalesce(medido_at, created_at) desc`, pero el
-- histórico se pide por PostgREST, que solo ordena por columnas, no por
-- expresiones. Y ordenar en el navegador tampoco vale: la consulta trae 200
-- filas, así que ordenar después reordena las 200 equivocadas — las que
-- entran seguirían siendo las de created_at más reciente.
--
-- `momento` es generada y almacenada: se calcula sola, no puede
-- desincronizarse, y no hay que tocar ningún camino de escritura (el
-- importador del CheckPoint, la APK, el panel). Con su índice, ordenar por
-- ella sale gratis.
--
-- Idempotente.
-- ============================================================

alter table revisiones_vehiculo
  add column if not exists momento timestamptz
  generated always as (coalesce(medido_at, created_at)) stored;

comment on column revisiones_vehiculo.momento is
  'Cuándo ocurrió la revisión de verdad: la hora medida si se conoce y, si no, '
  'la de grabación. Es lo que enseña el histórico, así que es por lo que ordena.';

create index if not exists idx_rev_veh_momento on revisiones_vehiculo (momento desc);

-- ── Comprobación ────────────────────────────────────────────────────────────
do $$
declare v_mal int;
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'revisiones_vehiculo' and column_name = 'momento') then
    raise exception 'No se ha creado revisiones_vehiculo.momento';
  end if;

  -- Generada de verdad: si alguien la convirtiera en columna normal, volvería
  -- a poder desincronizarse del dato que se enseña.
  if not exists (select 1 from information_schema.columns
                  where table_name = 'revisiones_vehiculo' and column_name = 'momento'
                    and is_generated = 'ALWAYS') then
    raise exception 'momento existe pero no es una columna generada';
  end if;

  select count(*) into v_mal from revisiones_vehiculo
   where momento is distinct from coalesce(medido_at, created_at);
  if v_mal > 0 then
    raise exception 'Hay % filas con momento mal calculado', v_mal;
  end if;

  raise notice 'OK: momento calculado e indexado; el histórico ya puede ordenar por lo que enseña';
end $$;
