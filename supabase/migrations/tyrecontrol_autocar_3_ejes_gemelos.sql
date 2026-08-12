-- ============================================================
-- Mobilink TyreControl — Tres autocares a los que les faltaba un eje
--
-- 9405GMH, 9410GMH y 9415GMH (IDs de flota 1215, 1216 y 1217: un lote de
-- tres) llevan DIEZ ruedas —2 + 4 gemelas + 4 gemelas— y en TyreControl
-- estaban como Autocar, que tiene ocho. Las dos ruedas del segundo par del
-- tercer eje no las seguía nadie.
--
-- Lo confirma el informe del CheckPoint: 9405GMH cruzó el arco y midió las
-- diez. Los otros dos no han cruzado nunca, pero son el mismo modelo y el
-- mismo lote. Los otros 49 autocares del informe salen con diez filas
-- también, pero sus dos exteriores del tercer eje no se han medido JAMÁS:
-- ésas no existen, son huecos de la plantilla del CheckPoint, y esos 49 se
-- quedan como están.
--
-- Lo que hace:
--   1. Crea el tipo "Autocar 3 ejes gemelos" (2x4x4) con sus 10 posiciones.
--   2. Mueve los tres vehículos a ese tipo LLEVÁNDOSE SU HISTORIAL: montajes,
--      mediciones, incidencias, operaciones y reservas se reapuntan a la
--      posición equivalente del tipo nuevo.
--
-- LA RUEDA DEL TERCER EJE
--
-- El tipo viejo tenía una sola posición por lado en el eje 3 (E3_IZQ, E3_DER)
-- y el nuevo tiene dos (exterior e interior). Lo medido hasta ahora se lleva a
-- la EXTERIOR, que es la que se ve y la que mide un técnico que da la vuelta
-- al autocar. Es una elección, no un dato: si resulta que en el taller
-- apuntaban la interior, se cambia el mapeo de abajo y se vuelve a ejecutar
-- (aunque para entonces ya habrá que mover a mano lo que se haya reapuntado).
--
-- Idempotente: al segundo pase los vehículos ya están en el tipo nuevo y no
-- hace nada.
-- ============================================================

-- ── 1. El tipo ──────────────────────────────────────────────────────────────
insert into tc_tipos_vehiculo (nombre, descripcion, numero_ejes, numero_ruedas, configuracion_ejes, activo)
values ('autocar_2x4x4', 'Autocar 3 ejes gemelos', 3, 10, '2x4x4', true)
on conflict (nombre) do nothing;

-- ── 2. Sus posiciones ───────────────────────────────────────────────────────
-- Códigos, orden y coordenadas calcados de generarPosiciones('2x4x4')
-- (server/tyrecontrol/posicionesDesdeConfig.ts), igual que se hizo con
-- autobús y autocar.
insert into tc_posiciones_vehiculo (
  tipo_vehiculo_id, codigo_posicion, nombre, eje, lado, interior_exterior,
  orden_visual, pos_x, pos_y, pos_w, pos_h, activo)
select t.id, v.codigo, v.nombre, v.eje, v.lado, v.io, v.orden, v.x, v.y, 14, 14, true
from tc_tipos_vehiculo t
join (values
  ('E1_IZQ',    'Eje 1 izquierda',     1, 'izq', null,  1,  7.0, 10.0),
  ('E1_DER',    'Eje 1 derecha',       1, 'der', null,  2, 79.0, 10.0),
  ('E2_IZQ_EXT','Eje 2 izq. exterior', 2, 'izq', 'ext', 3,  0.0, 43.0),
  ('E2_IZQ_INT','Eje 2 izq. interior', 2, 'izq', 'int', 4, 14.0, 43.0),
  ('E2_DER_INT','Eje 2 der. interior', 2, 'der', 'int', 5, 72.0, 43.0),
  ('E2_DER_EXT','Eje 2 der. exterior', 2, 'der', 'ext', 6, 86.0, 43.0),
  ('E3_IZQ_EXT','Eje 3 izq. exterior', 3, 'izq', 'ext', 7,  0.0, 76.0),
  ('E3_IZQ_INT','Eje 3 izq. interior', 3, 'izq', 'int', 8, 14.0, 76.0),
  ('E3_DER_INT','Eje 3 der. interior', 3, 'der', 'int', 9, 72.0, 76.0),
  ('E3_DER_EXT','Eje 3 der. exterior', 3, 'der', 'ext',10, 86.0, 76.0)
) as v(codigo, nombre, eje, lado, io, orden, x, y) on true
where t.nombre = 'autocar_2x4x4'
on conflict (tipo_vehiculo_id, codigo_posicion) do nothing;

