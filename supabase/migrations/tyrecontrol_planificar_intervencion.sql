-- ============================================================
-- Mobilink TyreControl — Planificación de intervenciones (panel) y
-- convergencia plan → sesión en la APK.
--
-- Fase 4 del rediseño de Intervenciones y Operaciones
-- (docs/ANALISIS_FASE0_intervenciones_operaciones.md, §D.3 fase 4 y §4.1).
-- Requiere: fases 1, 2 y 3.
--
-- QUÉ AÑADE
--
-- 1) tc_planificar_intervencion: crea desde el panel una intervención
--    PLANIFICADA (abierta, sin inicio_at y sin número de parte) con sus N
--    operaciones previstas dentro — reutilizando tc_planificar_operacion con
--    el contexto de transacción de la fase 3, así cada prevista nace ya con
--    su intervencion_id. Reservas opcionales por operación, como siempre.
--
-- 2) tc_iniciar_intervencion aprende a RECOGER el plan: si al abrir el
--    vehículo no hay sesión del técnico pero sí una intervención planificada
--    sin empezar, esa se convierte en la sesión (se sella inicio_at y el
--    técnico real sustituye al asignado — las operaciones registran de todas
--    formas quién hizo cada cosa). Es la pieza que cierra el círculo:
--    1 necesidad = 1 intervención planificada = 1 sesión = 1 parte.
--
-- 3) tc_cancelar_intervencion: cancela lo previsto que quede vivo (liberando
--    reservas, vía tc_cambiar_estado_operacion) y cierra la intervención SIN
--    número. Con una operación en_proceso no deja: primero se pausa o
--    se termina.
--
-- 4) tc_intervenciones.observaciones (columna nueva): lo que el que
--    planifica quiere que lea el que ejecuta.
--
-- ESTADOS VISIBLES de una intervención (derivados, sin columna nueva):
--   · planificada: cerrada_at IS NULL y inicio_at IS NULL
--   · en curso:    cerrada_at IS NULL y inicio_at NO nulo
--   · cerrada:     cerrada_at NO nulo
--
-- OJO: el unique parcial de la fase 1 (una abierta por vehículo+técnico)
-- también limita la planificación: no puede haber dos intervenciones
-- abiertas del mismo vehículo asignadas al mismo técnico. Es deliberado
-- (la segunda visita se planifica cuando la primera se cierra); el error
-- se traduce a un mensaje claro.
--
-- Idempotente: reejecutable sin efectos secundarios.
-- ============================================================

-- ── 1. Observaciones del plan ───────────────────────────────────────────────
alter table tc_intervenciones add column if not exists observaciones text;

