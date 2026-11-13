-- Las lecturas siguen a la posición: una goma hereda las mediciones de su
-- sitio desde el día siguiente a su montaje, estén a nombre de quien estén.
--
-- ── El caso ─────────────────────────────────────────────────────────────────
--
-- El 4310JYJ salía en la ficha con el eje 1 sin profundidades, y el arco las
-- lleva midiendo a diario. Las gomas montadas (NT-2026-001459/60) se dieron
-- de alta el 10/11 con su fecha de montaje real, 05/08. Todas las lecturas de
-- esas posiciones desde agosto están guardadas a nombre de las anteriores
-- (4310JYJ-P1/P2), que es lo que la base creía montado cuando pasó por el
-- arco. Para el sistema, las gomas actuales tenían cero mediciones.
--
-- No es un caso suelto: 358 gomas de 101 vehículos están igual.
--
-- ── Y un hueco que ya había, que esto tapa de paso ──────────────────────────
--
-- Hay revisiones que guardan la fila de detalle SIN neumático: 6.500 filas,
-- 6.020 con profundidad. La ficha las atribuye por posición desde siempre; el
-- informe de alertas las ignoraba, porque solo miraba filas con
-- `neumatico_id`. Resultado: 9 ruedas medidas en noviembre por debajo de su
-- mínimo NO salían en «cambiar ya» (el 1062HWZ, E1_DER, a 2,6 mm el 12/11,
-- figuraba con los 5,9 de septiembre).
--
-- ── La regla ────────────────────────────────────────────────────────────────
--
-- A un neumático montado le valen:
--
--   · las lecturas guardadas a su nombre, y
--   · las de su vehículo y posición con fecha POSTERIOR a su fecha de montaje,
--     estén a nombre de otro neumático o de ninguno.
--
-- De todas, manda la más reciente —siempre de revisión completa—.
--
-- POSTERIOR y no «desde»: la lectura del mismo día del montaje suele ser la de
-- la goma VIEJA, medida justo antes de cambiarla. El 9232HMK lo demuestra: dos
-- gomas nuevas montadas el 17/08 habrían heredado los 3,9 y 3,7 mm que se les
-- midieron ese mismo día a las que salían, y habrían estrenado un «cambiar ya».
--
-- El riesgo que queda, sabido y aceptado: si una fecha de montaje está MAL
-- puesta —anterior a la real—, la goma hereda mediciones de la que había.
--
-- ── Lo que cambia en Plana ──────────────────────────────────────────────────
--
--     ruedas «cambiar ya»   71 → 81   (9 que el informe se perdía + 1 heredada)
--     tarjetas              47 → 54
--     gomas que recuperan su medición   358
--
-- ── Se prueba sola, como la anterior ────────────────────────────────────────
--
-- Mismo bloque único: instala, se hace pasar por un superadmin, un usuario de
-- la empresa y un operador, cronometra con RLS, y si no entra en el margen
-- deshace y deja la versión que había (que ya pasó esta misma prueba).

do $migracion$
declare
  c_limite_ms constant numeric := 4000;
  c_limite_operador_ms constant numeric := 7000;

  v_fn_posicion text := $fn$create function tc_informes_alertas_vehiculos(p_empresa uuid default null)
