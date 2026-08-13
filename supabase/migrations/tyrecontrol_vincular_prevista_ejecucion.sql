-- ============================================================
-- Mobilink TyreControl — Vincular la operación PREVISTA con su EJECUCIÓN.
--
-- Fase 2 del rediseño de Intervenciones y Operaciones
-- (docs/ANALISIS_FASE0_intervenciones_operaciones.md, §F: decisión VINCULAR).
-- Requiere: tyrecontrol_intervencion_abierta_y_transiciones.sql (fase 1,
-- por el trigger que permite activo → completada).
--
-- EL PROBLEMA QUE SE CIERRA
--
-- Planificar y ejecutar eran dos mundos: tc_planificar_operacion creaba una
-- fila en 'pendiente'/'planificada' y los RPC de ejecución creaban SU propia
-- fila ya completada, sin conocerse. Resultado: dos filas por trabajo, la
-- prevista pendiente para siempre, y "Completar" en el panel cerrando fichas
-- sin mover un neumático.
--
-- CÓMO SE VINCULA (y por qué así)
--
-- El análisis planteaba añadir un parámetro opcional a los catorce RPC de
-- ejecución. Eso obligaba a copiar y reescribir ~1.500 líneas de RPC en
-- producción y a lidiar con la ambigüedad de sobrecargas en PostgREST.
-- Se hace algo más seguro que consigue lo mismo:
--
--   · Los catorce RPC quedan INTACTOS, byte a byte.
--   · Un despachador, tc_ejecutar_prevista(prevista, rpc, args), valida la
--     prevista, deja su id en un ajuste LOCAL DE LA TRANSACCIÓN
--     (set_config('tc.prevista', …, true)), llama al RPC de siempre, y al
--     volver cierra la prevista como completada. Todo en una transacción:
--     o se monta Y se vincula Y se cierra el plan, o no pasa nada.
--   · Un trigger BEFORE INSERT estampa operacion_prevista_id en cada fila
--     que la ejecución inserte mientras el ajuste está puesto, y le copia lo
--     que la ejecución no trae (incidencia, fecha prevista, prioridad,
--     motivo). Una sustitución (DOS filas) o un plan de trabajo (N filas)
--     quedan enlazados enteros a la misma prevista, que es exactamente la
--     relación N→1 por la que se eligió vincular en vez de absorber.
--
-- ADEMÁS
--
--   · tc_cambiar_estado_operacion deja de aceptar 'completada' A MANO para
--     tipos físicos (es_fisica en tc_cat_tipos_operacion): completar sin
--     ejecutar era la mentira del panel. Las correcciones y los tipos fuera
--     de catálogo siguen como hoy.
--   · tc_agrupar_operaciones_sueltas solo envuelve operaciones COMPLETADAS:
--     hasta ahora envolvía también previstas sin ejecutar en
--     "intervenciones" de una línea que parecían trabajo hecho (§A.4 del
--     análisis).
--
-- RESERVAS (invariante 4): al ejecutar, la reserva activa de la prevista se
-- CONSUME si el neumático reservado es el que de verdad se usó, y se LIBERA
-- (con motivo) si se ejecutó con otro. Cancelar/anular siguen liberando.
--
-- Idempotente: reejecutable sin efectos secundarios.
-- ============================================================

-- ── 1. El vínculo ───────────────────────────────────────────────────────────
alter table operaciones_neumaticos
  add column if not exists operacion_prevista_id uuid references operaciones_neumaticos(id) on delete set null;
create index if not exists idx_op_prevista on operaciones_neumaticos (operacion_prevista_id);

comment on column operaciones_neumaticos.operacion_prevista_id is
  'Operación planificada que esta fila ejecuta. N filas de ejecución pueden '
  'apuntar a la misma prevista (una sustitución son dos). La estampa el '
  'trigger trg_op_hereda_prevista dentro de tc_ejecutar_prevista.';

