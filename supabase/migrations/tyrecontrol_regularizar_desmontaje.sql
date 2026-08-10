-- ============================================================
-- Mobilink TyreControl — Resolver el conflicto de la goma que «ya está
-- montada en otro camión», sin salir de la pantalla de Cambios.
--
-- FASE 4 (caso C1) de docs/PROMPT_identificacion_neumaticos.md
-- Requiere: tyrecontrol_montar_buscar_o_crear.sql (fase 1)
--
-- EL CASO
--
-- El técnico lee el RFID de la goma que tiene en la mano y el sistema
-- responde IDENTIDAD_YA_MONTADA: consta puesta en el 9999ZZZ, posición
-- E2_DER. Casi siempre significa una cosa: **el desmontaje de aquel camión no
-- se registró**. La goma está aquí, en el suelo del taller, y la base de datos
-- no se ha enterado.
--
-- Con la fase 1, ese caso da un error explicado en vez del error crudo de
-- Postgres. Pero el técnico se queda igual: con la rueda en la mano y sin
-- poder montarla. Bloquear sin salida es justo lo que hace que la gente deje
-- de usar la herramienta y monte sin registrar nada.
--
-- LA SALIDA
--
-- Enseñar el conflicto y dejar que el técnico confirme: «esta goma consta en
-- el 9999ZZZ · ¿la quito de ahí y la monto aquí?». Al confirmar se registra el
-- desmontaje que faltaba y se sigue. Es la opción (c) cayendo en la (b) del
-- documento: la realidad manda sobre la base, pero nunca en silencio.
--
-- LO QUE NO HACE, Y ES IMPORTANTE
--
-- **No devuelve la goma al stock.** `tc_desmontar_neumatico` sí lo hace
-- (tc_devolver_usado_a_stock, +1 en la ubicación USADOS), porque allí la rueda
-- vuelve de verdad al almacén. Aquí NO: la goma va directa del camión viejo al
-- nuevo sin pasar por el almacén, y sumarle un +1 dejaría una unidad fantasma
-- en el inventario para siempre.
--
-- El caso C2 (la ficha es de OTRA empresa) NO se resuelve aquí: traspasar la
-- goma le enseñaría al cliente nuevo dónde estuvo montada antes, y eso es una
-- decisión con implicaciones de privacidad que sigue abierta. Se mantiene el
-- bloqueo de la fase 1.
--
-- Idempotente: se puede ejecutar varias veces.
-- ============================================================