returns table (
  vehiculo_id uuid,
  matricula text,
  numero_unidad text,
  tipo_vehiculo text,
  config_ejes text,
  imagen_chasis_url text,
  posicion_id uuid,
  codigo_posicion text,
  eje integer,
  lado text,
  interior_exterior text,
  neumatico_id uuid,
  codigo text,
  medida text,
  profundidad_mm numeric,
  minimo_mm numeric,
  fecha_revision date,
  presion_bar numeric,
  presion_recomendada_bar numeric,
  desviacion_pct numeric,
  presion_avisos integer,
  presion_aviso_at timestamptz
)
language sql
stable
set jit to 'off'
set work_mem to '16MB'
as $function$
  with medidas as (
    -- Una sola pasada por el detalle: de cada fila se sabe, con una ventana
    -- sobre su revisión, si esa revisión midió todas sus ruedas.
    select d.neumatico_id, d.posicion_id, rv.vehiculo_id, d.profundidad_mm,
           rv.fecha_revision, rv.created_at,
           (count(*) over w = count(d.profundidad_mm) over w) as completa
    from revisiones_neumaticos_detalle d
    join revisiones_vehiculo rv on rv.id = d.revision_id
    where rv.estado_revision <> 'anulada'
      and (p_empresa is null or d.empresa_id = p_empresa)
    window w as (partition by d.revision_id)
  ),
  buenas as (
    select x.neumatico_id, x.posicion_id, x.vehiculo_id, x.profundidad_mm, x.fecha_revision, x.created_at
    from medidas x
    where x.completa and x.profundidad_mm is not null
  ),
  atribuidas as (
    -- Las lecturas guardadas a nombre del neumático...
    select b.neumatico_id, b.profundidad_mm, b.fecha_revision, b.created_at
    from buenas b
    where b.neumatico_id is not null
    union all
    -- ...y las de SU POSICIÓN posteriores al día en que se montó en ella, estén
    -- a nombre de quien estén o de nadie. Una goma que se da de alta tarde,
    -- con su fecha de montaje real, tiene sus mediciones a nombre de la
    -- anterior; y hay revisiones que guardan la fila sin neumático.
    --
    -- POSTERIORES, no «desde»: la lectura del mismo día del montaje suele ser
    -- la de la goma VIEJA, medida justo antes de cambiarla. Heredarla le
    -- pondría un «cambiar ya» a un neumático recién estrenado.
    select mo.neumatico_id, b.profundidad_mm, b.fecha_revision, b.created_at
    from buenas b
    join tc_montajes_actuales mo
      on mo.vehiculo_id = b.vehiculo_id and mo.posicion_id = b.posicion_id
    where b.fecha_revision > mo.fecha_montaje
      and b.neumatico_id is distinct from mo.neumatico_id
  ),
  ult as (
    select distinct on (a.neumatico_id)
           a.neumatico_id, a.profundidad_mm, a.fecha_revision
    from atribuidas a
    order by a.neumatico_id, a.fecha_revision desc, a.created_at desc
  ),
  ruedas as (
    select v.id as vehiculo_id, v.matricula, v.numero_unidad,
           tv.nombre as tipo_vehiculo,
           ce.nombre as config_ejes,
           coalesce(ce.imagen_chasis_url, tv.imagen_chasis_url) as imagen_chasis_url,
           p.id as posicion_id, p.codigo_posicion, p.eje, p.lado, p.interior_exterior,
           m.neumatico_id, coalesce(n.codigo_interno, n.numero_serie) as codigo, n.medida,
           u.profundidad_mm, u.fecha_revision,
           coalesce(um.profundidad_minima_mm, uc.profundidad_minima_mm, ue.profundidad_minima_mm,
                    tc_profundidad_minima_por_llanta(n.medida), 1.6) as minimo_mm,
           pr.presion_bar, pr.presion_recomendada_bar, pr.desviacion_pct,
           pr.avisos as presion_avisos, pr.ultimo_aviso_at as presion_aviso_at
    from tc_vehiculos v
    join tc_tipos_vehiculo tv on tv.id = v.tipo_vehiculo_id
    join tc_posiciones_vehiculo p on p.tipo_vehiculo_id = v.tipo_vehiculo_id and p.activo
    left join tc_config_ejes ce on ce.id = v.config_ejes_id
    left join tc_montajes_actuales m on m.vehiculo_id = v.id and m.posicion_id = p.id
    left join tc_neumaticos n on n.id = m.neumatico_id
    left join ult u on u.neumatico_id = m.neumatico_id
    left join tc_config_umbrales ue on ue.empresa_id = v.empresa_id
    left join tc_config_umbrales_medida um on um.empresa_id = v.empresa_id
         and tc_norm_medida(um.medida) = tc_norm_medida(n.medida)
    left join tc_cat_medidas_neumatico cm on tc_norm_medida(cm.valor) = tc_norm_medida(n.medida)
    left join tc_config_umbrales_categoria uc on uc.empresa_id = v.empresa_id
         and uc.categoria = cm.categoria
    left join lateral (
      select a.presion_bar, a.presion_recomendada_bar, a.desviacion_pct, a.avisos, a.ultimo_aviso_at
      from tc_alertas_presion a
      where a.vehiculo_id = v.id and a.posicion_id = p.id and a.estado = 'abierta'
      order by a.ultimo_aviso_at desc nulls last
      limit 1
    ) pr on true
    where v.activo and (p_empresa is null or v.empresa_id = p_empresa)
  ),
  con_incidencias as (
    select r.*,
           sum(case when (r.profundidad_mm is not null and r.profundidad_mm <= r.minimo_mm)
                      or r.presion_aviso_at is not null
                    then 1 else 0 end) over (partition by r.vehiculo_id) as incidencias
    from ruedas r
  )
  select vehiculo_id, matricula, numero_unidad, tipo_vehiculo, config_ejes, imagen_chasis_url,
         posicion_id, codigo_posicion, eje, lado, interior_exterior,
         neumatico_id, codigo, medida,
         profundidad_mm, minimo_mm, fecha_revision,
         presion_bar, presion_recomendada_bar, desviacion_pct, presion_avisos, presion_aviso_at
  from con_incidencias
  where incidencias > 0
  order by matricula, eje, lado desc, interior_exterior nulls first;
