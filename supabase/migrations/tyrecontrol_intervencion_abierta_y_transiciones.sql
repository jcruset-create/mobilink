-- ============================================================
-- Mobilink TyreControl — Intervenciones: abierta/cerrada + inicio en BD +
-- grafo de estados de operación en la base de datos.
--
-- Fase 1 del rediseño de Intervenciones y Operaciones
-- (docs/ANALISIS_FASE0_intervenciones_operaciones.md, §D.1 fase 1).
--
-- QUÉ ARREGLA
--
-- 1) Hoy una intervención solo existe cuando ya ha terminado: la crea el
--    endpoint de cierre o la red de seguridad. "Estar trabajando en un
--    vehículo" es un timestamp en memoria de la APK. Se añade `cerrada_at`
--    (null = abierta) y `tc_iniciar_intervencion`, que crea la sesión en BD
--    al empezar. Idempotente por vehículo+técnico: volver a llamar devuelve
--    la abierta, que es lo que permite añadir operaciones a la sesión activa
--    sin crear otra.
--
-- 2) El grafo de transiciones de estado vivía solo en el frontend
--    (Operaciones.tsx): por RPC se podía pasar de `completada` a `pendiente`.
--    Se instala como trigger, no solo en el RPC, porque un admin puede hacer
--    UPDATE por tabla (policy op_neu_update) y la regla debe cumplirse igual.
--
-- DECISIONES QUE CONVIENE CONOCER
--
-- · `cerrada_at` tiene DEFAULT now(): todo camino que no conozca la columna
--   (el endpoint de cierre actual, la red de seguridad, un insert a mano)
--   crea intervenciones CERRADAS, como hasta ahora. "Abierta" es opt-in y
--   solo lo hace tc_iniciar_intervencion. Ninguna fila histórica queda
--   abierta: el backfill cierra con coalesce(fin_at, created_at).
--
-- · tc_iniciar_intervencion NO asigna número de parte (numero => null,
--   pisando el default): la serie OP-AAAA-NNNNNN significa "trabajos que
--   ocurrieron" (ver tyrecontrol_numero_operacion.sql) y una sesión abierta y
--   abandonada no debe quemar un número. El número se asigna al cerrar
--   (fase 2/3 cablea el cierre por id).
--
-- · El trigger de transiciones: los estados finales (`completada`,
--   `cancelada`, `no_realizada`, `anulada`) solo admiten pasar a `anulada`
--   (lo usan tc_anular_operacion y tc_deshacer_ultima_operacion). Desde un
--   estado activo se puede llegar a `completada` directamente (así cerrará
--   la fase 2 una prevista al vincularla con su ejecución) y el resto sigue
--   el grafo que ya ofrecía el panel. Los INSERT no se validan: el default
--   'completada' (registrar después de hecho) sigue siendo la norma.
--
-- · tc_agrupar_operaciones_sueltas se redefine solo para sellar `cerrada_at`
--   con la fecha heredada de la operación (una suelta de julio no se "cierra"
--   hoy). El filtro por status (que hoy también envuelve previstas sin
--   ejecutar, §A.4 del análisis) es de la fase 2, aquí no se toca.
--
-- Idempotente: reejecutable sin efectos secundarios.
-- ============================================================

-- ── 1. cerrada_at: null = abierta ───────────────────────────────────────────
--
-- Columna y backfill en el mismo guard: el backfill solo puede correr la
-- primera vez. Si corriera en cada reejecución, cerraría las intervenciones
-- legítimamente abiertas por tc_iniciar_intervencion.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_name = 'tc_intervenciones' and column_name = 'cerrada_at'
  ) then
    alter table tc_intervenciones add column cerrada_at timestamptz;
    -- Todo lo histórico nació ya cerrado: la mejor marca es el fin real y,
    -- si no lo hay (agrupadas por la red de seguridad), su created_at.
    update tc_intervenciones set cerrada_at = coalesce(fin_at, created_at);
  end if;