-- ── 3. Los tres vehículos, con su historial ─────────────────────────────────
do $$
declare
  v_nuevo uuid;
  v record;
  m record;
  n_veh int := 0; n_mov int := 0;
  -- Equivalencia entre el código de la posición vieja y la del tipo nuevo.
  -- Las seis primeras se llaman igual; las dos del tercer eje son las que
  -- había que decidir.
  mapa jsonb := jsonb_build_object(
    'E1_IZQ','E1_IZQ', 'E1_DER','E1_DER',
    'E2_IZQ_EXT','E2_IZQ_EXT', 'E2_IZQ_INT','E2_IZQ_INT',
    'E2_DER_INT','E2_DER_INT', 'E2_DER_EXT','E2_DER_EXT',
    'E3_IZQ','E3_IZQ_EXT', 'E3_DER','E3_DER_EXT',
    -- Por si alguno estuviera ya en un tipo con el eje 3 gemelo.
    'E3_IZQ_EXT','E3_IZQ_EXT', 'E3_IZQ_INT','E3_IZQ_INT',
    'E3_DER_INT','E3_DER_INT', 'E3_DER_EXT','E3_DER_EXT');
begin
  select id into v_nuevo from tc_tipos_vehiculo where nombre = 'autocar_2x4x4';

  for v in
    select id, matricula, tipo_vehiculo_id
      from tc_vehiculos
     where upper(btrim(matricula)) in ('9405GMH', '9410GMH', '9415GMH')
       and tipo_vehiculo_id is distinct from v_nuevo
  loop
    if v.tipo_vehiculo_id is null then
      -- Sin tipo no hay posiciones viejas que reapuntar: basta con ponerle el
      -- tipo bueno.
      update tc_vehiculos set tipo_vehiculo_id = v_nuevo where id = v.id;
      n_veh := n_veh + 1;
      continue;
    end if;

    -- Antes de tocar nada: que ninguna posición vieja se quede sin destino.
    -- Mover media ficha es peor que no moverla.
    if exists (
      select 1 from tc_posiciones_vehiculo p
       where p.tipo_vehiculo_id = v.tipo_vehiculo_id
         and not (mapa ? p.codigo_posicion))
    then
      raise exception
        'El vehículo % está en un tipo con posiciones que no sé a dónde llevar (%). Revísalo a mano.',
        v.matricula,
        (select string_agg(p.codigo_posicion, ', ') from tc_posiciones_vehiculo p
          where p.tipo_vehiculo_id = v.tipo_vehiculo_id and not (mapa ? p.codigo_posicion));
    end if;

    for m in
      select vieja.id as de, nueva.id as a, vieja.codigo_posicion as codigo
        from tc_posiciones_vehiculo vieja
        join tc_posiciones_vehiculo nueva
          on nueva.tipo_vehiculo_id = v_nuevo
         and nueva.codigo_posicion = (mapa ->> vieja.codigo_posicion)
       where vieja.tipo_vehiculo_id = v.tipo_vehiculo_id
    loop
      -- Todo lo que apunta a una posición y es de ESTE vehículo.
      update tc_montajes_actuales           set posicion_id = m.a where vehiculo_id = v.id and posicion_id = m.de;
      update tc_historial_montajes          set posicion_id = m.a where vehiculo_id = v.id and posicion_id = m.de;
      update revisiones_neumaticos_detalle  set posicion_id = m.a where vehiculo_id = v.id and posicion_id = m.de;
      update tc_incidencias                 set posicion_id = m.a where vehiculo_id = v.id and posicion_id = m.de;
      update tc_reservas_neumatico          set posicion_id = m.a where vehiculo_id = v.id and posicion_id = m.de;
      update operaciones_neumaticos         set posicion_origen_id  = m.a where vehiculo_id = v.id and posicion_origen_id  = m.de;
      update operaciones_neumaticos         set posicion_destino_id = m.a where vehiculo_id = v.id and posicion_destino_id = m.de;
      -- tc_neumaticos y tc_operacion_movimientos no llevan vehiculo_id: se
      -- filtran por el montaje/la operación de este vehículo.
      update tc_neumaticos n set posicion_id = m.a
       where n.posicion_id = m.de
         and exists (select 1 from tc_montajes_actuales x
                      where x.neumatico_id = n.id and x.vehiculo_id = v.id);
      update tc_operacion_movimientos mv set origen_posicion_id = m.a
       where mv.origen_posicion_id = m.de
         and exists (select 1 from operaciones_neumaticos o
                      where o.id = mv.operacion_id and o.vehiculo_id = v.id);
      update tc_operacion_movimientos mv set destino_posicion_id = m.a
       where mv.destino_posicion_id = m.de
         and exists (select 1 from operaciones_neumaticos o
                      where o.id = mv.operacion_id and o.vehiculo_id = v.id);
      n_mov := n_mov + 1;
    end loop;

    update tc_vehiculos set tipo_vehiculo_id = v_nuevo where id = v.id;
    n_veh := n_veh + 1;
    raise notice '% movido a Autocar 3 ejes gemelos', v.matricula;
  end loop;

  raise notice 'Vehículos movidos: % (% posiciones reapuntadas)', n_veh, n_mov;