-- ── 2. Planificar una intervención con sus operaciones previstas ────────────
create or replace function tc_planificar_intervencion(
  p_empresa uuid,
  p_vehiculo uuid,
  p_fecha_prevista date default null,
  p_tecnico uuid default null,
  p_prioridad text default 'normal',
  p_obs text default null,
  p_operaciones jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_veh record; v_int uuid; v_op jsonb; n int := 0;
begin
  if not (tc_is_superadmin() or (tc_is_admin() and p_empresa = tc_auth_empresa_id()) or tc_operador_ve_empresa(p_empresa)) then
    raise exception 'Sin permiso para planificar intervenciones en esta empresa';
  end if;
  select * into v_veh from tc_vehiculos where id = p_vehiculo;
  if not found then raise exception 'Vehículo no encontrado'; end if;
  if v_veh.empresa_id <> p_empresa then raise exception 'El vehículo no pertenece a esa empresa'; end if;

  begin
    -- Planificada: abierta (cerrada_at null), sin empezar (inicio_at null) y
    -- SIN número — el número de parte se asigna al cerrar, como en la fase 1.
    insert into tc_intervenciones (empresa_id, vehiculo_id, fecha, tecnico_id, observaciones,
                                   n_operaciones, inicio_at, numero, cerrada_at)
    values (p_empresa, p_vehiculo, coalesce(p_fecha_prevista, current_date), p_tecnico, p_obs,
            0, null, null, null)
    returning id into v_int;
  exception when unique_violation then
    raise exception 'Ya hay una intervención abierta o planificada de ese vehículo para ese técnico; ciérrala o cancélala antes de planificar otra';
  end;

  -- Las previstas nacen DENTRO de la intervención: mismo contexto de
  -- transacción que usa la ejecución (trigger trg_op_hereda_intervencion).
  perform set_config('tc.intervencion', v_int::text, true);
  for v_op in select * from jsonb_array_elements(coalesce(p_operaciones, '[]'::jsonb)) loop
    perform tc_planificar_operacion(
      p_empresa,
      v_op->>'tipo',
      p_vehiculo,
      (v_op->>'neumatico')::uuid,
      (v_op->>'posicion_destino')::uuid,
      p_fecha_prevista,
      coalesce(v_op->>'prioridad', p_prioridad),
      v_op->>'motivo',
      p_tecnico,
      v_op->>'obs',
      coalesce((v_op->>'reservar')::boolean, false)
    );
    n := n + 1;
  end loop;
  perform set_config('tc.intervencion', '', true);

  update tc_intervenciones set n_operaciones = n where id = v_int;
  return jsonb_build_object('id', v_int, 'n_operaciones', n);
end $$;

comment on function tc_planificar_intervencion(uuid, uuid, date, uuid, text, text, jsonb) is
  'Crea una intervención planificada (abierta, sin inicio ni número) con sus '
  'operaciones previstas dentro, vía tc_planificar_operacion + contexto. '
  'p_operaciones: [{tipo, neumatico?, posicion_destino?, prioridad?, motivo?, obs?, reservar?}].';

grant execute on function tc_planificar_intervencion(uuid, uuid, date, uuid, text, text, jsonb) to authenticated;

-- ── 3. Iniciar: la sesión recoge el plan si lo hay ──────────────────────────
create or replace function tc_iniciar_intervencion(p_vehiculo uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_veh record; v_id uuid; v_numero text; v_plan boolean := false;
begin
  select * into v_veh from tc_vehiculos where id = p_vehiculo;
  if not found then raise exception 'Vehículo no encontrado'; end if;
  if not (tc_is_superadmin() or (tc_is_admin() and v_veh.empresa_id = tc_auth_empresa_id()) or tc_operador_ve_empresa(v_veh.empresa_id)) then
    raise exception 'Sin permiso para iniciar una intervención en esta empresa';
  end if;

  perform pg_advisory_xact_lock(hashtext('tc_iniciar_intervencion'), hashtext(p_vehiculo::text));

  -- 1º: mi sesión abierta de este vehículo (puede ser un plan asignado a mí:
  -- entonces también hay que sellarle el inicio).
  select id, numero, (inicio_at is null) into v_id, v_numero, v_plan
    from tc_intervenciones
   where vehiculo_id = p_vehiculo and tecnico_id = auth.uid() and cerrada_at is null
   order by created_at desc limit 1;

  -- 2º: una intervención PLANIFICADA del vehículo aún sin empezar (fase 4).
  -- El plan se convierte en la sesión de quien de verdad lo hace: el técnico
  -- real sustituye al asignado (cada operación registra igualmente quién la
  -- hizo).
  if v_id is null then
    select id, numero into v_id, v_numero
      from tc_intervenciones
     where vehiculo_id = p_vehiculo and cerrada_at is null and inicio_at is null
     order by fecha, created_at limit 1;
    v_plan := v_id is not null;
  end if;

  if v_id is not null then
    -- Empezar a trabajar sella el inicio (si aún no lo tenía) y fija al
    -- técnico real. Para una sesión ya en curso es un no-op.
    update tc_intervenciones
       set inicio_at = coalesce(inicio_at, now()), tecnico_id = auth.uid()
     where id = v_id;
    return jsonb_build_object('id', v_id, 'numero', v_numero, 'existente', true,
                              'planificada', coalesce(v_plan, false));
  end if;

  begin
    -- numero => null a propósito: el número de parte se asigna al CERRAR,
    -- para que una sesión abandonada no queme un número de la serie.
    insert into tc_intervenciones (empresa_id, vehiculo_id, fecha, tecnico_id,
                                   n_operaciones, inicio_at, numero, cerrada_at)
    values (v_veh.empresa_id, p_vehiculo, current_date, auth.uid(), 0, now(), null, null)
    returning id, numero into v_id, v_numero;
  exception when unique_violation then
    select id, numero into v_id, v_numero
      from tc_intervenciones
     where vehiculo_id = p_vehiculo and tecnico_id = auth.uid() and cerrada_at is null
     limit 1;
    return jsonb_build_object('id', v_id, 'numero', v_numero, 'existente', true, 'planificada', false);
  end;

  return jsonb_build_object('id', v_id, 'numero', v_numero, 'existente', false, 'planificada', false);
end $$;

comment on function tc_iniciar_intervencion(uuid) is
  'Crea (o devuelve) la intervención de la sesión de trabajo. Si el vehículo '
  'tiene una intervención planificada sin empezar, la recoge: el plan pasa a '
  'ser la sesión. cerrada_at null = abierta; sin número hasta el cierre.';

grant execute on function tc_iniciar_intervencion(uuid) to authenticated;

-- ── 4. Cancelar una intervención planificada ────────────────────────────────
create or replace function tc_cancelar_intervencion(p_intervencion uuid, p_motivo text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare i record; r record; n int := 0;
begin
  select * into i from tc_intervenciones where id = p_intervencion for update;
  if not found then raise exception 'Intervención no encontrada'; end if;
  if not (tc_is_superadmin() or (tc_is_admin() and i.empresa_id = tc_auth_empresa_id()) or tc_operador_ve_empresa(i.empresa_id)) then
    raise exception 'Sin permiso sobre esta intervención';
  end if;
  if i.cerrada_at is not null then raise exception 'La intervención ya está cerrada'; end if;
  if exists (select 1 from operaciones_neumaticos
              where intervencion_id = p_intervencion and status = 'en_proceso' and not is_anulada) then
    raise exception 'Hay una operación en proceso: páusala o complétala antes de cancelar la intervención';
  end if;

  -- Las previstas vivas se cancelan por el RPC de siempre: libera reservas,
  -- apunta historial y respeta el grafo de transiciones.
  for r in select id from operaciones_neumaticos
            where intervencion_id = p_intervencion
              and status in ('borrador','pendiente','planificada','asignada','pausada')
              and not is_anulada
  loop
    perform tc_cambiar_estado_operacion(r.id, 'cancelada', null, coalesce(p_motivo, 'intervención cancelada'));
    n := n + 1;
  end loop;

  -- Cerrada SIN número: una intervención cancelada no es un parte de trabajo.
  update tc_intervenciones
     set cerrada_at = now(),
         observaciones = case when p_motivo is null then observaciones
                              else coalesce(observaciones,'') || ' · cancelada: ' || p_motivo end
   where id = p_intervencion;

  return jsonb_build_object('id', p_intervencion, 'operaciones_canceladas', n);
end $$;

grant execute on function tc_cancelar_intervencion(uuid, text) to authenticated;

-- ── 5. Auto-test (rollback al final: no persiste nada) ──────────────────────
--
-- Los RPC con permisos no se pueden llamar desde el SQL Editor (auth.uid()
-- nulo): aquí se prueba la mecánica de datos. El flujo completo (planificar
-- con operaciones y reservas, recogida del plan por iniciar, cancelación)
-- está probado en local con esquema replicado y stubs de permisos.
do $$
declare v_emp uuid; v_int uuid; v_op uuid;
begin
  begin
    insert into tc_empresas (nombre) values ('TEST fase4 planificar (rollback)') returning id into v_emp;

    -- Una intervención PLANIFICADA es legal: abierta, sin inicio y sin número.
    insert into tc_intervenciones (empresa_id, fecha, observaciones, inicio_at, numero, cerrada_at)
    values (v_emp, current_date + 7, 'obs del plan', null, null, null)
    returning id into v_int;

    -- Sus previstas nacen dentro vía contexto (mismo mecanismo que ejecutar).
    perform set_config('tc.intervencion', v_int::text, true);
    insert into operaciones_neumaticos (empresa_id, tipo_operacion, status, fecha_prevista)
    values (v_emp, 'sustitucion', 'planificada', current_date + 7) returning id into v_op;
    perform set_config('tc.intervencion', '', true);

    if (select intervencion_id from operaciones_neumaticos where id = v_op) is distinct from v_int then
      raise exception 'FALLO: la prevista no ha nacido dentro de la intervención planificada';
    end if;

    -- La cancelación de la prevista es transición legal (planificada→cancelada).
    update operaciones_neumaticos set status = 'cancelada' where id = v_op;
    -- Y el cierre sin número también.
    update tc_intervenciones set cerrada_at = now() where id = v_int;
    if (select numero from tc_intervenciones where id = v_int) is not null then
      raise exception 'FALLO: una intervención cancelada no debe tener número';
    end if;

    raise exception 'TC_TEST_ROLLBACK';
  exception when others then
    if sqlerrm <> 'TC_TEST_ROLLBACK' then raise; end if;
  end;
  raise notice 'Auto-test de planificación de intervenciones: OK (todo revertido)';
end $$;

-- ── 6. Comprobación ─────────────────────────────────────────────────────────
do $$
declare n int;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_name = 'tc_intervenciones' and column_name = 'observaciones'
  ) then
    raise exception 'Falta tc_intervenciones.observaciones';
  end if;

  select count(*) into n from pg_proc where proname = 'tc_planificar_intervencion';
  if n <> 1 then raise exception 'Hay % versiones de tc_planificar_intervencion (se esperaba 1)', n; end if;
  select count(*) into n from pg_proc where proname = 'tc_cancelar_intervencion';
  if n <> 1 then raise exception 'Hay % versiones de tc_cancelar_intervencion (se esperaba 1)', n; end if;

  -- planificar usa el contexto de intervención y el RPC de planificar de siempre.
  select count(*) into n from pg_proc
   where proname = 'tc_planificar_intervencion'
     and prosrc like '%tc.intervencion%' and prosrc like '%tc_planificar_operacion%';
  if n <> 1 then raise exception 'tc_planificar_intervencion no usa contexto + tc_planificar_operacion'; end if;

  -- iniciar sabe recoger un plan sin empezar.
  select count(*) into n from pg_proc
   where proname = 'tc_iniciar_intervencion' and prosrc like '%inicio_at is null%';
  if n <> 1 then raise exception 'tc_iniciar_intervencion no recoge intervenciones planificadas'; end if;

  -- cancelar reutiliza tc_cambiar_estado_operacion (reservas + historial).
  select count(*) into n from pg_proc
   where proname = 'tc_cancelar_intervencion' and prosrc like '%tc_cambiar_estado_operacion%';
  if n <> 1 then raise exception 'tc_cancelar_intervencion no cancela las previstas por el RPC de estados'; end if;

  raise notice 'OK: planificacion de intervenciones instalada (planificar, recogida del plan, cancelar, observaciones)';
end $$;
