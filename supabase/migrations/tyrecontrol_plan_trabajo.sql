-- ============================================================
-- SEA TyreControl - PLAN DE TRABAJO sobre las ruedas de un vehiculo
--
-- Generaliza el plan de permutacion: se elige la accion en el panel
-- lateral y se marcan las ruedas afectadas. Todo el plan se aplica en
-- UNA transaccion y queda como UNA operacion 'plan_trabajo' con N
-- movimientos, de modo que deshacer revierte el parte entero.
--
-- Acciones soportadas en p_acciones:
--   mover        -> cambia de posicion / permuta (necesita "posicion")
--   reescultura  -> suma dibujo; "valor" = mm resultantes
--   giro         -> girar sobre llanta (misma posicion)
--   pinchazo | valvula | equilibrado -> reparacion en sitio
--   presion      -> ajuste de presion; "valor" = bar
--
-- El reesculturado y el giro se hacen EN EL CAMION: la rueda no sale
-- del vehiculo ni cambia de estado.
-- ============================================================

-- El recauchutado viene dado por la MARCA (p. ej. INSA siempre lo es),
-- no por el neumatico: asi se ve en la ficha sin tener que marcarlo uno a uno.
alter table tc_cat_marcas_neumatico add column if not exists es_recauchutado boolean not null default false;

-- INSA (Insa Turbo) es marca de recauchutado. El resto se marcan desde
-- Configuracion -> ficha de la marca -> "Marca de recauchutado".
update tc_cat_marcas_neumatico set es_recauchutado = true where upper(nombre) like 'INSA%';

alter table tc_neumaticos add column if not exists reesculturado boolean not null default false;
alter table tc_neumaticos add column if not exists girado_en_llanta boolean not null default false;

insert into tc_cat_tipos_operacion (codigo, nombre, orden, es_fisica) values
  ('reesculturado','Reesculturado',65,true),
  ('giro_llanta','Giro sobre llanta',66,true),
  ('plan_trabajo','Plan de trabajo',67,true)
on conflict (codigo) do nothing;

