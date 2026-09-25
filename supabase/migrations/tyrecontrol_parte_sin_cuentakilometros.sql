-- ============================================================================
-- Parte guiado: se puede cerrar sin kilómetros, diciéndolo
-- ============================================================================
-- Hasta ahora el parte no avanzaba del paso 2 sin teclear los kilómetros. Con
-- Movertis eso deja al técnico atascado: su histórico (`showtrips`) devuelve
-- posiciones y no odómetro, así que el aviso «su equipo no está dando el
-- cuentakilómetros» sale a menudo, y entonces la única salida era inventarse un
-- número. Un kilometraje inventado es peor que ninguno: entra en el histórico
-- del neumático y descuadra lo que ha durado.
--
-- Ahora el técnico puede seguir declarando que NO tiene acceso al
-- cuentakilómetros, y la revisión lo guarda: `km_vehiculo` queda a null y
-- `origen_km` dice 'sin_acceso'. Que es distinto de 'manual' sin km, que sería
-- «se le olvidó», y distinto de un cero, que sería mentira.
--
-- Se vuelve a declarar la función entera porque en plpgsql no hay otra forma;
-- lo único que cambia respecto a tyrecontrol_parte_guiado_guardar.sql son tres
-- trozos: la variable v_sin_km, su lectura y el origen_km de la revisión.
--
-- Idempotente: create or replace.
-- ============================================================================

