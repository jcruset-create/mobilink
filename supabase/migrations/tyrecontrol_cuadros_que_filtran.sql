-- Los cuadros de Inventario, Operaciones y Estado de flota filtran lo de debajo.
--
-- ── Por qué hace falta tocar la base ─────────────────────────────────────────
--
-- En los demás informes el cuadro filtra filas que ya están en pantalla. En
-- estos tres no hay filas: la base devuelve solo los recuentos ya hechos, y de
-- un «717 vehículos, 81 para revisar» no se puede sacar CUÁLES son los 81.
--
--   Inventario      las tablas por marca, medida, modelo y estado llegan ya
--                   sumadas, sin saber cuántas de cada una están montadas.
--   Operaciones     «por motivo» y «evolución» llegan sin partir por tipo.
--   Estado de flota llegan cuatro números y ningún vehículo.
--
-- ── Qué se cambia ────────────────────────────────────────────────────────────
--
-- 1. tc_informes_inventario_cubo(p_empresa) — NUEVA. Los neumáticos contados
--    por estado × marca × modelo × medida × rango de profundidad. De ahí la
--    pantalla saca todas sus tablas, enteras o de un solo estado. No sustituye
--    a las cuatro funciones que había, que siguen como están: si ésta no
--    estuviera, la pantalla vuelve a ellas y los cuadros no filtran.
--
--    Comprobado sobre producción antes de escribirla: de las 478 celdas de
--    Plana salen las mismas 111 filas por dimensión, las 58 de marca + medida
--    y las 17 de profundidad que dan hoy las funciones, sin una diferencia.
--
-- 2. tc_informes_operaciones — MISMO resultado, con dos datos MÁS:
--    `por_tipo_motivo` y `evolucion_tipo`. Lo que ya devolvía no cambia.
--
-- 3. tc_informes_estado_flota — MISMO resultado, con un dato MÁS: `vehiculos`,
--    la lista con el estado de cada uno, la profundidad más baja de su última
--    revisión y la fecha. La clasificación es la misma, letra por letra: los
--    cuatro recuentos salen de la misma tabla que la lista.
--
-- Las dos últimas conservan nombre, parámetros y tipo de vuelta: el panel que
-- haya abierto en un navegador sin recargar sigue funcionando igual.
--
-- ── Se prueba sola ───────────────────────────────────────────────────────────
--
-- Un solo bloque, como las anteriores. Cada función se instala, se comprueba
-- que sus números cuadran y se cronometra haciéndose pasar por un superadmin,
-- un usuario de la empresa y un operador, con RLS. Si una no cuadra o no entra
-- en el margen, ESA se deshace sola —queda como estaba— y las otras siguen. La
-- última fila dice qué ha pasado con cada una.

do $migracion$
declare
  c_limite_ms constant numeric := 4000;
  c_limite_operador_ms constant numeric := 7000;

  v_fn_cubo text := $fn$create or replace function tc_informes_inventario_cubo(p_empresa uuid default null)
returns json
language sql
stable
set jit to 'off'
as $function$
  with ult as (
    -- La última profundidad de cada neumático: la misma regla, letra por
    -- letra, que tc_informes_profundidad_distribucion.
    select distinct on (d.neumatico_id) d.neumatico_id, d.profundidad_mm
    from revisiones_neumaticos_detalle d
    join revisiones_vehiculo rv on rv.id = d.revision_id
    join tc_neumaticos n on n.id = d.neumatico_id
    where d.profundidad_mm is not null and rv.estado_revision <> 'anulada'
      and (p_empresa is null or n.empresa_id = p_empresa)
    order by d.neumatico_id, rv.fecha_revision desc, rv.created_at desc
  ),
  cubo as (
    select coalesce(n.estado, '—') as estado,
           coalesce(n.marca, '—') as marca,
           coalesce(n.modelo, '—') as modelo,
           coalesce(n.medida, '—') as medida,
           -- Las fichas que creó la importación del histórico. Las tablas por
           -- marca, medida, modelo y estado no las cuentan; los cuadros y la
           -- distribución por profundidad, sí. Se marca para poder hacer las
           -- dos cuentas con los mismos datos.
           (n.importacion_lote_id is not null) as de_lote,
           case
             when u.profundidad_mm is null then null
             when u.profundidad_mm <= 2 then 'r0_2'
             when u.profundidad_mm <= 4 then 'r2_4'
             when u.profundidad_mm <= 6 then 'r4_6'
             when u.profundidad_mm <= 8 then 'r6_8'
             when u.profundidad_mm <= 10 then 'r8_10'
             else 'r10'
           end as rango,
           count(*)::int as n
    from tc_neumaticos n
    left join ult u on u.neumatico_id = n.id
    where (p_empresa is null or n.empresa_id = p_empresa)
    group by 1, 2, 3, 4, 5, 6
  )
  select coalesce(json_agg(row_to_json(c)), '[]'::json) from cubo c;
