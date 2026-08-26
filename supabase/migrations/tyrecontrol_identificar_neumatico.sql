-- ============================================================
-- Mobilink TyreControl — Identificar una goma que ya está montada
--
-- FASE 5 de docs/PROMPT_identificacion_neumaticos.md
-- Requiere: tyrecontrol_politica_identificacion.sql (fase 2)
--
-- EL PROBLEMA
--
-- Un cliente activa el modo identificado y se encuentra con que TODA su flota
-- está montada sin identidad. La fase 3 hace que las gomas se identifiquen
-- según se van montando, pero eso solo cubre las que caen: las que ya están
-- puestas tardarían años en pasar por el taller.
--
-- Sin un camino para identificar en sitio, el modo identificado no se alcanza
-- nunca y la cobertura se queda a medias para siempre.
--
-- LA SOLUCIÓN
--
-- Una acción sobre la rueda montada: se lee el RFID o se teclea el número de
-- serie y la ficha queda identificada, sin desmontar nada y sin tocar su
-- estado. El técnico las va identificando en las revisiones normales.
--
-- LO QUE NO HACE
--
-- No PISA una identidad que ya esté puesta. Si la ficha ya tiene un RFID y se
-- lee otro distinto, es que una de las dos cosas está mal: se avisa y decide
-- una persona. Rellenar huecos sí; sobrescribir no.
--
-- SOBRE tipo_operacion
--
-- fase8 puso un CHECK con una lista cerrada, pero
-- tyrecontrol_operaciones_fase1.sql:38 lo DROPEA a propósito: los valores
-- válidos viven en tc_cat_tipos_operacion, que es configurable. Por eso aquí
-- basta con dar de alta el código nuevo en el catálogo, igual que hizo
-- tyrecontrol_plan_trabajo.sql con 'reesculturado' y 'plan_trabajo'.
--
-- Idempotente: se puede ejecutar varias veces.
-- ============================================================

insert into tc_cat_tipos_operacion (codigo, nombre, orden, es_fisica) values
  ('identificacion','Identificación de neumático',110,false)
on conflict (codigo) do nothing;