$function$$fn$;

  v_fn_anterior text := $fn$create function tc_informes_alertas_vehiculos(p_empresa uuid default null)
returns table (
  vehiculo_id uuid,
  matricula text,
  numero_unidad text,
  tipo_vehiculo text,
  config_ejes text,
  imagen_chasis_url text,
  posicion_id uuid,
  codigo_posicion text,
  eje integer,
  lado text,
  interior_exterior text,
  neumatico_id uuid,
  codigo text,
  medida text,
  profundidad_mm numeric,
  minimo_mm numeric,
  fecha_revision date,
  presion_bar numeric,
  presion_recomendada_bar numeric,
  desviacion_pct numeric,
  presion_avisos integer,
  presion_aviso_at timestamptz
)
language sql
stable
set jit to 'off'
set work_mem to '16MB'
as $function$
  with medidas as (
    -- Una sola pasada por el detalle: de cada fila se sabe, con una ventana
    -- sobre su revisión, si esa revisión midió todas sus ruedas. Antes esto era
    -- un segundo recorrido del detalle y un cruce contra él, y con el RLS de
    -- por medio se iba de los 8 s que tiene la aplicación.
    select d.neumatico_id, d.profundidad_mm, rv.fecha_revision, rv.created_at,
           (count(*) over w = count(d.profundidad_mm) over w) as completa
    from revisiones_neumaticos_detalle d
    join revisiones_vehiculo rv on rv.id = d.revision_id
    where rv.estado_revision <> 'anulada'
      and (p_empresa is null or d.empresa_id = p_empresa)
    window w as (partition by d.revision_id)
  ),
  ult as (
    select distinct on (x.neumatico_id)
           x.neumatico_id, x.profundidad_mm, x.fecha_revision
    from medidas x
    where x.completa and x.neumatico_id is not null and x.profundidad_mm is not null
    order by x.neumatico_id, x.fecha_revision desc, x.created_at desc
  ),
  ruedas as (
    select v.id as vehiculo_id, v.matricula, v.numero_unidad,
           tv.nombre as tipo_vehiculo,
           ce.nombre as config_ejes,
           coalesce(ce.imagen_chasis_url, tv.imagen_chasis_url) as imagen_chasis_url,
           p.id as posicion_id, p.codigo_posicion, p.eje, p.lado, p.interior_exterior,
           m.neumatico_id, coalesce(n.codigo_interno, n.numero_serie) as codigo, n.medida,
           u.profundidad_mm, u.fecha_revision,
           coalesce(um.profundidad_minima_mm, uc.profundidad_minima_mm, ue.profundidad_minima_mm,
                    tc_profundidad_minima_por_llanta(n.medida), 1.6) as minimo_mm,
           pr.presion_bar, pr.presion_recomendada_bar, pr.desviacion_pct,
           pr.avisos as presion_avisos, pr.ultimo_aviso_at as presion_aviso_at
    from tc_vehiculos v
    join tc_tipos_vehiculo tv on tv.id = v.tipo_vehiculo_id
    join tc_posiciones_vehiculo p on p.tipo_vehiculo_id = v.tipo_vehiculo_id and p.activo
    left join tc_config_ejes ce on ce.id = v.config_ejes_id
    left join tc_montajes_actuales m on m.vehiculo_id = v.id and m.posicion_id = p.id
    left join tc_neumaticos n on n.id = m.neumatico_id
    left join ult u on u.neumatico_id = m.neumatico_id
    left join tc_config_umbrales ue on ue.empresa_id = v.empresa_id
    left join tc_config_umbrales_medida um on um.empresa_id = v.empresa_id
         and tc_norm_medida(um.medida) = tc_norm_medida(n.medida)
    left join tc_cat_medidas_neumatico cm on tc_norm_medida(cm.valor) = tc_norm_medida(n.medida)
    left join tc_config_umbrales_categoria uc on uc.empresa_id = v.empresa_id
         and uc.categoria = cm.categoria
    left join lateral (
      select a.presion_bar, a.presion_recomendada_bar, a.desviacion_pct, a.avisos, a.ultimo_aviso_at
      from tc_alertas_presion a
      where a.vehiculo_id = v.id and a.posicion_id = p.id and a.estado = 'abierta'
      order by a.ultimo_aviso_at desc nulls last
      limit 1
    ) pr on true
    where v.activo and (p_empresa is null or v.empresa_id = p_empresa)
  ),
  con_incidencias as (
    select r.*,
           sum(case when (r.profundidad_mm is not null and r.profundidad_mm <= r.minimo_mm)
                      or r.presion_aviso_at is not null
                    then 1 else 0 end) over (partition by r.vehiculo_id) as incidencias
    from ruedas r
  )
  select vehiculo_id, matricula, numero_unidad, tipo_vehiculo, config_ejes, imagen_chasis_url,
         posicion_id, codigo_posicion, eje, lado, interior_exterior,
         neumatico_id, codigo, medida,
         profundidad_mm, minimo_mm, fecha_revision,
         presion_bar, presion_recomendada_bar, desviacion_pct, presion_avisos, presion_aviso_at
  from con_incidencias
  where incidencias > 0
  order by matricula, eje, lado desc, interior_exterior nulls first;