$function$$fn$;

  v_fn_operaciones text := $fn$create or replace function tc_informes_operaciones(p_empresa uuid default null, p_desde date default null, p_hasta date default null)
returns json
language sql
stable
set jit to 'off'
as $function$
  with rango as (
    select coalesce(p_desde, date_trunc('month', now())::date) as d1, coalesce(p_hasta, now()::date) as d2
  ),
  ops as (
    select o.tipo_operacion, o.motivo, o.fecha_operacion
    from operaciones_neumaticos o, rango
    where (p_empresa is null or o.empresa_id = p_empresa)
      and o.fecha_operacion between rango.d1 and rango.d2
  )
  select json_build_object(
    'total', (select count(*) from ops),
    'por_tipo', (select coalesce(json_agg(row_to_json(t) order by t.n desc), '[]'::json)
                 from (select tipo_operacion as tipo, count(*)::int as n from ops group by 1) t),
    'por_motivo', (select coalesce(json_agg(row_to_json(m) order by m.n desc), '[]'::json)
                   from (select coalesce(motivo, '—') as motivo, count(*)::int as n from ops group by 1) m),
    'evolucion', (select coalesce(json_agg(row_to_json(e) order by e.mes), '[]'::json)
                  from (select to_char(date_trunc('month', fecha_operacion), 'YYYY-MM') as mes, count(*)::int as n from ops group by 1) e),
    -- Lo mismo, partido por tipo: es lo que deja filtrar el motivo y la
    -- evolución al pulsar el cuadro de un tipo de operación.
    'por_tipo_motivo', (select coalesce(json_agg(row_to_json(x) order by x.n desc, x.tipo, x.motivo), '[]'::json)
                        from (select tipo_operacion as tipo, coalesce(motivo, '—') as motivo, count(*)::int as n
                              from ops group by 1, 2) x),
    'evolucion_tipo', (select coalesce(json_agg(row_to_json(x) order by x.mes, x.tipo), '[]'::json)
                       from (select to_char(date_trunc('month', fecha_operacion), 'YYYY-MM') as mes,
                                    tipo_operacion as tipo, count(*)::int as n
                             from ops group by 1, 2) x)
  );
$function$$fn$;

  v_fn_flota text := $fn$create or replace function tc_informes_estado_flota(p_empresa uuid default null)