create or replace function tc_aplicar_plan_trabajo(
  p_vehiculo uuid, p_acciones jsonb, p_km numeric default null, p_obs text default null
) returns uuid
language plpgsql security definer set search_path = public as $func$
declare v_emp uuid; v_tipo uuid; v_op uuid; v_neu uuid; v_n int; a record; v_orden int := 0;
begin
  select empresa_id, tipo_vehiculo_id into v_emp, v_tipo from tc_vehiculos where id = p_vehiculo;
  if v_emp is null then raise exception 'Vehiculo no encontrado'; end if;
  if not (tc_is_superadmin() or (tc_is_admin() and v_emp = tc_auth_empresa_id()) or tc_operador_ve_empresa(v_emp)) then
    raise exception 'Sin permiso para operar en esta empresa';
  end if;

  select count(*) into v_n from jsonb_to_recordset(p_acciones)
    as x(tipo text, montaje uuid, posicion uuid, valor numeric);
  if coalesce(v_n, 0) = 0 then raise exception 'El plan esta vacio'; end if;

  -- Todas las ruedas deben estar montadas en ESTE vehiculo.
  if exists (select 1 from jsonb_to_recordset(p_acciones) as x(tipo text, montaje uuid, posicion uuid, valor numeric)
               left join tc_montajes_actuales m on m.id = x.montaje
              where m.id is null or m.vehiculo_id <> p_vehiculo) then
    raise exception 'Alguna rueda del plan no esta montada en este vehiculo';
  end if;

  -- Dos ruedas no pueden acabar en la misma posicion.
  if exists (select 1 from jsonb_to_recordset(p_acciones) as x(tipo text, montaje uuid, posicion uuid, valor numeric)
              where x.tipo = 'mover' and x.posicion is not null
              group by x.posicion having count(*) > 1) then
    raise exception 'Hay dos ruedas asignadas a la misma posicion';
  end if;

  -- Una posicion destino ocupada por una rueda que no se mueve romperia el plan.
  if exists (
    select 1 from jsonb_to_recordset(p_acciones) as x(tipo text, montaje uuid, posicion uuid, valor numeric)
      join tc_montajes_actuales oc on oc.vehiculo_id = p_vehiculo and oc.posicion_id = x.posicion
     where x.tipo = 'mover' and oc.id <> x.montaje
       and oc.id not in (select y.montaje from jsonb_to_recordset(p_acciones)
                           as y(tipo text, montaje uuid, posicion uuid, valor numeric) where y.tipo = 'mover')
  ) then
    raise exception 'Una posicion del plan la ocupa una rueda que no se mueve: incluyela en el plan';
  end if;

  -- Solo se reescultura lo que el catalogo permite.
  if exists (
    select 1 from jsonb_to_recordset(p_acciones) as x(tipo text, montaje uuid, posicion uuid, valor numeric)
      join tc_montajes_actuales m on m.id = x.montaje
      join tc_neumaticos n on n.id = m.neumatico_id
      left join tc_cat_modelos_neumatico mo on upper(mo.nombre) = upper(n.modelo)
      left join tc_referencias_neumatico r on r.modelo_id = mo.id
     where x.tipo = 'reescultura' and coalesce(r.reesculturable, true) = false
  ) then
    raise exception 'Alguna rueda marcada no es reesculturable segun el catalogo';
  end if;

  select m.neumatico_id into v_neu
    from jsonb_to_recordset(p_acciones) as x(tipo text, montaje uuid, posicion uuid, valor numeric)
    join tc_montajes_actuales m on m.id = x.montaje limit 1;

  insert into operaciones_neumaticos (empresa_id, vehiculo_id, neumatico_id, tipo_operacion,
    km_vehiculo, fecha_operacion, estado_anterior, estado_nuevo, destino, tecnico_id, observaciones)
  values (v_emp, p_vehiculo, v_neu, 'plan_trabajo', p_km, current_date,
    'montado', 'montado', 'vehiculo', auth.uid(),
    coalesce(p_obs, 'Plan de trabajo sobre el vehiculo (APK)'))
  returning id into v_op;

  -- Movimientos: se guarda el estado ANTERIOR en estado_anterior para poder
  -- deshacer (posicion de origen, mm previos, giro previo).
  for a in
    select x.tipo, x.montaje, x.posicion, x.valor, m.neumatico_id, m.posicion_id as origen,
           n.profundidad_actual_mm as mm_antes, n.girado_en_llanta as girado_antes
      from jsonb_to_recordset(p_acciones) as x(tipo text, montaje uuid, posicion uuid, valor numeric)
      join tc_montajes_actuales m on m.id = x.montaje
      join tc_neumaticos n on n.id = m.neumatico_id
     order by case x.tipo when 'mover' then 1 else 2 end
  loop
    v_orden := v_orden + 1;
    insert into tc_operacion_movimientos (operacion_id, neumatico_id, movimiento_tipo,
      origen_vehiculo_id, origen_posicion_id, destino_vehiculo_id, destino_posicion_id,
      estado_anterior, estado_nuevo, orden)
    values (v_op, a.neumatico_id,
      case a.tipo when 'mover' then 'cambio_posicion' else a.tipo end,
      p_vehiculo, a.origen, p_vehiculo, coalesce(a.posicion, a.origen),
      case a.tipo
        when 'reescultura' then 'mm:' || coalesce(a.mm_antes::text, '')
        when 'giro' then 'girado:' || a.girado_antes::text
        else 'montado' end,
      'montado', v_orden);
  end loop;

  -- 1) Movimientos de posicion: soltar todas y reasignar (evita chocar con
  --    unique(vehiculo_id, posicion_id)).
  update tc_montajes_actuales set posicion_id = null
   where id in (select x.montaje from jsonb_to_recordset(p_acciones)
                  as x(tipo text, montaje uuid, posicion uuid, valor numeric)
                 where x.tipo = 'mover' and x.posicion is not null);

  update tc_montajes_actuales m set posicion_id = x.posicion
    from jsonb_to_recordset(p_acciones) as x(tipo text, montaje uuid, posicion uuid, valor numeric)
   where m.id = x.montaje and x.tipo = 'mover' and x.posicion is not null;

  update tc_neumaticos n set posicion_id = m.posicion_id, updated_at = now()
    from tc_montajes_actuales m
   where n.id = m.neumatico_id
     and m.id in (select x.montaje from jsonb_to_recordset(p_acciones)
                    as x(tipo text, montaje uuid, posicion uuid, valor numeric)
                   where x.tipo = 'mover' and x.posicion is not null);

  -- 2) Reesculturado: nueva profundidad y marca permanente.
  update tc_neumaticos n set profundidad_actual_mm = coalesce(x.valor, n.profundidad_actual_mm),
                             reesculturado = true, updated_at = now()
    from jsonb_to_recordset(p_acciones) as x(tipo text, montaje uuid, posicion uuid, valor numeric)
    join tc_montajes_actuales m on m.id = x.montaje
   where n.id = m.neumatico_id and x.tipo = 'reescultura';

  -- 3) Giro sobre llanta: la rueda no se mueve, solo se marca.
  update tc_neumaticos n set girado_en_llanta = not n.girado_en_llanta, updated_at = now()
    from jsonb_to_recordset(p_acciones) as x(tipo text, montaje uuid, posicion uuid, valor numeric)
    join tc_montajes_actuales m on m.id = x.montaje
   where n.id = m.neumatico_id and x.tipo = 'giro';

  return v_op;
end $func$;