-- ── 1. Identificar ──────────────────────────────────────────────────────────
create or replace function tc_identificar_neumatico(
  p_neumatico uuid, p_rfid text default null, p_serie text default null,
  p_dot text default null, p_obs text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_neu record; v_rfid text; v_serie text; v_dot text; v_otro record; v_veh uuid;
begin
  select * into v_neu from tc_neumaticos where id = p_neumatico;
  if not found then raise exception 'Neumático no encontrado'; end if;

  if not (tc_is_superadmin() or (tc_is_admin() and v_neu.empresa_id = tc_auth_empresa_id())
          or tc_operador_ve_empresa(v_neu.empresa_id)) then
    raise exception 'Sin permiso sobre esta empresa';
  end if;
  if v_neu.activo is not true then
    raise exception 'IDENTIDAD_DE_BAJA: el neumático % está dado de baja.', coalesce(v_neu.numero_interno,'?');
  end if;

  v_rfid  := nullif(btrim(coalesce(p_rfid, '')), '');
  v_serie := nullif(btrim(coalesce(p_serie, '')), '');
  v_dot   := nullif(btrim(coalesce(p_dot, '')), '');
  if v_rfid is null and v_serie is null then
    raise exception 'IDENTIDAD_VACIA: hace falta un RFID o un número de serie para identificar la rueda.';
  end if;

  -- No se pisa lo que la ficha ya sabe de sí misma.
  if v_rfid is not null and v_neu.rfid_epc is not null and v_neu.rfid_epc <> v_rfid then
    raise exception 'IDENTIDAD_YA_TIENE: el neumático % ya tiene el RFID %. Si la etiqueta ha cambiado, tiene que corregirlo un administrador.',
      coalesce(v_neu.numero_interno,'?'), v_neu.rfid_epc;
  end if;
  if v_serie is not null and v_neu.numero_serie is not null and v_neu.numero_serie <> v_serie then
    raise exception 'IDENTIDAD_YA_TIENE: el neumático % ya tiene el número de serie %.',
      coalesce(v_neu.numero_interno,'?'), v_neu.numero_serie;
  end if;

  -- Esa identidad no puede ser de otra goma: los índices únicos lo impedirían
  -- igualmente, pero con un error crudo de Postgres.
  if v_rfid is not null then
    select * into v_otro from tc_neumaticos where rfid_epc = v_rfid and id <> p_neumatico;
    if found then
      raise exception 'IDENTIDAD_DUPLICADA: el RFID % ya es del neumático %.',
        v_rfid, coalesce(v_otro.numero_interno,'?');
    end if;
  end if;
  if v_serie is not null then
    select * into v_otro from tc_neumaticos
     where empresa_id = v_neu.empresa_id and numero_serie = v_serie and id <> p_neumatico;
    if found then
      raise exception 'IDENTIDAD_DUPLICADA: el número de serie % ya es del neumático %.',
        v_serie, coalesce(v_otro.numero_interno,'?');
    end if;
  end if;

  update tc_neumaticos set
    control_individual = true,
    rfid_epc     = coalesce(rfid_epc, v_rfid),
    numero_serie = coalesce(numero_serie, v_serie),
    dot          = coalesce(dot, v_dot),
    updated_at   = now()
  where id = p_neumatico;

  -- Queda constancia de quién identificó qué y cuándo. No es una operación
  -- física: la rueda no se toca (es_fisica = false en el catálogo).
  select vehiculo_id into v_veh from tc_neumaticos where id = p_neumatico;
  insert into operaciones_neumaticos (empresa_id, vehiculo_id, neumatico_id, tipo_operacion,
    fecha_operacion, estado_anterior, estado_nuevo, tecnico_id, observaciones)
  values (v_neu.empresa_id, v_veh, p_neumatico, 'identificacion', current_date,
    v_neu.estado, v_neu.estado, auth.uid(),
    trim(both ' ' from coalesce(p_obs,'')
      || ' [IDENTIFICADO' || coalesce(' RFID ' || v_rfid, '') || coalesce(' Nº ' || v_serie, '') || ']'));

  select * into v_neu from tc_neumaticos where id = p_neumatico;
  return jsonb_build_object(
    'numero_interno', v_neu.numero_interno,
    'rfid_epc', v_neu.rfid_epc,
    'numero_serie', v_neu.numero_serie,
    'dot', v_neu.dot
  );
end $$;

comment on function tc_identificar_neumatico(uuid, text, text, text, text) is
  'Pone identidad a una goma ya montada, sin desmontarla ni cambiarle el '
  'estado. Rellena huecos; nunca pisa un RFID o una serie que ya estuviera.';

-- ── 2. Qué queda por identificar ────────────────────────────────────────────
--
-- Solo cuenta lo que la POLÍTICA dice que debería llevar identidad: en modo
-- genérico no hay nada pendiente, y en mixto solo las medidas marcadas. Así el
-- listado no acusa a un cliente de tener pendiente algo que nunca quiso.
create or replace function tc_pendientes_identificar(p_empresa uuid)
returns table(
  neumatico_id uuid, numero_interno text, marca text, medida text,
  profundidad_actual_mm numeric, estado text, matricula text, codigo_posicion text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (tc_is_superadmin() or (tc_is_admin() and p_empresa = tc_auth_empresa_id()) or tc_operador_ve_empresa(p_empresa)) then
    raise exception 'Sin permiso sobre esta empresa';
  end if;
  return query
  select n.id, n.numero_interno, n.marca, n.medida, n.profundidad_actual_mm, n.estado,
         v.matricula, po.codigo_posicion
    from tc_neumaticos n
    left join tc_montajes_actuales m on m.neumatico_id = n.id
    left join tc_vehiculos v on v.id = m.vehiculo_id
    left join tc_posiciones_vehiculo po on po.id = m.posicion_id
   where n.empresa_id = p_empresa
     and n.activo = true
     and n.rfid_epc is null
     and n.numero_serie is null
     and tc_identificacion_resuelve(p_empresa, n.medida)
   order by v.matricula nulls last, po.codigo_posicion, n.numero_interno;
end $$;

comment on function tc_pendientes_identificar(uuid) is
  'Neumáticos activos sin RFID ni número de serie cuya medida SÍ debería '
  'llevarlo según la política de la empresa.';

-- ── 3. Comprobaciones ───────────────────────────────────────────────────────
do $$
declare n int;
begin
  select count(*) into n from pg_proc where proname = 'tc_identificar_neumatico';
  if n <> 1 then raise exception 'tc_identificar_neumatico: se esperaba 1 versión, hay %', n; end if;

  select count(*) into n from tc_cat_tipos_operacion where codigo = 'identificacion';
  if n <> 1 then raise exception 'Falta el tipo de operación identificacion en el catálogo'; end if;

  -- Rellenar huecos sí, pisar no: si desapareciera el coalesce, una lectura
  -- equivocada borraría la identidad buena sin avisar.
  select count(*) into n from pg_proc
   where proname = 'tc_identificar_neumatico' and prosrc like '%coalesce(rfid_epc, v_rfid)%';
  if n <> 1 then raise exception 'tc_identificar_neumatico podría estar pisando una identidad existente'; end if;

  raise notice 'OK: se puede identificar una rueda ya montada, y se sabe qué queda pendiente';
end $$;
