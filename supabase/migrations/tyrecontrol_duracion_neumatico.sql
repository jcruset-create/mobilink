-- ============================================================
-- SEA TyreControl — Lo que ha durado cada neumático.
--
-- El kilometraje no se anota por gusto: es lo único que permite decir si una
-- goma ha durado. Un neumático recorre (km al desmontar − km al montar) en
-- cada vehículo por el que pasa, y la suma de sus tramos es su vida.
--
-- La cadena ya existía: `tc_montajes_actuales.km_montaje`,
-- `tc_historial_montajes.km_desmontaje` y el informe de coste por km. Esta
-- migración tapa los dos sitios por donde se escapaba.
--
-- ── 1. El inventario inicial montaba SIN kilómetros ─────────────────────────
--
-- Al dar de alta una flota, las gomas que ya estaban puestas se montaban con
-- `km_montaje` a null —los km se pedían al final, en la revisión—. Y el
-- informe de duración exige km_montaje > 0, así que TODAS esas gomas quedaban
-- fuera del cálculo para siempre: justo las de la flota que se acaba de dar de
-- alta.
--
-- Ahora, al cerrar el inventario, sus montajes se quedan con los km del
-- vehículo. No son los km a los que la goma se montó de verdad —eso pasó antes
-- de conocerla y no se puede saber—, son los km desde los que EMPEZAMOS A
-- CONTAR. Es lo honesto y es lo que hace que cuente algo.
--
-- ── 2. Nadie decía cuánto había durado ──────────────────────────────────────
--
-- La ficha del neumático enseñaba los km de cada movimiento, pero no la
-- cuenta. `tc_neumatico_recorrido` la hace, tramo a tramo, y dice cuántos
-- tramos NO tienen kilometraje: un total al que le faltan datos tiene que
-- decirlo, o se lee como la vida entera de la goma y no lo es.
--
-- Aditiva. Idempotente.
-- ============================================================

-- ── 1. El inventario inicial anota los km ───────────────────────────────────
--
-- Se hace en el cierre, no en cada posición, porque es ahí donde se conocen
-- los kilómetros del vehículo.
create or replace function tc_inventario_inicial_km_montajes(
  p_vehiculo uuid,
  p_km numeric
) returns int
language plpgsql security definer set search_path = public as $$
declare v_tocados int;
begin
  if p_km is null or p_km <= 0 then return 0; end if;

  -- Solo los que están SIN km: si un montaje ya traía el suyo —porque se hizo
  -- por el camino normal— no se le pisa.
  update tc_montajes_actuales
     set km_montaje = p_km
   where vehiculo_id = p_vehiculo
     and coalesce(km_montaje, 0) = 0;
  get diagnostics v_tocados = row_count;
  return v_tocados;
end $$;

comment on function tc_inventario_inicial_km_montajes(uuid, numeric) is
  'Pone los km del vehículo a los montajes del inventario inicial que se '
  'crearon sin ellos. Sin esto, esas gomas nunca cuentan en la duración.';

-- ── 2. Lo que ha recorrido un neumático ─────────────────────────────────────
create or replace function tc_neumatico_recorrido(p_neumatico uuid)
returns jsonb
language sql security invoker stable as $$
  with tramos as (
    -- Los pasados: del histórico, con sus dos extremos.
    select h.fecha_montaje as desde, h.fecha_desmontaje as hasta,
           h.km_montaje, h.km_desmontaje,
           case when coalesce(h.km_montaje,0) > 0 and coalesce(h.km_desmontaje,0) > 0
                then greatest(h.km_desmontaje - h.km_montaje, 0) end as km,
           false as vigente
      from tc_historial_montajes h
     where h.neumatico_id = p_neumatico
    union all
    -- Y el de ahora: hasta los km que lleva el vehículo hoy.
    select m.fecha_montaje, null, m.km_montaje, v.km_actual,
           case when coalesce(m.km_montaje,0) > 0 and coalesce(v.km_actual,0) > 0
                then greatest(v.km_actual - m.km_montaje, 0) end,
           true
      from tc_montajes_actuales m
      join tc_vehiculos v on v.id = m.vehiculo_id
     where m.neumatico_id = p_neumatico
  )
  select jsonb_build_object(
    'km_total',        coalesce(sum(km), 0),
    'tramos',          count(*),
    -- Los que no se pueden contar se DICEN. Un total al que le faltan tramos
    -- se lee como la vida entera de la goma, y no lo es.
    'tramos_sin_km',   count(*) filter (where km is null),
    'montado_ahora',   coalesce(bool_or(vigente), false),
    'detalle',         coalesce(jsonb_agg(jsonb_build_object(
                          'desde', desde, 'hasta', hasta,
                          'km_montaje', km_montaje, 'km_desmontaje', km_desmontaje,
                          'km', km, 'vigente', vigente
                        ) order by desde), '[]'::jsonb)
  ) from tramos;
$$;

comment on function tc_neumatico_recorrido(uuid) is
  'Los km que ha recorrido un neumático, tramo a tramo. Dice cuántos tramos '
  'no tienen kilometraje: un total incompleto tiene que decirlo.';