$function$$fn$;

  v_ult_original text := '  with ult as (
    select distinct on (d.neumatico_id) d.neumatico_id, d.profundidad_mm
    from revisiones_neumaticos_detalle d
    join revisiones_vehiculo rv on rv.id = d.revision_id
    where d.neumatico_id is not null and d.profundidad_mm is not null
      and rv.estado_revision <> ''anulada'' and (p_empresa is null or d.empresa_id = p_empresa)
    order by d.neumatico_id, rv.fecha_revision desc, rv.created_at desc
  ),';

  v_ult_cruce text := '  with completas as (
    select d.revision_id
    from revisiones_neumaticos_detalle d
    where p_empresa is null or d.empresa_id = p_empresa
    group by d.revision_id
    having count(*) = count(d.profundidad_mm)
  ),
  ult as (
    select distinct on (d.neumatico_id) d.neumatico_id, d.profundidad_mm
    from revisiones_neumaticos_detalle d
    join revisiones_vehiculo rv on rv.id = d.revision_id
    join completas c on c.revision_id = rv.id
    where d.neumatico_id is not null and d.profundidad_mm is not null
      and rv.estado_revision <> ''anulada'' and (p_empresa is null or d.empresa_id = p_empresa)
    order by d.neumatico_id, rv.fecha_revision desc, rv.created_at desc
  ),';

  v_ult_ventana text := '  with medidas as (
    select d.neumatico_id, d.profundidad_mm, rv.fecha_revision, rv.created_at,
           (count(*) over w = count(d.profundidad_mm) over w) as completa
    from revisiones_neumaticos_detalle d
    join revisiones_vehiculo rv on rv.id = d.revision_id
    where rv.estado_revision <> ''anulada'' and (p_empresa is null or d.empresa_id = p_empresa)
    window w as (partition by d.revision_id)
  ),
  ult as (
    select distinct on (x.neumatico_id) x.neumatico_id, x.profundidad_mm
    from medidas x
    where x.completa and x.neumatico_id is not null and x.profundidad_mm is not null
    order by x.neumatico_id, x.fecha_revision desc, x.created_at desc
  ),';

  v_ult_posicion text := '  with medidas as (
    select d.neumatico_id, d.posicion_id, rv.vehiculo_id, d.profundidad_mm, rv.fecha_revision, rv.created_at,
           (count(*) over w = count(d.profundidad_mm) over w) as completa
    from revisiones_neumaticos_detalle d
    join revisiones_vehiculo rv on rv.id = d.revision_id
    where rv.estado_revision <> ''anulada'' and (p_empresa is null or d.empresa_id = p_empresa)
    window w as (partition by d.revision_id)
  ),
  buenas as (
    select x.neumatico_id, x.posicion_id, x.vehiculo_id, x.profundidad_mm, x.fecha_revision, x.created_at
    from medidas x
    where x.completa and x.profundidad_mm is not null
  ),
  atribuidas as (
    select b.neumatico_id, b.profundidad_mm, b.fecha_revision, b.created_at
    from buenas b
    where b.neumatico_id is not null
    union all
    select mo.neumatico_id, b.profundidad_mm, b.fecha_revision, b.created_at
    from buenas b
    join tc_montajes_actuales mo on mo.vehiculo_id = b.vehiculo_id and mo.posicion_id = b.posicion_id
    where b.fecha_revision > mo.fecha_montaje and b.neumatico_id is distinct from mo.neumatico_id
  ),
  ult as (
    select distinct on (a.neumatico_id) a.neumatico_id, a.profundidad_mm
    from atribuidas a
    order by a.neumatico_id, a.fecha_revision desc, a.created_at desc
  ),';

  v_def text;
  v_candidato text;
  v_hecho boolean;
  v_empresa uuid;
  v_usuario uuid;
  v_quien text;
  v_t0 timestamptz;
  v_ms_vehiculos numeric;
  v_ms_informe numeric;
  v_n bigint;
  v_limite numeric;
  v_medicion text := '';
  v_intento int;
  v_destino text;
  v_fn text;
