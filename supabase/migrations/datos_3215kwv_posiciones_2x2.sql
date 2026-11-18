-- 3215KWV · unidad 1128 (Plana): sus gomas, en las posiciones de su tipo.
--
-- El vehículo es 2x2 y lleva 4 neumáticos (lo confirma Jordi, 18/11/2026). El
-- tipo «Turismo» que tiene es el bueno. Pero el Excel de importación lo dio de
-- alta como «Autobús 2x4» y le montó 5 gomas en posiciones de ese tipo
-- (E1_IZQ, E1_DER, E2_IZQ_EXT, E2_IZQ_INT, E2_DER_INT). Al ponerle su tipo de
-- verdad (17/11), la revisión solo ve DEL_IZQ, DEL_DER, TRAS_IZQ y TRAS_DER, y
-- las cuatro salen «sin neumático montado».
--
-- Lo que hace, como una CORRECCIÓN (no es un trabajo de taller: sin coste):
--
--   P1  E1_IZQ      → DEL_IZQ
--   P2  E1_DER      → DEL_DER
--   P3  E2_IZQ_EXT  → TRAS_IZQ
--   P5  E2_DER_INT  → TRAS_DER
--   P4  E2_IZQ_INT  → sale del vehículo como «no localizado»: un 2x2 no tiene
--                     gemela; es la quinta goma que el Excel inventó.
--
-- Igual que tc_corregir_posicion y tc_corregir_montado: mueve el montaje,
-- apunta la posición en la ficha y deja una operación «correccion_posicion» /
-- «correccion_montado» con su movimiento, para que el histórico lo explique.
-- Las funciones no se llaman porque piden un usuario y el editor SQL no lo es.
--
-- Solo toca este vehículo. Se prueba sola: si algo no está como se espera, no
-- toca nada. Repetida, no hace nada.

do $migracion$
declare
  v_veh   constant uuid := '812ce4f1-b7f1-4355-b0da-03ecfabc3920';
  v_tipo  constant uuid := 'f2ca7945-cc96-48b2-b546-44c959aacb6a';  -- Turismo 2x2
  v_emp   uuid;
  r       record;
  v_op    uuid;
  v_dest  uuid;
  v_n     int;