-- ── 2. Herencia del plan al insertar la ejecución ───────────────────────────
create or replace function tc_op_hereda_prevista() returns trigger
language plpgsql as $$
declare v_prev record; v_ctx text;
begin
  v_ctx := nullif(current_setting('tc.prevista', true), '');
  if v_ctx is null then return new; end if;

  if new.operacion_prevista_id is null then
    new.operacion_prevista_id := v_ctx::uuid;
  end if;

  -- Lo previsto viaja a la ejecutada SOLO donde la ejecución no trae dato:
  -- así las consultas de una fila (informes, incidencias) no necesitan el join.
  select * into v_prev from operaciones_neumaticos where id = v_ctx::uuid;
  if found then
    new.incidencia_id  := coalesce(new.incidencia_id,  v_prev.incidencia_id);
    new.fecha_prevista := coalesce(new.fecha_prevista, v_prev.fecha_prevista);
    new.motivo         := coalesce(new.motivo,         v_prev.motivo);
    if coalesce(new.prioridad, 'normal') = 'normal' and coalesce(v_prev.prioridad, 'normal') <> 'normal' then
      new.prioridad := v_prev.prioridad;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_op_hereda_prevista on operaciones_neumaticos;
create trigger trg_op_hereda_prevista
  before insert on operaciones_neumaticos
  for each row execute function tc_op_hereda_prevista();