-- ── 1. Consultar una identidad sin lanzar excepción ─────────────────────────
--
-- tc_buscar_neumatico_identificado está pensada para el camino de montaje y
-- LANZA cuando algo no cuadra. Para pintar un diálogo hace falta lo contrario:
-- preguntar y que conteste.
--
-- Privacidad: si la ficha es de una empresa que quien pregunta no puede ver,
-- se dice que existe y nada más. Ni número interno, ni matrícula, ni medida.
create or replace function tc_neumatico_por_identidad(
  p_empresa uuid, p_rfid text default null, p_serie text default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_rfid text; v_serie text; v_id uuid; v_neu record; v_veh text; v_pos text;
begin
  if not (tc_is_superadmin() or (tc_is_admin() and p_empresa = tc_auth_empresa_id()) or tc_operador_ve_empresa(p_empresa)) then
    raise exception 'Sin permiso sobre esta empresa';
  end if;

  v_rfid  := nullif(btrim(coalesce(p_rfid, '')), '');
  v_serie := nullif(btrim(coalesce(p_serie, '')), '');
  if v_rfid is null and v_serie is null then return jsonb_build_object('existe', false); end if;

  if v_rfid is not null then
    select id into v_id from tc_neumaticos where rfid_epc = v_rfid;
  end if;
  if v_id is null and v_serie is not null then
    select id into v_id from tc_neumaticos where empresa_id = p_empresa and numero_serie = v_serie;
  end if;
  if v_id is null then return jsonb_build_object('existe', false); end if;

  select * into v_neu from tc_neumaticos where id = v_id;

  -- Ficha de otra empresa: se confirma que existe y se corta ahí.
  if v_neu.empresa_id is distinct from p_empresa then
    return jsonb_build_object('existe', true, 'otra_empresa', true);
  end if;

  select v.matricula, po.codigo_posicion into v_veh, v_pos
    from tc_montajes_actuales m
    join tc_vehiculos v on v.id = m.vehiculo_id
    left join tc_posiciones_vehiculo po on po.id = m.posicion_id
   where m.neumatico_id = v_neu.id
   limit 1;

  return jsonb_build_object(
    'existe', true,
    'otra_empresa', false,
    'id', v_neu.id,
    'numero_interno', v_neu.numero_interno,
    'estado', v_neu.estado,
    'activo', v_neu.activo,
    'medida', v_neu.medida,
    'marca', v_neu.marca,
    'profundidad_actual_mm', v_neu.profundidad_actual_mm,
    'reesculturado', v_neu.reesculturado,
    'matricula', v_veh,
    'codigo_posicion', v_pos
  );
end $$;

comment on function tc_neumatico_por_identidad(uuid, text, text) is
  'Consulta por RFID o nº de serie SIN lanzar excepción, para pintar diálogos. '
  'De una ficha de otra empresa solo dice que existe.';

-- ── 2. Registrar el desmontaje que faltaba ──────────────────────────────────
create or replace function tc_regularizar_desmontaje(p_neumatico uuid, p_obs text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare m record; v_neu record; v_veh text; v_pos text; v_nota text;
begin
  select * into v_neu from tc_neumaticos where id = p_neumatico;
  if not found then raise exception 'Neumático no encontrado'; end if;

  if not (tc_is_superadmin() or (tc_is_admin() and v_neu.empresa_id = tc_auth_empresa_id())
          or tc_operador_ve_empresa(v_neu.empresa_id)) then
    raise exception 'Sin permiso sobre esta empresa';
  end if;

  select * into m from tc_montajes_actuales where neumatico_id = p_neumatico limit 1;
  if not found then
    -- Ya no consta montada: alguien lo ha arreglado por otro lado. No es un
    -- error, es que no hay nada que regularizar.
    update tc_neumaticos set estado = 'almacen', vehiculo_id = null, posicion_id = null, updated_at = now()
     where id = p_neumatico and estado = 'montado';
    return jsonb_build_object('regularizado', false);
  end if;

  select v.matricula, po.codigo_posicion into v_veh, v_pos
    from tc_vehiculos v
    left join tc_posiciones_vehiculo po on po.id = m.posicion_id
   where v.id = m.vehiculo_id;

  v_nota := trim(both ' ' from coalesce(p_obs, '')
    || ' [REGULARIZACIÓN: el desmontaje de ' || coalesce(v_veh, '?')
    || ' (' || coalesce(v_pos, '?') || ') no se había registrado]');

  insert into tc_historial_montajes (empresa_id, vehiculo_id, neumatico_id, posicion_id, fecha_montaje, km_montaje,
    fecha_desmontaje, km_desmontaje, motivo_desmontaje, tecnico_montaje_id, tecnico_desmontaje_id, observaciones)
  values (m.empresa_id, m.vehiculo_id, m.neumatico_id, m.posicion_id, m.fecha_montaje, m.km_montaje,
    current_date, null, 'error_montaje', m.tecnico_id, auth.uid(), v_nota);

  update tc_neumaticos set estado = 'almacen', vehiculo_id = null, posicion_id = null, updated_at = now()
   where id = p_neumatico;

  delete from tc_montajes_actuales where id = m.id;

  -- 'error_montaje' es el motivo del catálogo que encaja (fase8 lo restringe
  -- por CHECK); el detalle va en observaciones. Destino 'almacen' es el estado
  -- neutro por el que pasa: acto seguido se monta en el vehículo nuevo.
  insert into operaciones_neumaticos (empresa_id, vehiculo_id, neumatico_id, tipo_operacion, posicion_origen_id,
    montaje_origen_id, fecha_operacion, motivo, estado_anterior, estado_nuevo, destino, tecnico_id, observaciones)
  values (m.empresa_id, m.vehiculo_id, m.neumatico_id, 'desmontaje', m.posicion_id, m.id, current_date,
    'error_montaje', 'montado', 'almacen', 'almacen', auth.uid(), v_nota);

  -- OJO: no se llama a tc_devolver_usado_a_stock. La goma no ha vuelto al
  -- almacén; va del camión viejo al nuevo. Un +1 aquí sería una unidad
  -- fantasma en el inventario.

  return jsonb_build_object(
    'regularizado', true,
    'matricula', v_veh,
    'codigo_posicion', v_pos,
    'numero_interno', v_neu.numero_interno
  );
end $$;

comment on function tc_regularizar_desmontaje(uuid, text) is
  'Registra el desmontaje que no se llegó a apuntar, para poder montar la goma '
  'donde está de verdad. NO devuelve stock: la rueda no ha pasado por almacén.';

-- ── 3. Comprobaciones ───────────────────────────────────────────────────────
do $$
declare n int;
begin
  select count(*) into n from pg_proc where proname = 'tc_regularizar_desmontaje';
  if n <> 1 then raise exception 'tc_regularizar_desmontaje: se esperaba 1 versión, hay %', n; end if;

  -- La regularización NO debe reponer stock (unidad fantasma). Se busca la
  -- LLAMADA, no el nombre a secas: el cuerpo lo menciona en un comentario
  -- precisamente para explicar por qué no se llama.
  select count(*) into n from pg_proc
   where proname = 'tc_regularizar_desmontaje' and prosrc like '%perform tc_devolver_usado_a_stock%';
  if n <> 0 then raise exception 'La regularización está devolviendo stock: crearía una unidad fantasma'; end if;

  raise notice 'OK: la goma montada en otro vehículo se puede regularizar sin tocar el stock';
end $$;