begin
  -- Pegado desde Windows el texto llega con CRLF: se le quita a todo lo que se
  -- va a comparar o a ejecutar.
  v_fn_posicion := replace(v_fn_posicion, chr(13), '');
  v_fn_anterior := replace(v_fn_anterior, chr(13), '');
  v_ult_original := replace(v_ult_original, chr(13), '');
  v_ult_cruce := replace(v_ult_cruce, chr(13), '');
  v_ult_ventana := replace(v_ult_ventana, chr(13), '');
  v_ult_posicion := replace(v_ult_posicion, chr(13), '');

  select rv.empresa_id into v_empresa
    from revisiones_vehiculo rv group by rv.empresa_id order by count(*) desc limit 1;

  -- Intento 1: con las lecturas de la posición, medida. Intento 2: la que había.
  for v_intento in 1..2 loop
    begin
      if v_intento = 1 then
        v_fn := v_fn_posicion;       v_destino := v_ult_posicion;
      else
        v_fn := v_fn_anterior;    v_destino := v_ult_ventana;
      end if;

      -- 1. La función de las tarjetas. Se quita antes: `create or replace` no
      --    deja cambiar las columnas de vuelta y ya ha tenido varias formas.
      execute 'drop function if exists tc_informes_alertas_vehiculos(uuid)';
      execute v_fn;
      execute 'grant execute on function tc_informes_alertas_vehiculos(uuid) to authenticated';
      execute 'grant execute on function tc_informes_alertas_vehiculos(uuid) to service_role';

      -- 2. El informe de siempre: se le cambia SOLO el bloque `ult`, esté como
      --    esté de las cuatro formas posibles.
      select replace(pg_get_functiondef(p.oid), chr(13), '') into v_def
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'tc_informes_alertas';
      if v_def is null then
        raise exception 'No existe tc_informes_alertas';
      end if;

      if position(v_destino in v_def) = 0 then
        v_hecho := false;
        foreach v_candidato in array array[v_ult_posicion, v_ult_ventana, v_ult_cruce, v_ult_original] loop
          -- Contado por diferencia de longitud y no con regexp: los bloques
          -- llevan `(` y `|`, que en una expresión regular son otra cosa.
          if not v_hecho
             and (length(v_def) - length(replace(v_def, v_candidato, ''))) / length(v_candidato) = 1 then
            v_def := replace(v_def, v_candidato, v_destino);
            v_hecho := true;
          end if;
        end loop;
        if not v_hecho then
          raise exception 'tc_informes_alertas no tiene ninguno de los cuatro bloques ult conocidos';
        end if;
        execute v_def;
      end if;

      -- La que había no se mide: ya pasó esta misma prueba al instalarse.
      if v_intento = 2 then
        v_medicion := 'RESERVA: se ha dejado la versión que había, sin las lecturas de la posición. '
                      || v_medicion;
        exit;
      end if;

      -- 3. La prueba: como la aplicación, con RLS y con usuarios de verdad.
      v_medicion := '';
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
        select count(*) into v_n from tc_informes_alertas_vehiculos(v_empresa);
        v_ms_vehiculos := round(extract(epoch from clock_timestamp() - v_t0) * 1000);

        v_t0 := clock_timestamp();
        select count(*) into v_n from tc_informes_alertas(v_empresa);
        v_ms_informe := round(extract(epoch from clock_timestamp() - v_t0) * 1000);

        reset role;

        v_medicion := v_medicion || format('%s: tarjetas %s ms, informe %s ms. ', v_quien, v_ms_vehiculos, v_ms_informe);

        -- El límite va a una variable: un `case … then` dentro de la condición
        -- de un `if` le corta la condición al analizador de PL/pgSQL.
        v_limite := c_limite_ms;
        if v_quien = 'operador' then
          v_limite := c_limite_operador_ms;
        end if;
        if greatest(v_ms_vehiculos, v_ms_informe) > v_limite then
          raise exception using errcode = 'MB001',
            message = 'La versión con las lecturas de la posición no entra en el margen. ' || v_medicion;
        end if;
      end loop;

      v_medicion := 'OK, con las lecturas de la posición. ' || v_medicion;
      exit;

    exception when sqlstate 'MB001' then
      -- El sub-bloque se ha deshecho entero —funciones y rol incluidos—: se
      -- guarda lo medido y se pasa al intento 2.
      v_medicion := sqlerrm;
    end;
  end loop;

  perform set_config('mobilink.medicion', v_medicion, false);
  raise notice '%', v_medicion;
end
$migracion$;

-- El resultado de la prueba y las cifras: 81 ruedas para cambiar en 54 tarjetas,
-- y el eje 1 del 4310JYJ con sus profundidades.

select current_setting('mobilink.medicion', true) as medicion,
       (select count(distinct vehiculo_id)
          from tc_informes_alertas_vehiculos('a51c9662-4b6f-4681-8e2b-599e109659eb'::uuid)) as tarjetas,
       (select count(*) from tc_informes_alertas_vehiculos('a51c9662-4b6f-4681-8e2b-599e109659eb'::uuid)
         where profundidad_mm is not null and profundidad_mm <= minimo_mm) as cambiar_ya,
       (select string_agg(codigo_posicion || '=' || coalesce(profundidad_mm::text, '-'), ' ' order by codigo_posicion)
          from tc_informes_alertas_vehiculos('a51c9662-4b6f-4681-8e2b-599e109659eb'::uuid)
         where matricula = '4310JYJ' and eje = 1) as eje1_del_4310jyj;
