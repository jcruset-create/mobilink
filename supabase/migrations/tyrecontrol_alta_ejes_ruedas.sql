-- ============================================================
-- Mobilink TyreControl — Alta en la tablet: uso, ejes y ruedas
--
-- Segunda parte del alta desde «Nueva revisión» (la maqueta aprobada por
-- Jordi). Después de crear el vehículo, el técnico:
--
--   1. elige su USO (larga distancia, regional, urbano…);
--   2. configura cada EJE con un lápiz sobre el plano: medida, llanta, presión
--      objetivo y si es direccional, motriz o elevable;
--   3. apunta las RUEDAS: marca, medida y dibujo con los favoritos de la flota,
--      el RFID si lo lleva, y «Guardar y copiar» a las ruedas iguales.
--
-- QUÉ HACE
--
--   · tc_vehiculos.uso: columna nueva, nullable, con los usos de la lista.
--   · tc_alta_configurar_vehiculo(vehículo, uso, ejes): guarda el uso, los
--     ejes (tc_vehiculo_ejes) y la presión objetivo por eje
--     (tc_presiones_objetivo). SOLO durante el alta: vehículo creado en la
--     tablet, pendiente de validar y sin ninguna rueda apuntada todavía.
--   · tc_referencias_favoritas(empresa): lo más montado en esa flota (marca,
--     modelo, medida y cuántas), para ofrecerlo primero.
--   · tc_inventario_inicial_posicion: igual que estaba, y además guarda el
--     RFID de la goma (p_datos.rfid_epc) si se escanea.
--
-- LO QUE NO TOCA
--
-- No cambia la estructura de tc_vehiculo_ejes, tc_montajes_actuales ni
-- tc_neumaticos. Solo escribe los ejes de un vehículo que se está dando de
-- alta y que aún no tiene ruedas, y el RFID de una goma que se crea en ese
-- mismo inventario. Ningún vehículo ni neumático existente cambia.
--
-- ── Se prueba sola ───────────────────────────────────────────────────────────
-- Repetida, no hace nada. Si algo no cuadra, se deshace entera.
-- ============================================================

