-- ============================================================
-- Mobilink TyreControl — Aviso de «vehículos con el plano incompleto».
--
-- POR QUÉ
--
-- El informe «Neumáticos controlados» daba un número de montados IMPAR, y un
-- camión monta las ruedas por ejes. Buscándolo a mano salieron dos cosas que
-- nadie veía:
--
--   · Vehículos con el plano a medias: un eje con 1 o 3 ruedas (la del otro
--     lado nunca se informó, o una fila del Excel faltaba).
--   · Fichas en estado «montado» que no están en ninguna posición: las
--     genéricas que creó una importación y se quedaron colgando cuando el
--     vehículo recibió sus gomas de verdad.
--
-- QUÉ HACE
--
-- tc_informes_planos_incompletos(p_empresa) devuelve:
--
--   vehiculos            los vehículos activos que tienen AL MENOS una rueda
--                        informada y alguna posición activa de su tipo sin
--                        rueda. Los que no tienen ninguna no salen: ésos no
--                        están a medias, están sin inventariar, y son otro
--                        trabajo.
--   fichas_sin_posicion  fichas en «montado» sin montaje (máx. 200 en la lista;
--                        el recuento va aparte y es el real).
--
-- security invoker: la RLS manda, cada usuario ve lo de su empresa.
-- Idempotente.
-- ============================================================

create or replace function tc_informes_planos_incompletos(p_empresa uuid default null)
returns json
language sql
stable
security invoker
set search_path = public
as $$
  with veh as (
    select v.id, v.matricula, v.tipo_vehiculo_id
    from tc_vehiculos v
    where v.activo
      and v.tipo_vehiculo_id is not null
      and (p_empresa is null or v.empresa_id = p_empresa)
  ),
  pos as (
    select v.id as vehiculo_id, v.matricula, p.id as posicion_id, p.codigo_posicion,
           coalesce(p.orden_visual, 0) as orden,
           exists (select 1 from tc_montajes_actuales m
                    where m.vehiculo_id = v.id and m.posicion_id = p.id) as montada
    from veh v
    join tc_posiciones_vehiculo p on p.tipo_vehiculo_id = v.tipo_vehiculo_id and p.activo
  ),
  incompletos as (
    select vehiculo_id, matricula,
           count(*) filter (where montada)::int as montadas,
           count(*)::int as posiciones,
           array_agg(codigo_posicion order by orden, codigo_posicion) filter (where not montada) as faltan
    from pos
    group by vehiculo_id, matricula
    having count(*) filter (where montada) > 0
       and count(*) filter (where not montada) > 0
  ),
  sueltas as (
    select n.id, n.codigo_interno, n.marca, n.medida,
           (n.importacion_lote_id is not null) as del_historico
    from tc_neumaticos n
    where n.estado = 'montado'
      and (p_empresa is null or n.empresa_id = p_empresa)
      and not exists (select 1 from tc_montajes_actuales m where m.neumatico_id = n.id)
  )
  select json_build_object(
    'vehiculos', coalesce((
      select json_agg(json_build_object(
               'vehiculo_id', i.vehiculo_id, 'matricula', i.matricula,
               'montadas', i.montadas, 'posiciones', i.posiciones, 'faltan', to_json(i.faltan))
             order by i.matricula)
      from incompletos i), '[]'::json),
    'fichas_sin_posicion_total', (select count(*)::int from sueltas),
    'fichas_sin_posicion', coalesce((
      select json_agg(row_to_json(s) order by s.codigo_interno)
      from (select * from sueltas order by codigo_interno limit 200) s), '[]'::json)
  );
$$;

comment on function tc_informes_planos_incompletos(uuid) is
  'Vehículos con el plano a medias (alguna rueda informada y alguna posición '
  'sin rueda) y fichas en estado montado sin posición. Aviso del informe '
  '«Neumáticos controlados». security invoker: la RLS sigue mandando.';

revoke all on function tc_informes_planos_incompletos(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function tc_informes_planos_incompletos(uuid) from anon';
  end if;
end $$;
grant execute on function tc_informes_planos_incompletos(uuid) to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function tc_informes_planos_incompletos(uuid) to service_role';
  end if;
end $$;

-- ── Comprobación ────────────────────────────────────────────────────────────
do $$
declare j json;
begin
  j := tc_informes_planos_incompletos(null);
  if json_typeof(j->'vehiculos') <> 'array' or json_typeof(j->'fichas_sin_posicion') <> 'array'
     or (j->>'fichas_sin_posicion_total') is null then
    raise exception 'tc_informes_planos_incompletos no devuelve lo esperado: %', left(j::text, 200);
  end if;
  raise notice 'OK: aviso de planos incompletos instalado (% vehículos a medias, % fichas montadas sin posición, vistos desde aquí)',
    json_array_length(j->'vehiculos'), j->>'fichas_sin_posicion_total';
end $$;