end $$;

alter table tc_intervenciones alter column cerrada_at set default now();

-- Buscar "la abierta de este vehículo y técnico" será la consulta caliente de
-- la APK. El unique parcial además garantiza que no puede haber dos abiertas
-- del mismo técnico sobre el mismo vehículo, pase lo que pase con las carreras.
create index if not exists idx_interv_abierta
  on tc_intervenciones (vehiculo_id) where cerrada_at is null;
create unique index if not exists uq_interv_abierta_veh_tecnico
  on tc_intervenciones (vehiculo_id, tecnico_id) where cerrada_at is null;

-- ── 2. Iniciar una intervención (la sesión pasa a existir en BD) ────────────
create or replace function tc_iniciar_intervencion(p_vehiculo uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_veh record; v_id uuid; v_numero text;
begin
  select * into v_veh from tc_vehiculos where id = p_vehiculo;
  if not found then raise exception 'Vehículo no encontrado'; end if;
  if not (tc_is_superadmin() or (tc_is_admin() and v_veh.empresa_id = tc_auth_empresa_id()) or tc_operador_ve_empresa(v_veh.empresa_id)) then
    raise exception 'Sin permiso para iniciar una intervención en esta empresa';
  end if;

  -- Cerrojo por vehículo: dos llamadas simultáneas (doble toque, dos
  -- pantallas) se serializan y la segunda encuentra la fila de la primera.
  perform pg_advisory_xact_lock(hashtext('tc_iniciar_intervencion'), hashtext(p_vehiculo::text));

  select id, numero into v_id, v_numero
    from tc_intervenciones
   where vehiculo_id = p_vehiculo and tecnico_id = auth.uid() and cerrada_at is null
   order by created_at desc limit 1;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'numero', v_numero, 'existente', true);
  end if;

  begin
    -- numero => null a propósito: el número de parte se asigna al CERRAR,
    -- para que una sesión abandonada no queme un número de la serie.
    insert into tc_intervenciones (empresa_id, vehiculo_id, fecha, tecnico_id,
                                   n_operaciones, inicio_at, numero, cerrada_at)
    values (v_veh.empresa_id, p_vehiculo, current_date, auth.uid(), 0, now(), null, null)
    returning id, numero into v_id, v_numero;
  exception when unique_violation then
    -- Carrera que el cerrojo no cubrió (p. ej. otra vía de insert): la
    -- abierta que ya existe ES la sesión.
    select id, numero into v_id, v_numero
      from tc_intervenciones
     where vehiculo_id = p_vehiculo and tecnico_id = auth.uid() and cerrada_at is null
     limit 1;
    return jsonb_build_object('id', v_id, 'numero', v_numero, 'existente', true);
  end;

  return jsonb_build_object('id', v_id, 'numero', v_numero, 'existente', false);
end $$;

comment on function tc_iniciar_intervencion(uuid) is
  'Crea (o devuelve, si ya hay una abierta del mismo técnico y vehículo) la '
  'intervención de la sesión de trabajo. cerrada_at null = abierta. Sin número '
  'de parte hasta el cierre.';

grant execute on function tc_iniciar_intervencion(uuid) to authenticated;

-- ── 3. La red de seguridad sella cerrada_at ─────────────────────────────────
--
-- Misma función que tyrecontrol_agrupar_sueltas_concurrencia.sql (cerrojo +
-- skip locked), con un único cambio: la intervención-envoltorio nace cerrada
-- con la fecha heredada de la operación, no con el now() del default.
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
      -- Hereda la fecha de la operación (una suelta de julio no es de hoy),
      -- y queda cerrada con esa misma marca: nunca fue una sesión abierta.
      r.created_at, r.created_at)
    returning id into v_interv;

    update operaciones_neumaticos set intervencion_id = v_interv where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

grant execute on function tc_agrupar_operaciones_sueltas(int) to authenticated;