grant execute on function tc_neumatico_recorrido(uuid) to authenticated;

-- ── El cierre del inventario, con la línea nueva ────────────────────────────
--
-- Se vuelve a definir ENTERA porque en SQL manda la última definición: no hay
-- forma de «añadir una línea» a una función ya creada. Es el mismo cuerpo que
-- en `tyrecontrol_inventario_inicial.sql` con una sola llamada añadida al
-- final, justo antes del return. Si algún día se toca esa función, hay que
-- tocar ESTA, que es la que vale.
create or replace function tc_inventario_inicial_finalizar(
  p_vehiculo uuid,
  p_km       numeric default null,
  p_origen_km text   default 'manual'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_veh      record;
  v_revision record;
  v_total    int;
  v_con_goma int;
  v_medidas  int;
  v_faltan   text;
begin
  select * into v_veh from tc_vehiculos where id = p_vehiculo;
  if not found then raise exception 'Vehículo no encontrado'; end if;
  if not (tc_is_superadmin()
          or (tc_is_admin() and v_veh.empresa_id = tc_auth_empresa_id())
          or tc_operador_ve_empresa(v_veh.empresa_id)) then
    raise exception 'Sin permiso sobre este vehículo';
  end if;

  -- Doble toque: la revisión ya cerrada se devuelve tal cual.
  select * into v_revision from revisiones_vehiculo
   where vehiculo_id = p_vehiculo and estado_revision = 'completada'
     and observaciones = 'Inventario inicial del vehículo'
   order by created_at desc limit 1;
  if found then
    return jsonb_build_object('revision_id', v_revision.id, 'ya_estaba', true);
  end if;

  select * into v_revision from revisiones_vehiculo
   where vehiculo_id = p_vehiculo and estado_revision = 'borrador'
   order by created_at desc limit 1;
  if not found then
    raise exception 'No hay ningún inventario empezado para este vehículo.';
  end if;

  select count(*)::int into v_total
    from tc_posiciones_vehiculo where tipo_vehiculo_id = v_veh.tipo_vehiculo_id and activo;
  if v_total = 0 then raise exception 'Este vehículo no tiene plano.'; end if;

  select count(*)::int into v_con_goma
    from tc_montajes_actuales where vehiculo_id = p_vehiculo;
  if v_con_goma < v_total then
    -- Se dice CUÁLES faltan, no solo cuántas: con ocho posiciones, «faltan 2»
    -- obliga a repasarlas todas.
    select string_agg(p.codigo_posicion, ', ' order by p.orden_visual) into v_faltan
      from tc_posiciones_vehiculo p
     where p.tipo_vehiculo_id = v_veh.tipo_vehiculo_id and p.activo
       and not exists (select 1 from tc_montajes_actuales m
                        where m.vehiculo_id = p_vehiculo and m.posicion_id = p.id);
    raise exception 'Faltan neumáticos por informar en: %', v_faltan;
  end if;

  select count(*)::int into v_medidas
    from revisiones_neumaticos_detalle
   where revision_id = v_revision.id and profundidad_mm is not null;
  if v_medidas < v_total then
    select string_agg(p.codigo_posicion, ', ' order by p.orden_visual) into v_faltan
      from tc_posiciones_vehiculo p
     where p.tipo_vehiculo_id = v_veh.tipo_vehiculo_id and p.activo
       and not exists (select 1 from revisiones_neumaticos_detalle d
                        where d.revision_id = v_revision.id and d.posicion_id = p.id
                          and d.profundidad_mm is not null);
    raise exception 'Faltan profundidades en: %', v_faltan;
  end if;

  update revisiones_vehiculo
     set estado_revision = 'completada',
         km_vehiculo = coalesce(p_km, km_vehiculo),
         origen_km   = coalesce(p_origen_km, origen_km),
         tecnico_id  = coalesce(tecnico_id, auth.uid()),
         updated_at  = now()
   where id = v_revision.id;

  -- Los km del vehículo solo suben, nunca bajan: una lectura más baja que la
  -- que ya había suele ser un dedazo o un cambio de cuadro, y sobrescribirla
  -- en silencio estropearía el cálculo de desgaste de todas sus gomas.
  if p_km is not null and p_km > coalesce(v_veh.km_actual, 0) then
    update tc_vehiculos set km_actual = p_km, origen_km = coalesce(p_origen_km, 'manual'),
                            updated_at = now()
     where id = p_vehiculo;
  end if;

  -- Los montajes del inventario se quedan con estos km: son los km desde los
  -- que se empieza a contar la vida de esas gomas. Sin esto, ninguna de ellas
  -- cuenta nunca en el informe de duración, que exige km_montaje > 0.
  perform tc_inventario_inicial_km_montajes(p_vehiculo, p_km);

  return jsonb_build_object('revision_id', v_revision.id, 'ya_estaba', false,
                            'posiciones', v_total, 'km', p_km);
end $$;

comment on function tc_inventario_inicial_finalizar(uuid, numeric, text) is
  'Cierra el inventario inicial: exige neumático y profundidad en TODAS las '
  'posiciones, y deja los km del vehículo en los montajes creados, para que '
  'esas gomas cuenten en la duración.';
