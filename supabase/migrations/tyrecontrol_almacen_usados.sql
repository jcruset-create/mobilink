-- ============================================================
-- Mobilink TyreControl — Almacén de usados: gomas concretas, con su serie y
-- sus milímetros. Y reesculturar una que ya está desmontada.
--
-- FASE 6 de docs/PROMPT_identificacion_neumaticos.md
-- Cierra lo pedido en docs/PROMPT_almacen_usados_individual.md
-- Requiere: tyrecontrol_politica_identificacion.sql (fase 2)
--
-- LO QUE SE PIDIÓ
--
--   «si los hemos reesculturado después de desmontarlos tendrá que haber un
--    almacén de neumáticos usados ordenados por número de serie y/o de
--    profundidad»
--
-- Son dos cosas, y las dos faltaban:
--
--   1. Reesculturar una goma que ya está en el almacén. Hoy la reescultura es
--      una acción del plan de trabajo (tyrecontrol_plan_trabajo.sql:135) que
--      exige un tc_montajes_actuales, porque —dice su cabecera— «se hace EN EL
--      CAMION: la rueda no sale del vehículo». Es una decisión de diseño, no un
--      olvido, pero deja fuera justo el caso contrario.
--
--   2. Un almacén consultable. El dato ya existe: tc_neumaticos con
--      estado='almacen' guarda serie, RFID, DOT, profundidad y reesculturado.
--      Nunca se ha enseñado en ninguna pantalla.
--
-- SOBRE EL DOBLE CONTEO (Decisión 1, todavía sin responder)
--
-- Al desmontar a almacén pasan DOS cosas: la ficha de tc_neumaticos queda con
-- estado='almacen' (con su identidad y sus mm) y, además,
-- tc_devolver_usado_a_stock suma +1 anónimo a movimientos_stock. La misma goma
-- cuenta dos veces, y ocurre HOY, con identidad o sin ella.
--
-- Esta migración NO lo resuelve: eso es la Decisión 1 y sigue abierta. Lo que
-- hace es dejarlo A LA VISTA — tc_almacen_usados_resumen devuelve los dos
-- números por separado para que la diferencia se vea en pantalla en vez de
-- estar escondida en una suma.
--
-- Idempotente: se puede ejecutar varias veces.
-- ============================================================