-- ── 4. El grafo de estados, en la base de datos ─────────────────────────────
--
-- Reglas (por este orden):
--   · → anulada: siempre (anular es la única salida de un estado final).
--   · desde un estado final (completada/cancelada/no_realizada/anulada):
--     nada más. Aquí muere el "completada → pendiente".
--   · estado activo → completada: siempre (la ejecución puede cerrar una
--     prevista sin recorrer asignada/en_proceso; lo usará la fase 2).
--   · resto: el grafo que el panel ya ofrecía en ACCIONES_ESTADO, más la
--     salida de borrador (estado válido que hoy no usa nadie) y
--     no_realizada como cierre alternativo allí donde cabía cancelada.
create or replace function tc_op_valida_transicion() returns trigger
language plpgsql as $$
declare permitidas text[];
begin
  if new.status = 'anulada' then return new; end if;

  if old.status in ('completada','cancelada','no_realizada','anulada') then
    raise exception 'TRANSICION_ILEGAL: una operación % no puede pasar a %', old.status, new.status
      using hint = 'Los estados finales solo admiten anulación (tc_anular_operacion).';
  end if;

  if new.status = 'completada' then return new; end if;

  permitidas := case old.status
    when 'borrador'    then array['pendiente','planificada','cancelada','no_realizada']
    when 'pendiente'   then array['planificada','asignada','cancelada','no_realizada']
    when 'planificada' then array['asignada','cancelada','no_realizada']
    when 'asignada'    then array['en_proceso','cancelada','no_realizada']
    when 'en_proceso'  then array['pausada']
    when 'pausada'     then array['en_proceso','cancelada','no_realizada']
    else array[]::text[]
  end;

  if new.status <> all (permitidas) then
    raise exception 'TRANSICION_ILEGAL: de % no se puede pasar a %', old.status, new.status;
  end if;
  return new;
end $$;

drop trigger if exists trg_op_valida_transicion on operaciones_neumaticos;
create trigger trg_op_valida_transicion
  before update of status on operaciones_neumaticos
  for each row when (old.status is distinct from new.status)
  execute function tc_op_valida_transicion();