-- ── 3. El despachador: ejecutar una prevista con el RPC de siempre ──────────
--
-- p_rpc va contra una lista cerrada (los catorce de ejecución) con los
-- argumentos desempaquetados de p_args con los MISMOS nombres y defaults que
-- el RPC real. Nada de SQL dinámico.
create or replace function tc_ejecutar_prevista(p_prevista uuid, p_rpc text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o record; r record; v_res jsonb := 'null'::jsonb; v_ids uuid[]; v_mal int;
begin
  select * into o from operaciones_neumaticos where id = p_prevista for update;
  if not found then raise exception 'Operación prevista no encontrada'; end if;
  if not (tc_is_superadmin() or (tc_is_admin() and o.empresa_id = tc_auth_empresa_id()) or tc_operador_ve_empresa(o.empresa_id)) then
    raise exception 'Sin permiso sobre esta operación';
  end if;
  if o.is_anulada then raise exception 'La operación prevista está anulada'; end if;
  if o.status not in ('borrador','pendiente','planificada','asignada','en_proceso','pausada') then
    raise exception 'La operación prevista está en estado "%": ya no se puede ejecutar', o.status;
  end if;

  -- Contexto de transacción: todo lo que la ejecución inserte a partir de
  -- aquí queda vinculado por trg_op_hereda_prevista.
  perform set_config('tc.prevista', p_prevista::text, true);

  case p_rpc
    when 'tc_montar_desde_almacen' then
      v_res := to_jsonb(tc_montar_desde_almacen(
        (p_args->>'p_vehiculo')::uuid, (p_args->>'p_posicion')::uuid,
        (p_args->>'p_producto_almacen')::uuid, (p_args->>'p_control_individual')::boolean,
        coalesce(p_args->'p_datos', '{}'::jsonb), (p_args->>'p_km')::numeric,
        coalesce((p_args->>'p_fecha')::date, current_date), p_args->>'p_obs',
        coalesce((p_args->>'p_forzar_medida')::boolean, false), coalesce(p_args->>'p_condicion', 'nuevo')));
    when 'tc_montar_desde_catalogo' then
      v_res := to_jsonb(tc_montar_desde_catalogo(
        (p_args->>'p_vehiculo')::uuid, (p_args->>'p_posicion')::uuid,
        (p_args->>'p_referencia')::uuid, (p_args->>'p_control_individual')::boolean,
        coalesce(p_args->'p_datos', '{}'::jsonb), (p_args->>'p_km')::numeric,
        coalesce((p_args->>'p_fecha')::date, current_date), p_args->>'p_obs',
        coalesce((p_args->>'p_forzar_medida')::boolean, false), coalesce(p_args->>'p_condicion', 'nuevo'),
        (p_args->>'p_montaje_actual')::uuid, coalesce(p_args->>'p_motivo_desmontaje', 'desgaste'),
        coalesce(p_args->>'p_destino_retirado', 'almacen')));
    when 'tc_montar_fuera_almacen' then
      v_res := to_jsonb(tc_montar_fuera_almacen(
        (p_args->>'p_vehiculo')::uuid, (p_args->>'p_posicion')::uuid,
        (p_args->>'p_control_individual')::boolean, coalesce(p_args->'p_datos', '{}'::jsonb),
        p_args->>'p_motivo', (p_args->>'p_km')::numeric,
        coalesce((p_args->>'p_fecha')::date, current_date), p_args->>'p_obs'));
    when 'tc_desmontar_neumatico' then
      perform tc_desmontar_neumatico(
        (p_args->>'p_montaje')::uuid, (p_args->>'p_km')::numeric, p_args->>'p_motivo',
        coalesce(p_args->>'p_nuevo_estado', 'almacen'), p_args->>'p_obs');
    when 'tc_sustituir_neumatico' then
      v_res := to_jsonb(tc_sustituir_neumatico(
        (p_args->>'p_montaje_actual')::uuid, (p_args->>'p_producto_almacen')::uuid,
        (p_args->>'p_control_individual')::boolean, coalesce(p_args->'p_datos', '{}'::jsonb),
        coalesce(p_args->>'p_motivo_desmontaje', 'desgaste'), coalesce(p_args->>'p_destino_retirado', 'almacen'),
        (p_args->>'p_km')::numeric, coalesce((p_args->>'p_fecha')::date, current_date), p_args->>'p_obs',
        coalesce((p_args->>'p_forzar_medida')::boolean, false), coalesce(p_args->>'p_condicion', 'nuevo')));
    when 'tc_cambiar_posicion' then
      v_res := to_jsonb(tc_cambiar_posicion(
        (p_args->>'p_montaje')::uuid, (p_args->>'p_posicion_destino')::uuid,
        (p_args->>'p_km')::numeric, p_args->>'p_obs'));
    when 'tc_intercambiar_posiciones' then
      v_res := to_jsonb(tc_intercambiar_posiciones(
        (p_args->>'p_montaje_a')::uuid, (p_args->>'p_montaje_b')::uuid,
        (p_args->>'p_km')::numeric, p_args->>'p_obs'));
    when 'tc_corregir_posicion' then
      v_res := to_jsonb(tc_corregir_posicion(
        (p_args->>'p_montaje')::uuid, (p_args->>'p_posicion_correcta')::uuid, p_args->>'p_obs'));
    when 'tc_corregir_montado' then
      v_res := to_jsonb(tc_corregir_montado(
        (p_args->>'p_montaje')::uuid, (p_args->>'p_neumatico_correcto')::uuid, p_args->>'p_obs'));
    when 'tc_registrar_reparacion' then
      v_res := to_jsonb(tc_registrar_reparacion(
        (p_args->>'p_neumatico')::uuid, p_args->>'p_tipo_reparacion', p_args->>'p_resultado',
        p_args->>'p_proveedor', (p_args->>'p_coste')::numeric, (p_args->>'p_km')::numeric, p_args->>'p_obs'));
    when 'tc_descartar_neumatico' then
      perform tc_descartar_neumatico(
        (p_args->>'p_neumatico')::uuid, coalesce(p_args->>'p_motivo', 'fin_vida'), p_args->>'p_obs');
    when 'tc_regularizar_desmontaje' then
      v_res := tc_regularizar_desmontaje((p_args->>'p_neumatico')::uuid, p_args->>'p_obs');
    when 'tc_aplicar_plan_trabajo' then
      v_res := to_jsonb(tc_aplicar_plan_trabajo(
        (p_args->>'p_vehiculo')::uuid, p_args->'p_acciones', (p_args->>'p_km')::numeric, p_args->>'p_obs'));
    when 'tc_permutar_plan' then
      v_res := to_jsonb(tc_permutar_plan(
        (p_args->>'p_vehiculo')::uuid, p_args->'p_destinos', (p_args->>'p_km')::numeric, p_args->>'p_obs'));
    else
      raise exception 'RPC de ejecución no reconocido: %', p_rpc;
  end case;

  perform set_config('tc.prevista', '', true);

  -- Lo que ESTA ejecución acaba de vincular (created_at = now() de la
  -- transacción). Si el RPC no insertó nada, aquí se deshace todo.
  select array_agg(id) into v_ids
    from operaciones_neumaticos
   where operacion_prevista_id = p_prevista and created_at >= transaction_timestamp();
  if v_ids is null then
    raise exception 'La ejecución no ha registrado ninguna operación; se deshace todo';
  end if;

  -- La ejecución tiene que ser del vehículo previsto (si el plan lo fijaba).
  if o.vehiculo_id is not null then
    select count(*) into v_mal from operaciones_neumaticos
     where id = any(v_ids) and vehiculo_id is not null and vehiculo_id <> o.vehiculo_id;
    if v_mal > 0 then
      raise exception 'La ejecución toca un vehículo distinto del previsto; se deshace todo';
    end if;
  end if;

  -- Cerrar el plan. Directo, no vía tc_cambiar_estado_operacion: ese RPC
  -- rechaza 'completada' a mano para tipos físicos, y esto NO es a mano.
  -- El trigger de fase 1 permite activo → completada y el historial de
  -- estados se apunta solo (trg_op_log_estado).
  update operaciones_neumaticos
     set status = 'completada', completed_at = now(), updated_at = now()
   where id = p_prevista;

  -- Reservas: consumida si se usó el neumático reservado; liberada si se
  -- ejecutó con otro (el reservado sigue disponible y no queda bloqueado).
  for r in select * from tc_reservas_neumatico where operacion_id = p_prevista and status = 'activa' loop
    if exists (select 1 from operaciones_neumaticos where id = any(v_ids) and neumatico_id = r.neumatico_id) then
      update tc_reservas_neumatico
         set status = 'consumida', liberado_at = now(), liberado_por = auth.uid(), updated_at = now()
       where id = r.id;
    else
      update tc_reservas_neumatico
         set status = 'liberada', liberado_at = now(), liberado_por = auth.uid(),
             motivo_liberacion = 'ejecutada con otro neumático', updated_at = now()
       where id = r.id;
    end if;
  end loop;

  insert into tc_operacion_auditoria (operacion_id, accion, datos_nuevos)
  values (p_prevista, 'ejecutar', jsonb_build_object('rpc', p_rpc, 'operaciones', to_jsonb(v_ids)));

  return jsonb_build_object('prevista', p_prevista, 'operaciones', to_jsonb(v_ids), 'resultado', v_res);
end $$;

comment on function tc_ejecutar_prevista(uuid, text, jsonb) is
  'Ejecuta una operación prevista con el RPC de ejecución indicado (lista '
  'cerrada), vincula las filas resultantes (operacion_prevista_id), cierra la '
  'prevista como completada y consume/libera su reserva. Atómico.';

grant execute on function tc_ejecutar_prevista(uuid, text, jsonb) to authenticated;

-- ── 4. 'Completada' a mano, solo para lo no físico ──────────────────────────
--
-- Mismo cuerpo que operaciones_fase5 con un único añadido: un tipo físico
-- (es_fisica en el catálogo) no se completa cambiando el estado — se ejecuta.
-- Misma firma: create or replace no crea sobrecarga.
create or replace function tc_cambiar_estado_operacion(
  p_operacion uuid, p_nuevo_estado text, p_tecnico uuid default null, p_motivo text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare o record;
begin
  select * into o from operaciones_neumaticos where id = p_operacion;
  if not found then raise exception 'Operación no encontrada'; end if;
  if not (tc_is_superadmin() or (tc_is_admin() and o.empresa_id = tc_auth_empresa_id()) or tc_operador_ve_empresa(o.empresa_id)) then
    raise exception 'Sin permiso sobre esta operación';
  end if;
  if p_nuevo_estado not in ('borrador','pendiente','planificada','asignada','en_proceso','pausada','completada','cancelada','no_realizada','anulada') then
    raise exception 'Estado no válido';
  end if;

  if p_nuevo_estado = 'completada'
     and exists (select 1 from tc_cat_tipos_operacion c where c.codigo = o.tipo_operacion and c.es_fisica and c.activo) then
    raise exception 'EJECUCION_REQUERIDA: una operación física no se completa a mano. Registra la ejecución real (montaje, desmontaje, sustitución…) desde la ficha del vehículo o la APK: la operación prevista quedará vinculada y cerrada sola.';
  end if;

  update operaciones_neumaticos set
    status = p_nuevo_estado,
    tecnico_id = coalesce(p_tecnico, tecnico_id),
    assigned_by = case when p_nuevo_estado = 'asignada' then auth.uid() else assigned_by end,
    started_at = case when p_nuevo_estado = 'en_proceso' and started_at is null then now() else started_at end,
    completed_at = case when p_nuevo_estado = 'completada' then now() else completed_at end,
    cancelled_at = case when p_nuevo_estado in ('cancelada','no_realizada') then now() else cancelled_at end,
    observaciones = case when p_motivo is null then observaciones else coalesce(observaciones,'') || ' · ' || p_motivo end,
    updated_at = now()
  where id = p_operacion;

  -- al cerrar la operación se consumen/liberan sus reservas activas
  if p_nuevo_estado = 'completada' then
    update tc_reservas_neumatico set status = 'consumida', liberado_at = now(), liberado_por = auth.uid()
      where operacion_id = p_operacion and status = 'activa';
  elsif p_nuevo_estado in ('cancelada','no_realizada','anulada') then
    update tc_reservas_neumatico set status = 'liberada', liberado_at = now(), liberado_por = auth.uid(), motivo_liberacion = coalesce(p_motivo,'operación '||p_nuevo_estado)
      where operacion_id = p_operacion and status = 'activa';
  end if;
end $$;

-- ── 5. La red de seguridad solo envuelve trabajo HECHO ──────────────────────
--
-- Misma función que la fase 1 (cerrojo + skip locked + cerrada_at heredada)
-- con un único añadido: status = 'completada'. Una prevista sin ejecutar o
-- una cancelada no son una sesión de trabajo y no deben salir en el
-- histórico como si lo fueran.
create or replace function tc_agrupar_operaciones_sueltas(p_minutos int default 30)
returns int language plpgsql security definer set search_path = public as $$
declare r record; v_interv uuid; n int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('tc_agrupar_operaciones_sueltas')) then
    return 0;
  end if;

  for r in
    select id, empresa_id, vehiculo_id, tecnico_id, fecha_operacion, tipo_operacion,
           neumatico_id, created_at
      from operaciones_neumaticos
     where intervencion_id is null
       and status = 'completada'
       and created_at < now() - make_interval(mins => p_minutos)
     order by created_at, id
       for update skip locked
  loop
    insert into tc_intervenciones (
      empresa_id, vehiculo_id, fecha, tecnico_id, resumen, n_operaciones,
      tipo_principal, n_neumaticos, created_at, cerrada_at)
    values (
      r.empresa_id, r.vehiculo_id, r.fecha_operacion, r.tecnico_id,
      initcap(replace(r.tipo_operacion, '_', ' ')),
      1, r.tipo_operacion, case when r.neumatico_id is null then null else 1 end,
      r.created_at, r.created_at)
    returning id into v_interv;

    update operaciones_neumaticos set intervencion_id = v_interv where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

grant execute on function tc_agrupar_operaciones_sueltas(int) to authenticated;

-- ── 6. Auto-test (rollback al final: no persiste nada) ──────────────────────
--
-- Los RPC con permisos no se pueden llamar desde el SQL Editor (auth.uid()
-- nulo), así que aquí se prueba la mecánica pura: el trigger de herencia con
-- el ajuste puesto, el cierre directo del plan y el filtro de la red de
-- seguridad. El despachador completo se prueba en local con esquema
-- replicado y stubs de permisos (ver el commit de la fase 2).
do $$
declare v_emp uuid; v_prev uuid; v_ej uuid; v_int uuid; n int; v_row record;
begin
  begin
    insert into tc_empresas (nombre) values ('TEST fase2 vinculo (rollback)') returning id into v_emp;

    -- Prevista con prioridad alta y fecha; la ejecutada no trae ni motivo ni
    -- prioridad: debe heredarlos y quedar vinculada.
    insert into operaciones_neumaticos (empresa_id, tipo_operacion, status, prioridad, fecha_prevista, motivo)
    values (v_emp, 'sustitucion', 'planificada', 'urgente', current_date + 7, 'desgaste')
    returning id into v_prev;

    perform set_config('tc.prevista', v_prev::text, true);
    insert into operaciones_neumaticos (empresa_id, tipo_operacion)
    values (v_emp, 'sustitucion') returning id into v_ej;
    perform set_config('tc.prevista', '', true);

    select * into v_row from operaciones_neumaticos where id = v_ej;
    if v_row.operacion_prevista_id is distinct from v_prev then
      raise exception 'FALLO: la ejecutada no ha quedado vinculada a la prevista';
    end if;
    if v_row.prioridad <> 'urgente' or v_row.motivo <> 'desgaste' or v_row.fecha_prevista is null then
      raise exception 'FALLO: la ejecutada no ha heredado prioridad/motivo/fecha del plan';
    end if;

    -- Sin el ajuste puesto, un insert normal NO se vincula.
    insert into operaciones_neumaticos (empresa_id, tipo_operacion)
    values (v_emp, 'montaje') returning id into v_ej;
    if (select operacion_prevista_id from operaciones_neumaticos where id = v_ej) is not null then
      raise exception 'FALLO: un insert sin contexto ha quedado vinculado';
    end if;

    -- El plan se cierra directo a completada (transición que fase 1 permite).
    update operaciones_neumaticos set status = 'completada', completed_at = now() where id = v_prev;

    -- La red de seguridad ignora previstas: una planificada vieja y suelta
    -- NO debe envolverse.
    insert into operaciones_neumaticos (empresa_id, tipo_operacion, status, created_at)
    values (v_emp, 'montaje', 'planificada', now() - interval '2 hours');
    select tc_agrupar_operaciones_sueltas(0) into n;
    if exists (
      select 1 from operaciones_neumaticos
       where empresa_id = v_emp and status = 'planificada' and intervencion_id is not null
    ) then
      raise exception 'FALLO: la red de seguridad ha envuelto una prevista sin ejecutar';
    end if;

    raise exception 'TC_TEST_ROLLBACK';
  exception when others then
    if sqlerrm <> 'TC_TEST_ROLLBACK' then raise; end if;
  end;
  raise notice 'Auto-test del vínculo prevista→ejecutada: OK (todo revertido)';
end $$;

-- ── 7. Comprobación ─────────────────────────────────────────────────────────
do $$
declare n int;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_name = 'operaciones_neumaticos' and column_name = 'operacion_prevista_id'
  ) then
    raise exception 'Falta operaciones_neumaticos.operacion_prevista_id';
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_op_hereda_prevista') then
    raise exception 'Falta el trigger trg_op_hereda_prevista';
  end if;

  select count(*) into n from pg_proc where proname = 'tc_ejecutar_prevista';
  if n <> 1 then raise exception 'Hay % versiones de tc_ejecutar_prevista (se esperaba 1)', n; end if;

  -- El despachador tiene que cubrir los catorce RPC de ejecución.
  select count(*) into n from pg_proc
   where proname = 'tc_ejecutar_prevista'
     and prosrc like '%tc_montar_desde_almacen%' and prosrc like '%tc_montar_desde_catalogo%'
     and prosrc like '%tc_montar_fuera_almacen%' and prosrc like '%tc_desmontar_neumatico%'
     and prosrc like '%tc_sustituir_neumatico%' and prosrc like '%tc_cambiar_posicion%'
     and prosrc like '%tc_intercambiar_posiciones%' and prosrc like '%tc_corregir_posicion%'
     and prosrc like '%tc_corregir_montado%' and prosrc like '%tc_registrar_reparacion%'
     and prosrc like '%tc_descartar_neumatico%' and prosrc like '%tc_regularizar_desmontaje%'
     and prosrc like '%tc_aplicar_plan_trabajo%' and prosrc like '%tc_permutar_plan%';
  if n <> 1 then raise exception 'tc_ejecutar_prevista no cubre los catorce RPC de ejecución'; end if;

  -- Completada a mano bloqueada para lo físico.
  select count(*) into n from pg_proc
   where proname = 'tc_cambiar_estado_operacion' and prosrc like '%EJECUCION_REQUERIDA%';
  if n <> 1 then raise exception 'tc_cambiar_estado_operacion no bloquea completar a mano lo físico'; end if;

  -- La red de seguridad conserva cerrojo + cerrada_at y gana el filtro.
  select count(*) into n from pg_proc
   where proname = 'tc_agrupar_operaciones_sueltas'
     and prosrc like '%pg_try_advisory_xact_lock%' and prosrc like '%cerrada_at%'
     and prosrc like '%status = ''completada''%';
  if n <> 1 then raise exception 'tc_agrupar_operaciones_sueltas ha perdido el cerrojo, cerrada_at o el filtro de status'; end if;

  raise notice 'OK: vinculo prevista→ejecutada instalado (columna, trigger, despachador, completar restringido, red de seguridad filtrada)';
end $$;
