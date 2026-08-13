-- ============================================================
-- Mobilink TyreControl — Intervención ACTIVA: cada operación nace sabiendo
-- a qué sesión de trabajo pertenece.
--
-- Fase 3 del rediseño de Intervenciones y Operaciones
-- (docs/ANALISIS_FASE0_intervenciones_operaciones.md, §D.4).
-- Requiere: fase 1 (tc_iniciar_intervencion, cerrada_at) y fase 2
-- (tc_ejecutar_prevista, trigger de herencia, operacion_prevista_id).
--
-- EL PROBLEMA QUE SE CIERRA
--
-- La "sesión de trabajo" de la APK era un timestamp en memoria: las
-- operaciones nacían huérfanas y el cierre las recogía a posteriori por
-- ventana de tiempo ("las huérfanas de este vehículo desde que abrí la
-- pantalla"). Con la fase 1 la sesión ya existe en BD
-- (tc_iniciar_intervencion); aquí las operaciones pasan a nacer DENTRO de
-- ella.
--
-- CÓMO
--
-- El mismo mecanismo que la fase 2, generalizado:
--
--   · El CASE de despacho a los catorce RPC (que vivía dentro de
--     tc_ejecutar_prevista) se extrae a tc_despachar_ejecucion, para que
--     haya UNA copia. tc_ejecutar_prevista se redefine para usarla — mismo
--     nombre, misma firma, mismo comportamiento.
--     ¡OJO!: si algún día se reejecutara la migración de la fase 2 DESPUÉS
--     de esta, restauraría la versión antigua de tc_ejecutar_prevista y
--     habría que reejecutar esta detrás. Las migraciones se aplican en
--     orden y una sola vez; esto solo importa si se rompe esa regla.
--
--   · tc_ejecutar_en_intervencion(intervencion, rpc, args, prevista?) valida
--     que la intervención existe y está ABIERTA, deja su id en un ajuste
--     local de la transacción y despacha: con prevista delega en
--     tc_ejecutar_prevista (los dos contextos activos a la vez: la fila
--     ejecutada queda vinculada al plan Y a la sesión), sin ella llama al
--     despachador. Un trigger gemelo al de la fase 2 estampa intervencion_id
--     en cada fila insertada. Si la ejecución toca otro vehículo u otra
--     empresa que la sesión, se deshace todo.
--
--   · tc_asignar_numero_intervencion(id): el número de parte se asigna AL
--     CERRAR (fase 1: una sesión abandonada no quema números). Atómico e
--     idempotente: si ya tiene número, lo devuelve sin generar otro. Sin
--     comprobación de permisos, igual que tc_generar_numero_operacion, del
--     que es la variante "sin carreras": lo llama el servidor al cerrar.
--
-- La red de seguridad (tc_agrupar_operaciones_sueltas) NO cambia: sigue
-- recogiendo lo que quede huérfano (APKs viejas, resoluciones de
-- incidencia, caídas). Deja de ser la vía principal.
--
-- Idempotente: reejecutable sin efectos secundarios.
-- ============================================================

-- ── 1. Trigger gemelo: heredar la intervención del contexto ─────────────────
create or replace function tc_op_hereda_intervencion() returns trigger
language plpgsql as $$
declare v_ctx text;
begin
  v_ctx := nullif(current_setting('tc.intervencion', true), '');
  if v_ctx is not null and new.intervencion_id is null then
    new.intervencion_id := v_ctx::uuid;
  end if;
  return new;
end $$;

drop trigger if exists trg_op_hereda_intervencion on operaciones_neumaticos;
create trigger trg_op_hereda_intervencion
  before insert on operaciones_neumaticos
  for each row execute function tc_op_hereda_intervencion();

-- ── 2. El despacho, en un solo sitio ────────────────────────────────────────
create or replace function tc_despachar_ejecucion(p_rpc text, p_args jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_res jsonb := 'null'::jsonb;
begin
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
  return v_res;
end $$;

comment on function tc_despachar_ejecucion(text, jsonb) is
  'Despacho interno a los catorce RPC de ejecución (lista cerrada, sin SQL '
  'dinámico). Lo usan tc_ejecutar_prevista y tc_ejecutar_en_intervencion; no '
  'está pensada para llamarse directamente.';

-- Interna: los envoltorios son la puerta. Llamarla directa no saltaría
-- ningún permiso (cada RPC valida los suyos), pero fuera de la puerta no
-- estampa ni cierra nada y solo generaría confusión. Basta con quitar
-- PUBLIC: nadie tiene grant explícito, así que anon/authenticated la
-- pierden con él.
revoke all on function tc_despachar_ejecucion(text, jsonb) from public;

-- ── 3. tc_ejecutar_prevista pasa a usar el despacho común ───────────────────
-- Misma firma y mismo comportamiento que en la fase 2; solo cambia que el
-- CASE ya no vive aquí dentro.
create or replace function tc_ejecutar_prevista(p_prevista uuid, p_rpc text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o record; r record; v_res jsonb; v_ids uuid[]; v_mal int;
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

  perform set_config('tc.prevista', p_prevista::text, true);
  v_res := tc_despachar_ejecucion(p_rpc, p_args);
  perform set_config('tc.prevista', '', true);

  select array_agg(id) into v_ids
    from operaciones_neumaticos
   where operacion_prevista_id = p_prevista and created_at >= transaction_timestamp();
  if v_ids is null then
    raise exception 'La ejecución no ha registrado ninguna operación; se deshace todo';
  end if;

  if o.vehiculo_id is not null then
    select count(*) into v_mal from operaciones_neumaticos
     where id = any(v_ids) and vehiculo_id is not null and vehiculo_id <> o.vehiculo_id;
    if v_mal > 0 then
      raise exception 'La ejecución toca un vehículo distinto del previsto; se deshace todo';
    end if;
  end if;

  update operaciones_neumaticos
     set status = 'completada', completed_at = now(), updated_at = now()
   where id = p_prevista;

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

grant execute on function tc_ejecutar_prevista(uuid, text, jsonb) to authenticated;

-- ── 4. Ejecutar DENTRO de la intervención activa ────────────────────────────
create or replace function tc_ejecutar_en_intervencion(
  p_intervencion uuid, p_rpc text, p_args jsonb default '{}'::jsonb, p_prevista uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i record; v_res jsonb; v_ids uuid[]; v_mal int;
begin
  select * into i from tc_intervenciones where id = p_intervencion for update;
  if not found then raise exception 'Intervención no encontrada'; end if;
  if not (tc_is_superadmin() or (tc_is_admin() and i.empresa_id = tc_auth_empresa_id()) or tc_operador_ve_empresa(i.empresa_id)) then
    raise exception 'Sin permiso sobre esta intervención';
  end if;
  if i.cerrada_at is not null then
    raise exception 'INTERVENCION_CERRADA: la intervención % ya está cerrada; vuelve a abrir el vehículo para empezar otra', coalesce(i.numero, '');
  end if;

  perform set_config('tc.intervencion', p_intervencion::text, true);

  if p_prevista is not null then
    -- Los dos contextos activos a la vez: la ejecución queda vinculada al
    -- plan (fase 2) Y a la sesión (esta fase), y el plan se cierra.
    v_res := tc_ejecutar_prevista(p_prevista, p_rpc, p_args);
  else
    v_res := jsonb_build_object('resultado', tc_despachar_ejecucion(p_rpc, p_args));
  end if;

  perform set_config('tc.intervencion', '', true);

  select array_agg(id) into v_ids
    from operaciones_neumaticos
   where intervencion_id = p_intervencion and created_at >= transaction_timestamp();
  if v_ids is null then
    raise exception 'La ejecución no ha registrado ninguna operación; se deshace todo';
  end if;

  -- Todo lo insertado tiene que ser de la empresa de la sesión y, si la
  -- sesión tiene vehículo, de ese vehículo.
  select count(*) into v_mal from operaciones_neumaticos
   where id = any(v_ids)
     and (empresa_id <> i.empresa_id
          or (i.vehiculo_id is not null and vehiculo_id is not null and vehiculo_id <> i.vehiculo_id));
  if v_mal > 0 then
    raise exception 'La ejecución toca otro vehículo u otra empresa que la intervención; se deshace todo';
  end if;

  return v_res || jsonb_build_object('intervencion', p_intervencion, 'operaciones_intervencion', to_jsonb(v_ids));
end $$;

comment on function tc_ejecutar_en_intervencion(uuid, text, jsonb, uuid) is
  'Ejecuta un RPC de operación dentro de una intervención ABIERTA: las filas '
  'resultantes nacen con su intervencion_id. Con p_prevista, además vincula y '
  'cierra la operación planificada (fase 2). Atómico.';

grant execute on function tc_ejecutar_en_intervencion(uuid, text, jsonb, uuid) to authenticated;

-- ── 5. Número de parte al cerrar, sin carreras ──────────────────────────────
--
-- La fase 1 dejó las intervenciones iniciadas SIN número (una sesión
-- abandonada no quema números). Al cerrar, el servidor lo pide aquí:
-- atómico (for update) e idempotente (si ya lo tiene, lo devuelve).
-- Sin comprobación de permisos, como tc_generar_numero_operacion: solo
-- asigna un número que faltaba, no toca nada más.
create or replace function tc_asignar_numero_intervencion(p_intervencion uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_num text;
begin
  select numero into v_num from tc_intervenciones where id = p_intervencion for update;
  if not found then raise exception 'Intervención no encontrada'; end if;
  if v_num is null then
    v_num := tc_generar_numero_operacion();
    update tc_intervenciones set numero = v_num where id = p_intervencion;
  end if;
  return v_num;
end $$;

grant execute on function tc_asignar_numero_intervencion(uuid) to authenticated;

-- ── 6. Auto-test (rollback al final: no persiste nada) ──────────────────────
do $$
declare v_emp uuid; v_int uuid; v_prev uuid; v_ej uuid; v_row record; v_num text; v_num2 text;
begin
  begin
    insert into tc_empresas (nombre) values ('TEST fase3 intervencion activa (rollback)') returning id into v_emp;
    insert into tc_intervenciones (empresa_id, inicio_at, numero, cerrada_at)
    values (v_emp, now(), null, null) returning id into v_int;

    -- Con los DOS contextos puestos, un insert hereda plan e intervención.
    insert into operaciones_neumaticos (empresa_id, tipo_operacion, status, prioridad)
    values (v_emp, 'montaje', 'planificada', 'alta') returning id into v_prev;
    perform set_config('tc.intervencion', v_int::text, true);
    perform set_config('tc.prevista', v_prev::text, true);
    insert into operaciones_neumaticos (empresa_id, tipo_operacion)
    values (v_emp, 'montaje') returning id into v_ej;
    perform set_config('tc.intervencion', '', true);
    perform set_config('tc.prevista', '', true);

    select * into v_row from operaciones_neumaticos where id = v_ej;
    if v_row.intervencion_id is distinct from v_int then
      raise exception 'FALLO: la operación no ha heredado la intervención activa';
    end if;
    if v_row.operacion_prevista_id is distinct from v_prev or v_row.prioridad <> 'alta' then
      raise exception 'FALLO: la herencia del plan (fase 2) ha dejado de funcionar';
    end if;

    -- Sin contexto, nada se estampa.
    insert into operaciones_neumaticos (empresa_id, tipo_operacion)
    values (v_emp, 'desmontaje') returning id into v_ej;
    if (select intervencion_id from operaciones_neumaticos where id = v_ej) is not null then
      raise exception 'FALLO: un insert sin contexto ha heredado intervención';
    end if;

    -- El número: se asigna una vez y es estable.
    select tc_asignar_numero_intervencion(v_int) into v_num;
    select tc_asignar_numero_intervencion(v_int) into v_num2;
    if v_num is null or v_num <> v_num2 then
      raise exception 'FALLO: tc_asignar_numero_intervencion no es idempotente (% / %)', v_num, v_num2;
    end if;

    raise exception 'TC_TEST_ROLLBACK';
  exception when others then
    if sqlerrm <> 'TC_TEST_ROLLBACK' then raise; end if;
  end;
  raise notice 'Auto-test de la intervención activa: OK (todo revertido)';
end $$;

-- ── 7. Comprobación ─────────────────────────────────────────────────────────
do $$
declare n int;
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_op_hereda_intervencion') then
    raise exception 'Falta el trigger trg_op_hereda_intervencion';
  end if;

  -- El despacho vive en UN sitio y cubre los catorce RPC.
  select count(*) into n from pg_proc
   where proname = 'tc_despachar_ejecucion'
     and prosrc like '%tc_montar_desde_almacen%' and prosrc like '%tc_montar_desde_catalogo%'
     and prosrc like '%tc_montar_fuera_almacen%' and prosrc like '%tc_desmontar_neumatico%'
     and prosrc like '%tc_sustituir_neumatico%' and prosrc like '%tc_cambiar_posicion%'
     and prosrc like '%tc_intercambiar_posiciones%' and prosrc like '%tc_corregir_posicion%'
     and prosrc like '%tc_corregir_montado%' and prosrc like '%tc_registrar_reparacion%'
     and prosrc like '%tc_descartar_neumatico%' and prosrc like '%tc_regularizar_desmontaje%'
     and prosrc like '%tc_aplicar_plan_trabajo%' and prosrc like '%tc_permutar_plan%';
  if n <> 1 then raise exception 'tc_despachar_ejecucion no cubre los catorce RPC de ejecución'; end if;

  -- Y los dos envoltorios lo usan (ninguno conserva su propio CASE).
  select count(*) into n from pg_proc
   where proname = 'tc_ejecutar_prevista' and prosrc like '%tc_despachar_ejecucion%';
  if n <> 1 then raise exception 'tc_ejecutar_prevista no usa el despacho común'; end if;
  select count(*) into n from pg_proc
   where proname = 'tc_ejecutar_en_intervencion'
     and prosrc like '%tc_despachar_ejecucion%' and prosrc like '%tc_ejecutar_prevista%';
  if n <> 1 then raise exception 'tc_ejecutar_en_intervencion no compone despacho + prevista'; end if;

  -- El despacho es interno: sin execute para authenticated.
  if has_function_privilege('authenticated', 'tc_despachar_ejecucion(text, jsonb)', 'execute') then
    raise exception 'tc_despachar_ejecucion no debería ser llamable por authenticated';
  end if;

  select count(*) into n from pg_proc where proname = 'tc_asignar_numero_intervencion';
  if n <> 1 then raise exception 'Hay % versiones de tc_asignar_numero_intervencion (se esperaba 1)', n; end if;

  raise notice 'OK: intervencion activa instalada (trigger, despacho comun, tc_ejecutar_en_intervencion, numero al cerrar)';
end $$;