-- ── 5. Auto-test (se deshace solo: termina en rollback) ─────────────────────
--
-- Prueba el trigger con datos reales dentro de una subtransacción que se
-- revienta al final con un sentinel: no persiste nada, ni empresa ni
-- operaciones ni historial.
do $$
declare v_emp uuid; v_op uuid; v_int uuid;
begin
  begin
    insert into tc_empresas (nombre) values ('TEST fase1 intervenciones (rollback)') returning id into v_emp;

    -- Cadena legal completa: pendiente → asignada → en_proceso → pausada →
    -- en_proceso → completada → anulada.
    insert into operaciones_neumaticos (empresa_id, tipo_operacion, status)
    values (v_emp, 'montaje', 'pendiente') returning id into v_op;
    update operaciones_neumaticos set status = 'asignada'   where id = v_op;
    update operaciones_neumaticos set status = 'en_proceso' where id = v_op;
    update operaciones_neumaticos set status = 'pausada'    where id = v_op;
    update operaciones_neumaticos set status = 'en_proceso' where id = v_op;
    update operaciones_neumaticos set status = 'completada' where id = v_op;

    -- Ilegal: completada → pendiente (el caso que motivó todo esto).
    begin
      update operaciones_neumaticos set status = 'pendiente' where id = v_op;
      raise exception 'FALLO: se ha permitido completada → pendiente';
    exception when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      if sqlerrm not like 'TRANSICION_ILEGAL%' then raise; end if;
    end;

    -- Legal: anular una completada (lo hace tc_anular_operacion).
    update operaciones_neumaticos set status = 'anulada', is_anulada = true where id = v_op;

    -- Ilegal: resucitar una anulada.
    begin
      update operaciones_neumaticos set status = 'completada' where id = v_op;
      raise exception 'FALLO: se ha permitido anulada → completada';
    exception when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      if sqlerrm not like 'TRANSICION_ILEGAL%' then raise; end if;
    end;

    -- Legal: una prevista se cierra directa a completada (vínculo, fase 2).
    insert into operaciones_neumaticos (empresa_id, tipo_operacion, status)
    values (v_emp, 'sustitucion', 'planificada') returning id into v_op;
    update operaciones_neumaticos set status = 'completada' where id = v_op;

    -- Ilegal: saltarse la asignación (planificada → en_proceso).
    insert into operaciones_neumaticos (empresa_id, tipo_operacion, status)
    values (v_emp, 'desmontaje', 'planificada') returning id into v_op;
    begin
      update operaciones_neumaticos set status = 'en_proceso' where id = v_op;
      raise exception 'FALLO: se ha permitido planificada → en_proceso';
    exception when others then
      if sqlerrm like 'FALLO:%' then raise; end if;
      if sqlerrm not like 'TRANSICION_ILEGAL%' then raise; end if;
    end;

    -- Una intervención insertada por un camino que no conoce cerrada_at
    -- (cierre actual, red de seguridad) nace CERRADA por el default.
    insert into tc_intervenciones (empresa_id) values (v_emp) returning id into v_int;
    if (select cerrada_at from tc_intervenciones where id = v_int) is null then
      raise exception 'FALLO: una intervención insertada sin cerrada_at debería nacer cerrada';
    end if;

    raise exception 'TC_TEST_ROLLBACK';
  exception when others then
    if sqlerrm <> 'TC_TEST_ROLLBACK' then raise; end if;
  end;
  raise notice 'Auto-test del grafo de transiciones: OK (todo revertido)';
end $$;

-- ── 6. Comprobación ─────────────────────────────────────────────────────────
do $$
declare n int; v_def text;
begin
  select column_default into v_def from information_schema.columns
   where table_name = 'tc_intervenciones' and column_name = 'cerrada_at';
  if v_def is null or v_def not like '%now()%' then
    raise exception 'cerrada_at no existe o no tiene default now(): los caminos antiguos crearían intervenciones "abiertas"';
  end if;

  -- Ninguna intervención histórica (sin inicio_at, luego no creada por
  -- tc_iniciar_intervencion) puede haber quedado abierta.
  select count(*) into n from tc_intervenciones where cerrada_at is null and inicio_at is null;
  if n > 0 then raise exception '% intervenciones históricas han quedado como abiertas', n; end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_op_valida_transicion') then
    raise exception 'Falta el trigger trg_op_valida_transicion';
  end if;

  select count(*) into n from pg_proc where proname = 'tc_iniciar_intervencion';
  if n <> 1 then raise exception 'Hay % versiones de tc_iniciar_intervencion (se esperaba 1)', n; end if;
  select count(*) into n from pg_proc where proname = 'tc_agrupar_operaciones_sueltas';
  if n <> 1 then raise exception 'Hay % versiones de tc_agrupar_operaciones_sueltas (se esperaba 1)', n; end if;

  -- La red de seguridad tiene que seguir con su cerrojo y sellar cerrada_at.
  select count(*) into n from pg_proc
   where proname = 'tc_agrupar_operaciones_sueltas'
     and prosrc like '%pg_try_advisory_xact_lock%' and prosrc like '%cerrada_at%';
  if n <> 1 then raise exception 'tc_agrupar_operaciones_sueltas ha perdido el cerrojo o no sella cerrada_at'; end if;

  if not exists (select 1 from pg_indexes where indexname = 'uq_interv_abierta_veh_tecnico') then
    raise exception 'Falta el unique parcial de intervención abierta';
  end if;

  raise notice 'OK: cerrada_at con default, historico cerrado, tc_iniciar_intervencion lista y grafo de estados en BD';
end $$;