create or replace function tc_guardar_parte_guiado(p_parte jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_clave    uuid;
  v_serie    text;
  v_dot      text;
  v_veh      record;
  v_ya       record;
  v_rev      uuid;
  v_int      uuid;
  v_numero   text;
  v_km       numeric;
  v_sin_km   boolean;
  v_avisos   text[] := '{}';
  v_med      jsonb;
  v_acc      jsonb;
  v_srv      jsonb;
  v_n_acc    int := 0;
  v_n_med    int := 0;
  v_cab      jsonb := '{}'::jsonb;
  v_res      jsonb;
  v_vistas   uuid[] := '{}';
  v_nuevas   uuid[];
  v_op       uuid;
  v_adj      jsonb;
  v_dest     record;
  v_dest_cod text;
  v_estado   text;
  v_n_fotos  int := 0;
  v_args     jsonb;
  v_mon      record;
begin
  v_clave := nullif(p_parte->>'clave', '')::uuid;
  if v_clave is null then
    raise exception 'Falta la clave del parte: sin ella un reintento crearía un parte duplicado';
  end if;

  -- YA GUARDADO. Se comprueba antes de tocar nada. La llave primaria hace que
  -- dos llamadas a la vez se serialicen: la segunda espera y ve esta fila.
  select * into v_ya from tc_partes_guiados where clave = v_clave;
  if found then
    select numero into v_numero from tc_intervenciones where id = v_ya.intervencion_id;
    return jsonb_build_object(
      'intervencion_id', v_ya.intervencion_id, 'revision_id', v_ya.revision_id,
      'numero', v_numero, 'ya_guardado', true, 'avisos', to_jsonb(v_avisos));
  end if;

  select * into v_veh from tc_vehiculos where id = (p_parte->>'vehiculo_id')::uuid;
  if not found then raise exception 'Vehículo no encontrado'; end if;
  if not (tc_is_superadmin()
          or (tc_is_admin() and v_veh.empresa_id = tc_auth_empresa_id())
          or tc_operador_ve_empresa(v_veh.empresa_id)) then
    raise exception 'Sin permiso para guardar partes de esta empresa';
  end if;

  v_km := nullif(p_parte->>'km', '')::numeric;
  -- El técnico ha declarado que no puede leer el cuentakilómetros. No es lo
  -- mismo que «se le olvidó»: es un dato que no existe, y queda dicho.
  v_sin_km := coalesce((p_parte->>'sin_cuentakilometros')::boolean, false);
  if v_km is not null then
    if v_km < 0 then raise exception 'Los kilómetros no pueden ser negativos'; end if;
    -- Un kilometraje a la baja NO se rechaza: puede ser un cuentakilómetros
    -- cambiado, o el de antes se equivocó. Se avisa y decide una persona;
    -- bloquear el parte por esto dejaría al operario sin poder cerrarlo.
    if v_km < v_veh.km_actual then
      v_avisos := v_avisos || format(
        'Los kilómetros indicados (%s) son menores que los registrados (%s)',
        v_km, v_veh.km_actual);
    end if;
  end if;

  -- ── La revisión, con sus mediciones ──
  -- Va primero porque lo que el operario mide es el estado ANTES de tocar
  -- nada. Si se guardara después de las operaciones, la profundidad de una
  -- goma desmontada se habría medido sobre una rueda que ya no está ahí.
  if jsonb_array_length(coalesce(p_parte->'mediciones', '[]'::jsonb)) > 0 then
    insert into revisiones_vehiculo (
      empresa_id, vehiculo_id, km_vehiculo, origen_km, fecha_revision,
      tecnico_id, estado_revision, observaciones)
    values (
      v_veh.empresa_id, v_veh.id, v_km,
      case when v_km is null and v_sin_km then 'sin_acceso' else 'manual' end, current_date,
      auth.uid(), 'completada', p_parte->>'observaciones')
    returning id into v_rev;

    for v_med in select * from jsonb_array_elements(p_parte->'mediciones') loop
      -- La posición tiene que ser del TIPO de este vehículo. Sin esto, una
      -- medición podría acabar en la rueda de otro camión.
      if not exists (
        select 1 from tc_posiciones_vehiculo
         where id = (v_med->>'posicion_id')::uuid
           and tipo_vehiculo_id = v_veh.tipo_vehiculo_id) then
        raise exception 'La posición % no es de este vehículo', v_med->>'posicion_id';
      end if;

      insert into revisiones_neumaticos_detalle (
        revision_id, empresa_id, vehiculo_id, neumatico_id, posicion_id,
        profundidad_mm, presion_bar, metodo_profundidad, metodo_presion,
        estado_visual, observaciones, foto_url, no_accesible, neumatico_ausente)
      values (
        v_rev, v_veh.empresa_id, v_veh.id,
        nullif(v_med->>'neumatico_id', '')::uuid, (v_med->>'posicion_id')::uuid,
        nullif(v_med->>'profundidad_mm', '')::numeric,
        nullif(v_med->>'presion_bar', '')::numeric,
        coalesce(v_med->>'metodo_profundidad', 'manual'),
        coalesce(v_med->>'metodo_presion', 'manual'),
        nullif(v_med->>'estado_visual', ''), nullif(v_med->>'observaciones', ''),
        nullif(v_med->>'foto_url', ''),
        coalesce((v_med->>'no_accesible')::boolean, false),
        coalesce((v_med->>'neumatico_ausente')::boolean, false))
      -- Dos mediciones de la misma posición en el mismo parte: manda la última
      -- que el operario tecleó, no la primera.
      on conflict (revision_id, posicion_id) do update set
        profundidad_mm = excluded.profundidad_mm,
        presion_bar    = excluded.presion_bar,
        estado_visual  = excluded.estado_visual,
        observaciones  = excluded.observaciones,
        foto_url       = excluded.foto_url;
      v_n_med := v_n_med + 1;
    end loop;
  end if;

  -- ── La intervención y sus operaciones ──
  v_int := (tc_iniciar_intervencion(v_veh.id)->>'id')::uuid;

  for v_acc in select * from jsonb_array_elements(coalesce(p_parte->'acciones', '[]'::jsonb)) loop
    v_args := coalesce(v_acc->'args', '{}'::jsonb);
    v_dest_cod := null;

    -- Goma declarada en este mismo parte: el montaje no existía cuando la
    -- tablet armó la acción, pero sí existe ahora. Se busca por posición.
    if nullif(v_acc->>'posicion_origen','') is not null then
      select * into v_mon from tc_montajes_actuales
       where vehiculo_id = v_veh.id
         and posicion_id = (v_acc->>'posicion_origen')::uuid;
      if not found then
        raise exception 'No hay ningún neumático montado en la posición % '
          'cuando le tocaba el turno a esta operación', v_acc->>'posicion_origen';
      end if;
      -- Cada RPC pide lo suyo; se rellena solo lo que le falta.
      if v_acc->>'rpc' in ('tc_desmontar_neumatico','tc_cambiar_posicion') then
        v_args := v_args || jsonb_build_object('p_montaje', v_mon.id);
      elsif v_acc->>'rpc' = 'tc_registrar_reparacion' then
        v_args := v_args || jsonb_build_object('p_neumatico', v_mon.neumatico_id);
      else
        raise exception 'La operación % no se puede resolver por posición', v_acc->>'rpc';
      end if;
    end if;

    -- El destino elegido decide con qué estado se desmonta. La traducción vive
    -- aquí y no en la tablet: si el catálogo cambia, cambia en un sitio.
    if v_acc->>'rpc' = 'tc_desmontar_neumatico'
       and nullif(v_acc->>'destino_codigo','') is not null then
      select * into v_dest from tc_cat_destinos where codigo = v_acc->>'destino_codigo';
      if not found then
        raise exception 'Destino "%" no está en el catálogo', v_acc->>'destino_codigo';
      end if;
      v_dest_cod := v_dest.codigo;
      v_estado := coalesce(v_dest.estado_resultante, 'almacen');
      v_args := v_args || jsonb_build_object('p_nuevo_estado',
        case
          -- Vuelve al almacén: se desmonta como siempre y repone stock usado.
          when v_estado in ('almacen','stock_usado','stock_nuevo','stock_recauchutado')
            then 'almacen'
          -- Sale del circuito: se da de baja.
          when v_estado in ('descartado','vendido')
            then 'descartado'
          -- Todo lo demás (recauchutado, cuarentena, reparación…) se queda en
          -- un estado que NO mueve stock, y se afina justo después.
          else 'reparacion'
        end);
    end if;

    -- No se reimplementa ninguna operación: se despacha a la que ya existe,
    -- con el contexto de la intervención puesto. Si una falla, la excepción
    -- sube y se deshace TODO lo de este parte, mediciones incluidas.
    v_res := tc_ejecutar_en_intervencion(v_int, v_acc->>'rpc', v_args);
    v_n_acc := v_n_acc + 1;

    -- Qué operaciones ha creado ESTA acción. La función devuelve todas las de
    -- la intervención creadas en la transacción, así que las de las acciones
    -- anteriores hay que descontarlas: si no, la foto de la segunda rueda se
    -- colgaría también de la primera.
    select coalesce(array_agg(x), '{}'::uuid[]) into v_nuevas
      from (select (jsonb_array_elements_text(
              coalesce(v_res->'operaciones_intervencion', '[]'::jsonb)))::uuid as x) t
     where not (x = any(v_vistas));
    v_vistas := v_vistas || v_nuevas;

    -- El destino del catálogo, ya con la operación creada.
    if v_dest_cod is not null then
      update tc_neumaticos n
         set estado = v_estado, updated_at = now()
        from operaciones_neumaticos o
       where o.id = any(v_nuevas) and n.id = o.neumatico_id
         and n.estado is distinct from v_estado;
      update operaciones_neumaticos
         set destino = v_dest_cod, estado_nuevo = v_estado, updated_at = now()
       where id = any(v_nuevas);
    end if;

    -- El número de serie leído de la foto, en la ficha de la goma. Para la que
    -- SALE viene como campo de la acción; para la que ENTRA, dentro de
    -- p_datos del montaje (y las RPC de montaje lo descartan cuando la
    -- política de la empresa es genérica: aquí se recupera, porque la foto
    -- del serie es obligatoria en el parte y sería absurdo tirarla). Solo si
    -- la ficha lo tenía vacío: ver la nota de arriba.
    v_serie := coalesce(nullif(v_acc->>'numero_serie',''), nullif(v_args->'p_datos'->>'numero_serie',''));
    v_dot   := coalesce(nullif(v_acc->>'dot',''),          nullif(v_args->'p_datos'->>'dot',''));
    if v_serie is not null then
      update tc_neumaticos n
         set numero_serie = v_serie, updated_at = now()
        from operaciones_neumaticos o
       where o.id = any(v_nuevas) and n.id = o.neumatico_id
         and nullif(trim(n.numero_serie), '') is null
         and not exists (select 1 from tc_neumaticos x
                          where x.empresa_id = n.empresa_id and x.numero_serie = v_serie and x.id <> n.id);
    end if;
    if v_dot is not null then
      update tc_neumaticos n
         set dot = v_dot, updated_at = now()
        from operaciones_neumaticos o
       where o.id = any(v_nuevas) and n.id = o.neumatico_id
         and nullif(trim(n.dot), '') is null;
    end if;

    -- Las fotos de la acción (las de la goma que sale en el desmontaje, la
    -- del serie de la que entra en el montaje). Van a tc_operacion_adjuntos,
    -- que es la tabla de adjuntos que YA existe: no se crea otro sistema de
    -- fotos. Se cuelgan de la primera operación de la acción, que es la del
    -- desmontaje (una sustitución crearía dos: desmontaje y montaje). Las
    -- de un montaje son «despues»: son de la rueda ya puesta.
    v_op := v_nuevas[1];
    if v_op is not null then
      for v_adj in select * from jsonb_array_elements(coalesce(v_acc->'adjuntos', '[]'::jsonb)) loop
        if nullif(v_adj->>'url','') is not null then
          insert into tc_operacion_adjuntos (operacion_id, file_url, file_type, descripcion)
          values (v_op, v_adj->>'url',
                  case when v_acc->>'rpc' like 'tc_montar%' then 'despues' else 'antes' end,
                  nullif(v_adj->>'descripcion',''));
          v_n_fotos := v_n_fotos + 1;
        end if;
      end loop;
    end if;
  end loop;

  -- ── Servicios facturables ──
  -- Se reemplazan enteros: si el parte se reintenta con otra clave, no deja
  -- líneas de un intento anterior sumando de más.
  if p_parte ? 'servicios' then
    delete from tc_intervencion_servicios where intervencion_id = v_int;
    for v_srv in select * from jsonb_array_elements(p_parte->'servicios') loop
      if coalesce((v_srv->>'cantidad')::numeric, 0) > 0 then
        insert into tc_intervencion_servicios (intervencion_id, servicio, cantidad, observaciones)
        values (v_int, v_srv->>'servicio', (v_srv->>'cantidad')::numeric,
                nullif(v_srv->>'observaciones', ''))
        on conflict (intervencion_id, servicio) do update set
          cantidad = excluded.cantidad, observaciones = excluded.observaciones;
      end if;
    end loop;
  end if;

  -- ── Cabecera, firmas y tiempos del mecánico ──
  update tc_intervenciones set
    observaciones        = coalesce(nullif(p_parte->>'observaciones', ''), observaciones),
    lugar_servicio       = coalesce(nullif(p_parte->>'lugar_servicio', ''), lugar_servicio),
    orden_flota          = coalesce(nullif(p_parte->>'orden_flota', ''), orden_flota),
    firma_cliente_url    = coalesce(nullif(p_parte->>'firma_cliente_url', ''), firma_cliente_url),
    firma_cliente_nombre = coalesce(nullif(p_parte->>'firma_cliente_nombre', ''), firma_cliente_nombre),
    firma_cliente_dni    = coalesce(nullif(p_parte->>'firma_cliente_dni', ''), firma_cliente_dni),
    firma_tecnico_url    = coalesce(nullif(p_parte->>'firma_tecnico_url', ''), firma_tecnico_url),
    firma_tecnico_nombre = coalesce(nullif(p_parte->>'firma_tecnico_nombre', ''), firma_tecnico_nombre),
    firmado_at           = case when p_parte->>'firma_cliente_url' is not null
                                 or p_parte->>'firma_tecnico_url' is not null
                                then now() else firmado_at end,
    mecanico_inicio_at   = coalesce(nullif(p_parte->>'mecanico_inicio_at', '')::timestamptz, mecanico_inicio_at),
    mecanico_fin_at      = coalesce(nullif(p_parte->>'mecanico_fin_at', '')::timestamptz, mecanico_fin_at),
    mecanico_km          = coalesce(nullif(p_parte->>'mecanico_km', '')::numeric, mecanico_km)
  where id = v_int;

  -- ── Los km del vehículo ──
  -- Solo hacia arriba: un cuentakilómetros que baja se avisa (arriba) pero no
  -- se escribe encima del bueno.
  if v_km is not null and v_km > v_veh.km_actual then
    update tc_vehiculos
       set km_actual = v_km, origen_km = 'manual', updated_at = now()
     where id = v_veh.id;
  end if;

  -- ── Y la marca de que este parte ya está guardado ──
  insert into tc_partes_guiados (clave, intervencion_id, revision_id, vehiculo_id, creado_por)
  values (v_clave, v_int, v_rev, v_veh.id, auth.uid());

  select numero into v_numero from tc_intervenciones where id = v_int;

  return jsonb_build_object(
    'intervencion_id', v_int, 'revision_id', v_rev, 'numero', v_numero,
    'ya_guardado', false, 'operaciones', v_n_acc, 'mediciones', v_n_med,
    'fotos', v_n_fotos, 'avisos', to_jsonb(v_avisos));
end $$;

comment on function tc_guardar_parte_guiado(jsonb) is
  'Escribe un parte guiado entero en UNA transacción: revisión con mediciones, '
  'intervención con operaciones (despachadas a las RPC que ya existen), '
  'servicios, cabecera y firmas. Admite parte SIN kilómetros cuando la tablet '
  'manda sin_cuentakilometros: la revisión queda con origen_km = sin_acceso. '
  'No cierra la intervención: eso lo hace el endpoint del servidor.';

grant execute on function tc_guardar_parte_guiado(jsonb) to authenticated;