end $$;

-- ── 4. Comprobación ─────────────────────────────────────────────────────────
do $$
declare n_pos int; n_ok int; n_falta int; r record; sueltas int;
begin
  select count(*) into n_pos from tc_posiciones_vehiculo p
    join tc_tipos_vehiculo t on t.id = p.tipo_vehiculo_id
   where t.nombre = 'autocar_2x4x4' and p.activo;
  if n_pos <> 10 then
    raise exception 'El tipo nuevo tiene % posiciones, esperaba 10', n_pos;
  end if;

  select count(*) into n_ok from tc_vehiculos v
    join tc_tipos_vehiculo t on t.id = v.tipo_vehiculo_id
   where upper(btrim(v.matricula)) in ('9405GMH','9410GMH','9415GMH')
     and t.nombre = 'autocar_2x4x4';
  select 3 - count(*) into n_falta from tc_vehiculos
   where upper(btrim(matricula)) in ('9405GMH','9410GMH','9415GMH');

  if n_falta > 0 then
    raise warning '% de los tres autocares no están dados de alta todavía; se moverán al volver a ejecutar esto', n_falta;
  end if;
  if n_ok <> 3 - n_falta then
    raise exception 'Solo % de los % autocares presentes están en el tipo nuevo', n_ok, 3 - n_falta;
  end if;

  -- Nada suyo puede haberse quedado colgando de una posición de otro tipo.
  select count(*) into sueltas
    from revisiones_neumaticos_detalle d
    join tc_vehiculos v on v.id = d.vehiculo_id
    join tc_posiciones_vehiculo p on p.id = d.posicion_id
   where upper(btrim(v.matricula)) in ('9405GMH','9410GMH','9415GMH')
     and p.tipo_vehiculo_id is distinct from v.tipo_vehiculo_id;
  if sueltas > 0 then
    raise exception '% mediciones siguen apuntando a la posición de otro tipo', sueltas;
  end if;

  for r in
    select v.matricula,
           (select count(*) from revisiones_neumaticos_detalle d where d.vehiculo_id = v.id) as mediciones,
           (select count(*) from tc_montajes_actuales x where x.vehiculo_id = v.id) as montadas
      from tc_vehiculos v
     where upper(btrim(v.matricula)) in ('9405GMH','9410GMH','9415GMH')
     order by v.matricula
  loop
    raise notice '  % → 10 posiciones · % mediciones · % ruedas montadas',
      r.matricula, r.mediciones, r.montadas;
  end loop;

  raise notice 'OK: los tres autocares ya tienen sus diez ruedas';
end $$;