returns json
language sql
stable
set jit to 'off'
as $function$
  with veh as (
    select v.id, v.empresa_id, v.matricula, v.numero_unidad
    from tc_vehiculos v where v.activo and v.en_seguimiento and (p_empresa is null or v.empresa_id = p_empresa)
  ),
  ultrev as (
    select distinct on (rv.vehiculo_id) rv.vehiculo_id, rv.id as revision_id, rv.fecha_revision
    from revisiones_vehiculo rv
    where rv.estado_revision <> 'anulada' and (p_empresa is null or rv.empresa_id = p_empresa)
    order by rv.vehiculo_id, rv.fecha_revision desc, rv.created_at desc
  ),
  tyre_sev as (
    select ur.vehiculo_id, d.profundidad_mm,
      case
        when d.profundidad_mm <= coalesce(um.profundidad_minima_mm, uc.profundidad_minima_mm, ue.profundidad_minima_mm, 1.6) then 3
        when d.profundidad_mm <= coalesce(um.profundidad_aviso_mm,  uc.profundidad_aviso_mm,  ue.profundidad_aviso_mm,  3.0) then 2
        else 1
      end as sev
    from ultrev ur
    join revisiones_neumaticos_detalle d on d.revision_id = ur.revision_id and d.profundidad_mm is not null
    join tc_neumaticos n on n.id = d.neumatico_id
    left join tc_config_umbrales ue on ue.empresa_id = n.empresa_id
    left join tc_config_umbrales_medida um on um.empresa_id = n.empresa_id and tc_norm_medida(um.medida) = tc_norm_medida(n.medida)
    left join tc_cat_medidas_neumatico cm on tc_norm_medida(cm.valor) = tc_norm_medida(n.medida)
    left join tc_config_umbrales_categoria uc on uc.empresa_id = n.empresa_id and uc.categoria = cm.categoria
  ),
  veh_sev as (select vehiculo_id, max(sev) as sev, min(profundidad_mm) as prof_min from tyre_sev group by vehiculo_id),
  clasif as (
    select v.id, v.matricula, v.numero_unidad, ur.fecha_revision, vs.prof_min,
      case
        when ur.vehiculo_id is null then 'pendiente'
        when vs.sev is null then 'revisar'
        when vs.sev = 3 then 'urgente'
        when vs.sev = 2 then 'revisar'
        else 'correcto'
      end as estado
    from veh v
    left join ultrev ur on ur.vehiculo_id = v.id
    left join veh_sev vs on vs.vehiculo_id = v.id
  )
  select json_build_object(
    'total', (select count(*) from veh),
    'correcto', (select count(*) from clasif where estado = 'correcto'),
    'revisar', (select count(*) from clasif where estado = 'revisar'),
    'urgente', (select count(*) from clasif where estado = 'urgente'),
    'pendiente', (select count(*) from clasif where estado = 'pendiente'),
    'evolucion', (
      select coalesce(json_agg(row_to_json(e) order by e.mes), '[]'::json) from (
        select to_char(date_trunc('month', rv.fecha_revision), 'YYYY-MM') as mes, count(*)::int as revisiones
        from revisiones_vehiculo rv
        where rv.estado_revision <> 'anulada' and (p_empresa is null or rv.empresa_id = p_empresa)
          and rv.fecha_revision >= (date_trunc('month', now()) - interval '5 months')::date
        group by 1
      ) e
    ),
    -- Los vehículos uno a uno, con la misma clasificación de los recuentos de
    -- arriba: es lo que deja ver CUÁLES son al pulsar un cuadro. La
    -- profundidad es la más baja de su última revisión, que es la que decide.
    'vehiculos', (
      select coalesce(json_agg(json_build_object(
               'vehiculo_id', c.id, 'matricula', c.matricula, 'numero_unidad', c.numero_unidad,
               'estado', c.estado, 'prof_min', c.prof_min, 'fecha_revision', c.fecha_revision
             ) order by c.matricula), '[]'::json)
      from clasif c
    )
  );
$function$$fn$;

  v_empresa uuid;
  v_pieza text;
  v_quien text;
  v_usuario uuid;
  v_json json;
  v_t0 timestamptz;
  v_ms numeric;
  v_limite numeric;
  v_tiempos text;
  v_cuadre text;
  v_resultado text := '';