do $migracion$
begin
  if to_regclass('public.tc_vehiculos') is null
     or to_regclass('public.tc_vehiculo_ejes') is null
     or to_regclass('public.tc_presiones_objetivo') is null
     or to_regprocedure('public.tc_montar_desde_catalogo(uuid, uuid, uuid, boolean, jsonb, numeric, date, text, boolean, text, uuid, text, text)') is null
     or to_regprocedure('public.tc_inventario_inicial_posicion(uuid, uuid, uuid, jsonb)') is null then
    raise exception 'No se toca nada: faltan tablas o funciones del alta y del inventario.';
  end if;

  -- ── 1. El uso del vehículo ───────────────────────────────────────────────
  alter table tc_vehiculos add column if not exists uso text;
  if not exists (select 1 from pg_constraint where conname = 'tc_vehiculos_uso_valido') then
    alter table tc_vehiculos add constraint tc_vehiculos_uso_valido
      check (uso is null or uso in ('larga_distancia', 'regional', 'urbano', 'distribucion', 'obra'));
  end if;
  comment on column tc_vehiculos.uso is
    'Para qué se usa el vehículo: larga_distancia, regional, urbano (incluye transporte '
    'público), distribucion u obra (construcción / mixto). Lo elige el técnico en el alta.';

  -- ── 2. Configurar uso y ejes durante el alta ─────────────────────────────
  create or replace function tc_alta_configurar_vehiculo(
    p_vehiculo uuid,
    p_uso      text  default null,
    p_ejes     jsonb default '[]'::jsonb
  ) returns jsonb
  language plpgsql security definer set search_path = public as $f$
  declare
    v_veh record; v_e jsonb; v_eje int; v_ruedas int; v_medida uuid; v_llanta uuid;
    v_presion numeric; v_n int := 0; v_primero record;
  begin
    select * into v_veh from tc_vehiculos where id = p_vehiculo;
    if not found then raise exception 'Vehículo no encontrado'; end if;

    if not (tc_is_superadmin()
            or (tc_is_admin() and v_veh.empresa_id = tc_auth_empresa_id())
            or tc_operador_ve_empresa(v_veh.empresa_id)) then
      raise exception 'Sin permiso sobre este vehículo';
    end if;

    -- Una puerta estrecha: solo el vehículo que se está dando de alta desde la
    -- tablet y que todavía no tiene ninguna rueda. Los ejes de un vehículo en
    -- servicio se cambian en el panel, no desde el patio.
    if not coalesce(v_veh.pendiente_validar, false)
       or coalesce(v_veh.creado_desde, '') <> 'tablet'
       or not v_veh.activo then
      raise exception 'La configuración de ejes solo se cambia aquí durante el alta de un vehículo '
        'nuevo. Para un vehículo en servicio, pídelo a oficina.';
    end if;
    if exists (select 1 from tc_montajes_actuales where vehiculo_id = p_vehiculo) then
      raise exception 'Este vehículo ya tiene ruedas apuntadas: los ejes ya no se cambian desde la '
        'tablet. Pídelo a oficina.';
    end if;
    if v_veh.tipo_vehiculo_id is null then
      raise exception 'El vehículo no tiene tipo: elige primero qué vehículo es.';
    end if;

    if p_uso is not null
       and p_uso not in ('larga_distancia', 'regional', 'urbano', 'distribucion', 'obra') then
      raise exception 'Uso no válido: %', p_uso;
    end if;

    if p_ejes is null or jsonb_typeof(p_ejes) <> 'array' then
      raise exception 'p_ejes tiene que ser una lista de ejes';
    end if;

    for v_e in select * from jsonb_array_elements(p_ejes) loop
      v_eje := nullif(v_e->>'eje', '')::int;
      -- El eje tiene que existir en el plano del tipo: las ruedas cuelgan de él.
      select count(*) into v_ruedas from tc_posiciones_vehiculo
       where tipo_vehiculo_id = v_veh.tipo_vehiculo_id and activo and eje = v_eje;
      if v_eje is null or v_ruedas = 0 then
        raise exception 'El eje % no existe en el plano de este vehículo.', v_e->>'eje';
      end if;

      v_medida := nullif(v_e->>'medida_id', '')::uuid;
      if v_medida is not null
         and not exists (select 1 from tc_cat_medidas_neumatico where id = v_medida and activo) then
        raise exception 'La medida del eje % no está en el catálogo o está dada de baja.', v_eje;
      end if;
      v_llanta := nullif(v_e->>'tipo_llanta_id', '')::uuid;
      if v_llanta is not null
         and not exists (select 1 from tc_tipos_llanta where id = v_llanta and activo) then
        raise exception 'La llanta del eje % no está en el catálogo o está dada de baja.', v_eje;
      end if;
      v_presion := nullif(v_e->>'presion_bar', '')::numeric;
      if v_presion is not null and (v_presion < 1 or v_presion > 15) then
        raise exception 'Presión objetivo imposible en el eje %: % bar.', v_eje, v_presion;
      end if;

      insert into tc_vehiculo_ejes (vehiculo_id, eje, ruedas, medida_id, tipo_llanta_id,
                                    directriz, motriz, elevable)
      values (p_vehiculo, v_eje, v_ruedas, v_medida, v_llanta,
              coalesce((v_e->>'directriz')::boolean, false),
              coalesce((v_e->>'motriz')::boolean, false),
              coalesce((v_e->>'elevable')::boolean, false))
      on conflict (vehiculo_id, eje) do update set
        ruedas = excluded.ruedas, medida_id = excluded.medida_id,
        tipo_llanta_id = excluded.tipo_llanta_id, directriz = excluded.directriz,
        motriz = excluded.motriz, elevable = excluded.elevable;

      -- La presión objetivo de ESTE vehículo en ese eje. Sin presión, se quita
      -- la suya y manda la del tipo, si la hay.
      delete from tc_presiones_objetivo where vehiculo_id = p_vehiculo and eje = v_eje;
      if v_presion is not null then
        insert into tc_presiones_objetivo (empresa_id, vehiculo_id, eje, presion_objetivo_bar)
        values (v_veh.empresa_id, p_vehiculo, v_eje, v_presion);
      end if;
      v_n := v_n + 1;
    end loop;

    -- La medida y la llanta del vehículo son las del primer eje: son las que
    -- salen en los listados. Si los ejes no llevan todos la misma, se marca.
    select medida_id, tipo_llanta_id into v_primero
      from tc_vehiculo_ejes where vehiculo_id = p_vehiculo order by eje limit 1;
    update tc_vehiculos set
      uso = p_uso,
      medida_id = coalesce(v_primero.medida_id, medida_id),
      tipo_llanta_id = coalesce(v_primero.tipo_llanta_id, tipo_llanta_id),
      medidas_por_eje = (select count(distinct medida_id) > 1 from tc_vehiculo_ejes
                          where vehiculo_id = p_vehiculo and medida_id is not null),
      updated_at = now()
     where id = p_vehiculo;

    return jsonb_build_object('vehiculo_id', p_vehiculo, 'uso', p_uso, 'ejes', v_n);
  end $f$;

  comment on function tc_alta_configurar_vehiculo(uuid, text, jsonb) is
    'Alta en la tablet: guarda el uso, los ejes (medida, llanta, direccional, motriz, '
    'elevable) y la presión objetivo por eje. Solo para un vehículo creado en la '
    'tablet, pendiente de validar y sin ruedas apuntadas.';

  -- ── 3. Favoritos de la flota ─────────────────────────────────────────────
  create or replace function tc_referencias_favoritas(p_empresa uuid)
  returns jsonb
  language plpgsql stable security definer set search_path = public as $f$
  begin
    if not (tc_is_superadmin() or p_empresa = tc_auth_empresa_id()
            or tc_operador_ve_empresa(p_empresa)) then
      raise exception 'Sin permiso sobre esta flota';
    end if;
    return coalesce((
      select jsonb_agg(f order by f.veces desc)
        from (select n.marca, n.modelo, n.medida, count(*) as veces
                from tc_montajes_actuales m
                join tc_neumaticos n on n.id = m.neumatico_id
                join tc_vehiculos v on v.id = m.vehiculo_id
               where v.empresa_id = p_empresa
                 and coalesce(n.marca, '') <> '' and coalesce(n.medida, '') <> ''
               group by 1, 2, 3
               order by 4 desc
               limit 40) f), '[]'::jsonb);
  end $f$;

  comment on function tc_referencias_favoritas(uuid) is
    'Lo más montado en una flota (marca, modelo, medida, veces), para ofrecerlo primero '
    'al apuntar ruedas en la tablet.';

  -- ── 4. Inventario inicial con RFID ───────────────────────────────────────
  -- La misma función que había, con el RFID. Se reescribe entera porque
  -- PostgreSQL no deja cambiar un trozo.
  create or replace function tc_inventario_inicial_posicion(
    p_vehiculo uuid, p_posicion uuid, p_referencia uuid, p_datos jsonb default '{}'::jsonb)
  returns jsonb
  language plpgsql security definer set search_path = public as $f$
  declare
    v_veh        record;
    v_empresa    uuid;
    v_revision   uuid;
    v_neumatico  uuid;
    v_montaje    record;
    v_profundidad numeric;
    v_presion    numeric;
    v_serie      text;
    v_dot        text;
    v_rfid       text;
    v_total      int;
    v_hechas     int;
  begin
    select * into v_veh from tc_vehiculos where id = p_vehiculo;
    if not found then raise exception 'Vehículo no encontrado'; end if;
    v_empresa := v_veh.empresa_id;

    if not (tc_is_superadmin()
            or (tc_is_admin() and v_empresa = tc_auth_empresa_id())
            or tc_operador_ve_empresa(v_empresa)) then
      raise exception 'Sin permiso sobre este vehículo';
    end if;

    v_profundidad := nullif(p_datos->>'profundidad_mm', '')::numeric;
    if v_profundidad is null then
      raise exception 'Falta la profundidad: sin ella la goma no se puede seguir.';
    end if;
    if v_profundidad < 0 or v_profundidad > 30 then
      raise exception 'Profundidad imposible: % mm.', v_profundidad;
    end if;
    v_presion := nullif(p_datos->>'presion_bar', '')::numeric;
    if v_presion is not null and (v_presion <= 0 or v_presion > 15) then
      raise exception 'Presión imposible: % bar.', v_presion;
    end if;
    v_serie := nullif(trim(p_datos->>'numero_serie'), '');
    v_dot   := nullif(trim(p_datos->>'dot'), '');
    v_rfid  := nullif(upper(trim(p_datos->>'rfid_epc')), '');

    if v_serie is not null and exists (
         select 1 from tc_neumaticos
          where empresa_id = v_empresa and numero_serie = v_serie and activo) then
      raise exception 'Ese número de serie (%) ya está en otro neumático de esta empresa.', v_serie;
    end if;

    select * into v_montaje from tc_montajes_actuales
     where vehiculo_id = p_vehiculo and posicion_id = p_posicion;

    -- El RFID es único en toda la base. Si ya lo lleva una goma montada en otra
    -- rueda, se dice en vez de reventar el índice.
    if v_rfid is not null and exists (
         select 1 from tc_neumaticos n
           join tc_montajes_actuales m on m.neumatico_id = n.id
          where n.rfid_epc = v_rfid
            and not (m.vehiculo_id = p_vehiculo and m.posicion_id = p_posicion)) then
      raise exception 'Esa etiqueta RFID (%) ya está en una goma montada en otra rueda.', v_rfid;
    end if;

    select id into v_revision from revisiones_vehiculo
     where vehiculo_id = p_vehiculo and estado_revision = 'borrador'
     order by created_at desc limit 1;
    if v_revision is null then
      insert into revisiones_vehiculo (empresa_id, vehiculo_id, tecnico_id, estado_revision, observaciones)
      values (v_empresa, p_vehiculo, auth.uid(), 'borrador', 'Inventario inicial del vehículo')
      returning id into v_revision;
    end if;

    if v_montaje.id is not null then
      v_neumatico := v_montaje.neumatico_id;
      -- Corrección: el RFID se pone solo a una goma creada por este mismo
      -- inventario y que aún no lo tenía. Una goma con historia no se toca.
      if v_rfid is not null then
        update tc_neumaticos set rfid_epc = v_rfid, updated_at = now()
         where id = v_neumatico and origen = 'carga_inicial' and rfid_epc is null;
      end if;
    else
      v_neumatico := tc_montar_desde_catalogo(
        p_vehiculo, p_posicion, p_referencia,
        true,
        jsonb_build_object('numero_serie', v_serie, 'dot', v_dot, 'rfid_epc', v_rfid,
                           'profundidad_actual_mm', v_profundidad::text),
        null,
        current_date,
        'Inventario inicial: la goma ya estaba montada',
        false,
        'usado');

      update tc_neumaticos set origen = 'carga_inicial', updated_at = now()
       where id = v_neumatico;
      update operaciones_neumaticos
         set estado_anterior = 'inventario_inicial',
             observaciones = 'Inventario inicial: la goma ya estaba montada cuando el vehículo entró en TyreControl. No es una venta ni un trabajo facturable.'
       where neumatico_id = v_neumatico and tipo_operacion = 'montaje';
    end if;

    insert into revisiones_neumaticos_detalle (
      revision_id, empresa_id, vehiculo_id, neumatico_id, posicion_id,
      profundidad_mm, presion_bar, metodo_profundidad, metodo_presion,
      observaciones, foto_url)
    values (
      v_revision, v_empresa, p_vehiculo, v_neumatico, p_posicion,
      v_profundidad, v_presion, 'manual',
      case when v_presion is null then null else 'manual' end,
      nullif(trim(p_datos->>'observaciones'), ''), nullif(trim(p_datos->>'foto_url'), ''))
    on conflict (revision_id, posicion_id) do update set
      neumatico_id       = excluded.neumatico_id,
      profundidad_mm     = excluded.profundidad_mm,
      presion_bar        = excluded.presion_bar,
      metodo_profundidad = excluded.metodo_profundidad,
      metodo_presion     = excluded.metodo_presion,
      observaciones      = excluded.observaciones,
      foto_url           = coalesce(excluded.foto_url, revisiones_neumaticos_detalle.foto_url);

    select count(*)::int into v_total
      from tc_posiciones_vehiculo where tipo_vehiculo_id = v_veh.tipo_vehiculo_id and activo;
    select count(*)::int into v_hechas
      from revisiones_neumaticos_detalle
     where revision_id = v_revision and profundidad_mm is not null;

    return jsonb_build_object(
      'revision_id', v_revision,
      'neumatico_id', v_neumatico,
      'numero_interno', (select numero_interno from tc_neumaticos where id = v_neumatico),
      'hechas', v_hechas, 'total', v_total,
      'presion_medida', v_presion is not null,
      'rfid_epc', (select rfid_epc from tc_neumaticos where id = v_neumatico));
  end $f$;

  revoke all on function tc_alta_configurar_vehiculo(uuid, text, jsonb) from public;
  revoke all on function tc_referencias_favoritas(uuid) from public;
  grant execute on function tc_alta_configurar_vehiculo(uuid, text, jsonb) to authenticated;
  grant execute on function tc_referencias_favoritas(uuid) to authenticated;
  grant execute on function tc_inventario_inicial_posicion(uuid, uuid, uuid, jsonb) to authenticated;

  -- ── Comprobaciones ───────────────────────────────────────────────────────
  if (select count(*) from pg_proc where proname = 'tc_inventario_inicial_posicion') <> 1 then
    raise exception 'Tiene que quedar UNA sola tc_inventario_inicial_posicion.';
  end if;
  if position('rfid_epc' in pg_get_functiondef('tc_inventario_inicial_posicion(uuid, uuid, uuid, jsonb)'::regprocedure)) = 0 then
    raise exception 'tc_inventario_inicial_posicion no ha quedado con el RFID.';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tc_vehiculos_uso_valido') then
    raise exception 'Falta la comprobación del uso.';
  end if;

  perform set_config('mobilink.resultado',
    'Alta de ejes y ruedas lista: uso del vehículo, ejes con presión objetivo, favoritos de la flota y RFID en el inventario.', false);
end $migracion$;

select current_setting('mobilink.resultado', true) as resultado;