begin
  select empresa_id into v_emp from tc_vehiculos
   where id = v_veh and replace(matricula, ' ', '') = '3215KWV' and tipo_vehiculo_id = v_tipo;
  if v_emp is null then
    raise exception 'No se toca nada: 3215KWV no existe o ya no es de tipo Turismo.';
  end if;

  -- Ya arreglado: todas sus gomas en posiciones de su tipo.
  if not exists (
    select 1 from tc_montajes_actuales m
      join tc_posiciones_vehiculo p on p.id = m.posicion_id
     where m.vehiculo_id = v_veh and p.tipo_vehiculo_id is distinct from v_tipo
  ) then
    perform set_config('mobilink.resultado', 'Nada que hacer: 3215KWV ya tiene sus gomas en DEL/TRAS.', false);
    return;
  end if;

  -- Lo que se espera encontrar: exactamente estas 5, y las 4 de destino libres.
  select count(*) into v_n
    from tc_montajes_actuales m
    join tc_posiciones_vehiculo p on p.id = m.posicion_id
    join tc_neumaticos n on n.id = m.neumatico_id
   where m.vehiculo_id = v_veh
     and (p.codigo_posicion, n.numero_interno) in (
       ('E1_IZQ', 'IMP-3215KWV-P1'), ('E1_DER', 'IMP-3215KWV-P2'), ('E2_IZQ_EXT', 'IMP-3215KWV-P3'),
       ('E2_IZQ_INT', 'IMP-3215KWV-P4'), ('E2_DER_INT', 'IMP-3215KWV-P5'));
  if v_n <> 5 or (select count(*) from tc_montajes_actuales where vehiculo_id = v_veh) <> 5 then
    raise exception 'No se toca nada: 3215KWV no tiene las 5 gomas que se esperaban (encontradas %).', v_n;
  end if;
  if exists (
    select 1 from tc_montajes_actuales m join tc_posiciones_vehiculo p on p.id = m.posicion_id
     where m.vehiculo_id = v_veh and p.tipo_vehiculo_id = v_tipo
  ) then
    raise exception 'No se toca nada: alguna posición DEL/TRAS ya tiene goma.';
  end if;

  -- ── Las cuatro que se quedan: a su posición ──────────────────────────────
  for r in
    select m.id as montaje, m.neumatico_id, m.posicion_id as origen, x.destino
      from tc_montajes_actuales m
      join tc_posiciones_vehiculo p on p.id = m.posicion_id
      join (values ('E1_IZQ', 'DEL_IZQ'), ('E1_DER', 'DEL_DER'),
                   ('E2_IZQ_EXT', 'TRAS_IZQ'), ('E2_DER_INT', 'TRAS_DER')) as x(desde, destino)
        on x.desde = p.codigo_posicion
     where m.vehiculo_id = v_veh
  loop
    select id into v_dest from tc_posiciones_vehiculo
     where tipo_vehiculo_id = v_tipo and codigo_posicion = r.destino;
    if v_dest is null then raise exception 'No existe la posición % en Turismo.', r.destino; end if;

    update tc_montajes_actuales set posicion_id = v_dest where id = r.montaje;
    update tc_neumaticos set posicion_id = v_dest, updated_at = now() where id = r.neumatico_id;

    insert into operaciones_neumaticos (empresa_id, vehiculo_id, neumatico_id, tipo_operacion, posicion_origen_id,
      posicion_destino_id, montaje_origen_id, km_vehiculo, fecha_operacion, motivo, estado_anterior, estado_nuevo,
      destino, tecnico_id, observaciones, is_correccion)
    values (v_emp, v_veh, r.neumatico_id, 'correccion_posicion', r.origen, v_dest, r.montaje,
      null, current_date, 'error_montaje', 'montado', 'montado', 'vehiculo', null,
      'Importado como autobús 2x4; el vehículo es 2x2 [CORRECCIÓN DE POSICIÓN]', true)
    returning id into v_op;

    insert into tc_operacion_movimientos (operacion_id, neumatico_id, movimiento_tipo, origen_vehiculo_id,
      origen_posicion_id, destino_vehiculo_id, destino_posicion_id, estado_anterior, estado_nuevo, orden)
    values (v_op, r.neumatico_id, 'correccion', v_veh, r.origen, v_veh, v_dest, 'montado', 'montado', 1);
  end loop;

  -- ── La quinta: fuera del vehículo, no localizada ─────────────────────────
  for r in
    select m.id as montaje, m.neumatico_id, m.posicion_id as origen
      from tc_montajes_actuales m
      join tc_posiciones_vehiculo p on p.id = m.posicion_id
     where m.vehiculo_id = v_veh and p.codigo_posicion = 'E2_IZQ_INT'
  loop
    insert into operaciones_neumaticos (empresa_id, vehiculo_id, neumatico_id, tipo_operacion, posicion_origen_id,
      montaje_origen_id, km_vehiculo, fecha_operacion, motivo, estado_anterior, estado_nuevo,
      destino, tecnico_id, observaciones, is_correccion)
    values (v_emp, v_veh, r.neumatico_id, 'correccion_montado', r.origen, r.montaje,
      null, current_date, 'error_montaje', 'montado', 'no_localizado', null, null,
      'Un 2x2 no lleva gemela: quinta goma de la importación como autobús 2x4 [CORRECCIÓN DE MONTADO · → no localizado]', true)
    returning id into v_op;

    insert into tc_operacion_movimientos (operacion_id, neumatico_id, movimiento_tipo, origen_vehiculo_id,
      origen_posicion_id, destino_vehiculo_id, destino_posicion_id, estado_anterior, estado_nuevo, orden)
    values (v_op, r.neumatico_id, 'correccion', v_veh, r.origen, null, null, 'montado', 'no_localizado', 1);

    delete from tc_montajes_actuales where id = r.montaje;
    update tc_neumaticos set estado = 'no_localizado', vehiculo_id = null, posicion_id = null, updated_at = now()
     where id = r.neumatico_id;
  end loop;

  -- ── Comprobación ─────────────────────────────────────────────────────────
  select count(*) into v_n from tc_montajes_actuales m
    join tc_posiciones_vehiculo p on p.id = m.posicion_id
   where m.vehiculo_id = v_veh and p.tipo_vehiculo_id = v_tipo;
  if v_n <> 4 or (select count(*) from tc_montajes_actuales where vehiculo_id = v_veh) <> 4 then
    raise exception 'No ha quedado bien (% gomas en DEL/TRAS): se deshace todo.', v_n;
  end if;

  perform set_config('mobilink.resultado',
    'OK: 3215KWV con sus 4 gomas en DEL_IZQ, DEL_DER, TRAS_IZQ y TRAS_DER; IMP-3215KWV-P4 pasa a no localizado.', false);
end
$migracion$;

select current_setting('mobilink.resultado', true) as resultado,
       (select json_agg(p.codigo_posicion || ' · ' || n.numero_interno order by p.codigo_posicion)
          from tc_montajes_actuales m
          join tc_posiciones_vehiculo p on p.id = m.posicion_id
          join tc_neumaticos n on n.id = m.neumatico_id
         where m.vehiculo_id = '812ce4f1-b7f1-4355-b0da-03ecfabc3920') as montadas;