begin
  -- El editor de Supabase manda el texto con saltos de Windows: se quitan
  -- para que las funciones queden guardadas limpias.
  v_fn_cubo := replace(v_fn_cubo, chr(13), '');
  v_fn_operaciones := replace(v_fn_operaciones, chr(13), '');
  v_fn_flota := replace(v_fn_flota, chr(13), '');

  -- La empresa con más revisiones: es con la que más tarda.
  select rv.empresa_id into v_empresa
    from revisiones_vehiculo rv group by rv.empresa_id order by count(*) desc limit 1;

  foreach v_pieza in array array['inventario', 'operaciones', 'estado de flota'] loop
    begin
      -- 1. Instalar.
      if v_pieza = 'inventario' then
        execute v_fn_cubo;
        execute 'grant execute on function tc_informes_inventario_cubo(uuid) to authenticated';
        execute 'grant execute on function tc_informes_inventario_cubo(uuid) to service_role';
      elsif v_pieza = 'operaciones' then
        execute v_fn_operaciones;
      else
        execute v_fn_flota;
      end if;

      -- 2. Que cuadre. Sin RLS todavía, contra las tablas: lo que devuelve
      --    tiene que sumar lo mismo que lo que cuenta.
      v_cuadre := null;
      if v_pieza = 'inventario' then
        select tc_informes_inventario_cubo(v_empresa) into v_json;
        if (select coalesce(sum((x->>'n')::int), 0) from json_array_elements(v_json) x)
           <> (select count(*) from tc_neumaticos n where n.empresa_id = v_empresa) then
          v_cuadre := 'el cubo no suma los neumáticos de la empresa';
        end if;
      elsif v_pieza = 'operaciones' then
        select tc_informes_operaciones(v_empresa, date '2000-01-01', current_date) into v_json;
        if (select coalesce(sum((x->>'n')::int), 0) from json_array_elements(v_json->'por_tipo_motivo') x) <> (v_json->>'total')::int
           or (select coalesce(sum((x->>'n')::int), 0) from json_array_elements(v_json->'evolucion_tipo') x) <> (v_json->>'total')::int then
          v_cuadre := 'el reparto por tipo no suma el total de operaciones';
        end if;
      else
        select tc_informes_estado_flota(v_empresa) into v_json;
        if json_array_length(v_json->'vehiculos') <> (v_json->>'total')::int
           or (select count(*) from json_array_elements(v_json->'vehiculos') x where x->>'estado' = 'revisar') <> (v_json->>'revisar')::int
           or (select count(*) from json_array_elements(v_json->'vehiculos') x where x->>'estado' = 'urgente') <> (v_json->>'urgente')::int
           or (select count(*) from json_array_elements(v_json->'vehiculos') x where x->>'estado' = 'pendiente') <> (v_json->>'pendiente')::int
           or (select count(*) from json_array_elements(v_json->'vehiculos') x where x->>'estado' = 'correcto') <> (v_json->>'correcto')::int then
          v_cuadre := 'la lista de vehículos no cuadra con los recuentos';
        end if;
      end if;
      if v_cuadre is not null then
        raise exception using errcode = 'MB001', message = v_cuadre;
      end if;

      -- 3. El tiempo: como la aplicación, con RLS y con usuarios de verdad.
      v_tiempos := '';
      foreach v_quien in array array['superadmin', 'de la empresa', 'operador'] loop
        v_usuario := case v_quien
          when 'superadmin' then (select u.id from tc_usuarios u where u.es_superadmin order by u.id limit 1)
          when 'de la empresa' then (select u.id from tc_usuarios u
                                      where u.empresa_id = v_empresa and not u.es_superadmin order by u.id limit 1)
          else (select oe.usuario_id from tc_operador_empresas oe where oe.empresa_id = v_empresa order by 1 limit 1)
        end;
        continue when v_usuario is null;

        perform set_config('request.jwt.claims',
                           json_build_object('sub', v_usuario, 'role', 'authenticated')::text, true);
        set local role authenticated;

        v_t0 := clock_timestamp();
        if v_pieza = 'inventario' then
          select tc_informes_inventario_cubo(v_empresa) into v_json;
        elsif v_pieza = 'operaciones' then
          select tc_informes_operaciones(v_empresa, date '2000-01-01', current_date) into v_json;
        else
          select tc_informes_estado_flota(v_empresa) into v_json;
        end if;
        v_ms := round(extract(epoch from clock_timestamp() - v_t0) * 1000);

        reset role;

        v_tiempos := v_tiempos || format('%s %s ms, ', v_quien, v_ms);

        -- El límite va a una variable: un `case … then` dentro de la condición
        -- de un `if` le corta la condición al analizador de PL/pgSQL.
        v_limite := c_limite_ms;
        if v_quien = 'operador' then
          v_limite := c_limite_operador_ms;
        end if;
        if v_ms > v_limite then
          raise exception using errcode = 'MB001',
            message = format('no entra en el margen (%s)', rtrim(v_tiempos, ', '));
        end if;
      end loop;

      v_resultado := v_resultado || format('%s: OK (%s). ', upper(v_pieza), rtrim(v_tiempos, ', '));

    exception when sqlstate 'MB001' then
      -- El sub-bloque se ha deshecho entero: la función vuelve a ser la que
      -- había —o a no existir, si era la nueva— y el rol, el de antes.
      v_resultado := v_resultado || format('%s: NO INSTALADA, se queda como estaba: %s. ', upper(v_pieza), sqlerrm);
    end;
  end loop;

  perform set_config('mobilink.medicion', v_resultado, false);
  raise notice '%', v_resultado;
end
$migracion$;

-- Qué ha pasado con cada una. Aquí no se llama a ninguna de las tres: si una
-- no se ha instalado, llamarla daría un error que —yendo todo en una
-- transacción— se llevaría por delante a las que sí.
select current_setting('mobilink.medicion', true) as resultado,
       to_regprocedure('tc_informes_inventario_cubo(uuid)') is not null as hay_cubo_de_inventario;