-- ── 1. Reesculturar una goma que está en el almacén ─────────────────────────
--
-- El tipo de operación 'reesculturado' ya existe en el catálogo desde
-- tyrecontrol_plan_trabajo.sql:32, así que no hay que dar de alta nada.
create or replace function tc_reesculturar_en_almacen(
  p_neumatico uuid, p_profundidad_mm numeric, p_obs text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_neu record; v_antes numeric;
begin
  select * into v_neu from tc_neumaticos where id = p_neumatico;
  if not found then raise exception 'Neumático no encontrado'; end if;

  if not (tc_is_superadmin() or (tc_is_admin() and v_neu.empresa_id = tc_auth_empresa_id())
          or tc_operador_ve_empresa(v_neu.empresa_id)) then
    raise exception 'Sin permiso sobre esta empresa';
  end if;

  -- Montada NO: para eso está el plan de trabajo, que la reesculpe en el
  -- camión y deja el parte entero como una sola operación deshacible.
  if v_neu.estado not in ('almacen','reservado') then
    raise exception 'REESCULTURA_NO_EN_ALMACEN: el neumático % está en estado "%". Desde aquí solo se reesculpen las gomas que están en el almacén; si está puesta, hazlo desde el plan de trabajo del vehículo.',
      coalesce(v_neu.numero_interno,'?'), v_neu.estado;
  end if;
  if v_neu.activo is not true then
    raise exception 'REESCULTURA_DE_BAJA: el neumático % está dado de baja.', coalesce(v_neu.numero_interno,'?');
  end if;

  if p_profundidad_mm is null or p_profundidad_mm <= 0 then
    raise exception 'REESCULTURA_SIN_MM: hay que indicar los milímetros que quedan después de reesculturar.';
  end if;

  -- Reesculturar SUMA dibujo: si el número baja, es que alguien se ha
  -- equivocado de campo o de rueda.
  if v_neu.profundidad_actual_mm is not null and p_profundidad_mm < v_neu.profundidad_actual_mm then
    raise exception 'REESCULTURA_MENOS_DIBUJO: el neumático % tiene % mm y se están indicando % mm. Reesculturar añade dibujo, no lo quita.',
      coalesce(v_neu.numero_interno,'?'), v_neu.profundidad_actual_mm, p_profundidad_mm;
  end if;

  v_antes := v_neu.profundidad_actual_mm;

  -- El trigger de tyrecontrol_profundidad_manual.sql sella la fecha al cambiar
  -- el valor, así que la medición vieja deja de tapar a estos milímetros.
  update tc_neumaticos
     set profundidad_actual_mm = p_profundidad_mm,
         reesculturado = true,
         updated_at = now()
   where id = p_neumatico;

  insert into operaciones_neumaticos (empresa_id, neumatico_id, tipo_operacion,
    fecha_operacion, estado_anterior, estado_nuevo, tecnico_id, observaciones)
  values (v_neu.empresa_id, p_neumatico, 'reesculturado', current_date,
    v_neu.estado, v_neu.estado, auth.uid(),
    trim(both ' ' from coalesce(p_obs,'')
      || ' [REESCULTURADO EN ALMACÉN: ' || coalesce(v_antes::text,'?') || ' → ' || p_profundidad_mm || ' mm]'));

  return jsonb_build_object(
    'numero_interno', v_neu.numero_interno,
    'antes_mm', v_antes,
    'ahora_mm', p_profundidad_mm
  );
end $$;

comment on function tc_reesculturar_en_almacen(uuid, numeric, text) is
  'Reescultura de una goma YA DESMONTADA. Para las montadas está el plan de '
  'trabajo (tc_aplicar_plan_trabajo), que las reesculpe en el camión.';

-- ── 2. El almacén de usados ─────────────────────────────────────────────────
--
-- Una fila por goma real, con lo que hace falta para elegir cuál montar:
-- quién es, cuánto dibujo le queda y de dónde viene.
create or replace function tc_almacen_usados(p_empresa uuid)
returns table(
  neumatico_id uuid, numero_interno text, numero_serie text, rfid_epc text, dot text,
  marca text, modelo text, medida text,
  profundidad_actual_mm numeric, profundidad_actualizada_en timestamptz,
  reesculturado boolean, estado text, origen text,
  fecha_desmontaje date, matricula_anterior text, km_acumulados numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (tc_is_superadmin() or (tc_is_admin() and p_empresa = tc_auth_empresa_id()) or tc_operador_ve_empresa(p_empresa)) then
    raise exception 'Sin permiso sobre esta empresa';
  end if;
  return query
  select n.id, n.numero_interno, n.numero_serie, n.rfid_epc, n.dot,
         n.marca, n.modelo, n.medida,
         n.profundidad_actual_mm, n.profundidad_actualizada_en,
         n.reesculturado, n.estado, n.origen,
         h.fecha_desmontaje, h.matricula,
         -- Km que lleva rodados, sumando todos sus montajes cerrados. Es el
         -- dato que justifica llevar control individual.
         (select sum(greatest(coalesce(x.km_desmontaje,0) - coalesce(x.km_montaje,0), 0))
            from tc_historial_montajes x where x.neumatico_id = n.id)
    from tc_neumaticos n
    left join lateral (
      select hm.fecha_desmontaje, v.matricula
        from tc_historial_montajes hm
        left join tc_vehiculos v on v.id = hm.vehiculo_id
       where hm.neumatico_id = n.id
       order by hm.fecha_desmontaje desc nulls last
       limit 1
    ) h on true
   where n.empresa_id = p_empresa
     and n.activo = true
     and n.estado in ('almacen','reservado')
   order by n.profundidad_actual_mm desc nulls last, n.numero_serie nulls last, n.numero_interno;
end $$;

comment on function tc_almacen_usados(uuid) is
  'Gomas que están en el almacén, una por fila, con identidad, milímetros y '
  'procedencia. Ordenadas por dibujo restante: la que mejor casa, primero.';

-- ── 3. Resumen, con el doble conteo a la vista ──────────────────────────────
--
-- `fichas` cuenta gomas reales en tc_neumaticos; `unidades_stock` cuenta lo
-- que dice movimientos_stock. Deberían coincidir y hoy no lo hacen: mientras
-- tc_devolver_usado_a_stock siga sumando un +1 anónimo por cada desmontaje,
-- la misma goma cuenta dos veces. Enseñar los dos números es lo que permite
-- decidir la Decisión 1 con un dato delante en vez de con una intuición.
create or replace function tc_almacen_usados_resumen(p_empresa uuid)
returns table(fichas bigint, con_identidad bigint, reesculturadas bigint, unidades_stock numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_cliente uuid;
begin
  if not (tc_is_superadmin() or (tc_is_admin() and p_empresa = tc_auth_empresa_id()) or tc_operador_ve_empresa(p_empresa)) then
    raise exception 'Sin permiso sobre esta empresa';
  end if;
  select cliente_almacen_id into v_cliente from tc_empresas where id = p_empresa;
  return query
  select
    (select count(*) from tc_neumaticos n
      where n.empresa_id = p_empresa and n.activo and n.estado in ('almacen','reservado')),
    (select count(*) from tc_neumaticos n
      where n.empresa_id = p_empresa and n.activo and n.estado in ('almacen','reservado')
        and (n.rfid_epc is not null or n.numero_serie is not null)),
    (select count(*) from tc_neumaticos n
      where n.empresa_id = p_empresa and n.activo and n.estado in ('almacen','reservado')
        and n.reesculturado),
    -- ::numeric obligatorio: cantidad es entera, sum() daría bigint y RETURN
    -- QUERY exige el tipo declarado exacto (42804). Ver el fix
    -- tyrecontrol_fix_resumen_usados_tipo.sql.
    coalesce((select sum(case when ms.tipo = 'SALIDA' then -ms.cantidad else ms.cantidad end)::numeric
                from movimientos_stock ms
               where ms.cliente_id = v_cliente and ms.condicion = 'usado'), 0);
end $$;

comment on function tc_almacen_usados_resumen(uuid) is
  'Cuántas gomas hay en almacén según tc_neumaticos y cuántas según '
  'movimientos_stock. Si no cuadran, es el doble conteo de la Decisión 1.';

-- ── 4. Comprobaciones ───────────────────────────────────────────────────────
do $$
declare n int;
begin
  select count(*) into n from pg_proc where proname = 'tc_reesculturar_en_almacen';
  if n <> 1 then raise exception 'tc_reesculturar_en_almacen: se esperaba 1 versión, hay %', n; end if;

  select count(*) into n from tc_cat_tipos_operacion where codigo = 'reesculturado';
  if n <> 1 then raise warning 'Falta el tipo de operación reesculturado en el catálogo (¿se ha subido tyrecontrol_plan_trabajo.sql?)'; end if;

  -- Reesculturar en almacén NO debe tocar el montaje ni el estado: si empezara
  -- a hacerlo, se solaparía con el plan de trabajo y habría dos caminos que
  -- hacen lo mismo de forma distinta.
  select count(*) into n from pg_proc
   where proname = 'tc_reesculturar_en_almacen'
     and (prosrc like '%tc_montajes_actuales%' or prosrc like '%estado =%');
  if n <> 0 then raise exception 'tc_reesculturar_en_almacen está tocando el montaje o el estado'; end if;

  raise notice 'OK: almacén de usados consultable y reescultura fuera del camión';
end $$;
