-- La profundidad solo cuenta si viene de una revisión que midió TODAS sus ruedas.
--
-- ── El caso que lo destapó ──────────────────────────────────────────────────
--
-- El 4300GZD, rueda E2_IZQ_INT:
--
--     30/10/2026   12,7 mm   (revisión con las seis ruedas medidas)
--     05/11/2026    1,9 mm   (revisión con UNA sola rueda medida)
--
-- En seis días no se gastan 11 mm. La lectura del 05/11 es del arco, y ese día
-- llovía: el láser no lee la goma mojada. La aplicación se quedaba con la
-- última lectura de cada neumático, así que daba por buena la mala y sacaba
-- una alerta de «cambiar ya» sobre una goma que lleva 12 mm.
--
-- ── No es un caso aislado, y se mide ───────────────────────────────────────
--
-- Comparando cada lectura con la anterior de la misma goma, desde septiembre:
--
--     de revisión COMPLETA   31.397 lecturas   salto medio −0,01 mm   0,9 % cae >2 mm
--     de revisión PARCIAL     3.435 lecturas   salto medio −0,50 mm   9,3 % cae >2 mm
--
-- Diez veces más desplomes, y 217 de esas lecturas bajan más de 5 mm de una
-- revisión a la siguiente, cosa que no le pasa a un neumático en unos días.
--
-- Y por días, el patrón de la lluvia se ve solo:
--
--     02/11   100 revisiones    88 completas
--     03/11   143 revisiones     6 completas   ← llovía
--     04/11   137 revisiones    96 completas
--     05/11   137 revisiones    58 completas   ← llovía
--     06/11   140 revisiones   100 completas
--
-- ── La regla ────────────────────────────────────────────────────────────────
--
-- Una revisión vale para la profundidad cuando TODAS sus filas de detalle
-- traen profundidad. Si le falta una, no se usa ninguna de las suyas y el
-- vehículo se queda con su última revisión completa.
--
-- No se filtra por fecha ni por «el arco»: la señal es estructural y vale para
-- el día que llueva el año que viene, para una revisión a mano que se quedó a
-- medias y para cualquier otro origen. Poner «3 y 5 de noviembre» en la
-- consulta sería arreglar estos dos días y ninguno más.
--
-- De las dos formas de contar la completitud —todas las filas, o solo las que
-- tienen neumático— se usa la primera: se diferencian en 8 revisiones de
-- 11.461, y la segunda tira además las 967 revisiones cuyo detalle no guardó
-- el `neumatico_id` y se atribuye por posición en la ficha.
--
-- ── La PRESIÓN no se toca ───────────────────────────────────────────────────
--
-- El arco mide bien la presión con lluvia: el 03/11 sacó las seis presiones de
-- cada vehículo y ninguna profundidad. Esto va solo de profundidad.
--
-- ── Lo que cambia en Plana ──────────────────────────────────────────────────
--
--     ruedas «cambiar ya»                                80 → 71
--     vehículos con goma gastada                         56 → 46
--     gomas que pierden su número y pasan a «sin medir»   57 de 3.852
--
-- Esas 57 tenían su única medición en una revisión parcial. Decir «sin medir»
-- es lo que hay, y es mejor que enseñar un número que no se sostiene.

-- ── 1. La función de las alertas por vehículo ──────────────────────────────

create or replace function tc_informes_alertas_vehiculos(p_empresa uuid default null)
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
  with completas as (
    -- Las revisiones que midieron todas sus ruedas. Las demás no cuentan para
    -- la profundidad: ver la cabecera de esta migración.
    select d.revision_id
    from revisiones_neumaticos_detalle d
    where p_empresa is null or d.empresa_id = p_empresa
    group by d.revision_id
    having count(*) = count(d.profundidad_mm)
  ),
  ult as (
    select distinct on (d.neumatico_id)
           d.neumatico_id, d.profundidad_mm, rv.fecha_revision
    from revisiones_neumaticos_detalle d
    join revisiones_vehiculo rv on rv.id = d.revision_id
    join completas c on c.revision_id = rv.id
    where d.neumatico_id is not null and d.profundidad_mm is not null
      and rv.estado_revision <> 'anulada'
      and (p_empresa is null or d.empresa_id = p_empresa)
    order by d.neumatico_id, rv.fecha_revision desc, rv.created_at desc
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
$function$;

grant execute on function tc_informes_alertas_vehiculos(uuid) to authenticated;
grant execute on function tc_informes_alertas_vehiculos(uuid) to service_role;

-- ── 2. Y el mismo criterio en el informe de alertas de toda la vida ─────────
--
-- `tc_informes_alertas` tiene el mismo `ult` y el mismo problema. Ya no se
-- pinta en ninguna pantalla —la de Alertas usa la función de arriba— pero
-- sigue ahí para quien la llame, y una función que devuelve profundidades
-- malas es una trampa esperando. Se parchea solo ese trozo, sin reescribirla
-- entera, para no llevarse por delante nada que haya cambiado otra sesión.

do $migracion$
declare
  v_def text;
  v_ancla text;
  v_veces int;
begin
  select replace(pg_get_functiondef(p.oid), chr(13), '')
    into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'tc_informes_alertas';

  if v_def is null then
    raise exception 'No existe tc_informes_alertas';
  end if;

  v_ancla := '  with ult as (
    select distinct on (d.neumatico_id) d.neumatico_id, d.profundidad_mm
    from revisiones_neumaticos_detalle d
    join revisiones_vehiculo rv on rv.id = d.revision_id
    where d.neumatico_id is not null and d.profundidad_mm is not null
      and rv.estado_revision <> ''anulada'' and (p_empresa is null or d.empresa_id = p_empresa)
    order by d.neumatico_id, rv.fecha_revision desc, rv.created_at desc
  ),';

  -- Se cuenta por diferencia de longitud y no con regexp: el anclaje lleva
  -- `||` y `(`, que en una expresión regular son alternancia y grupo. Esa
  -- lección costó una migración.
  v_veces := (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla);
  if v_veces <> 1 then
    raise exception 'Esperaba 1 vez el bloque ult y encontré %', v_veces;
  end if;

  v_def := replace(v_def, v_ancla, '  with completas as (
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
  ),');

  execute v_def;
end
$migracion$;

-- ── Comprobación ───────────────────────────────────────────────────────────
--
-- 1. El caso del 4300GZD: su E2_IZQ_INT tiene que volver a 12,7 mm del 30/10 y
--    desaparecer de las alertas.

select r.codigo_posicion, r.profundidad_mm, r.minimo_mm, r.fecha_revision
  from tc_informes_alertas_vehiculos('a51c9662-4b6f-4681-8e2b-599e109659eb'::uuid) r
 where r.matricula = '4300GZD';

-- 2. Las cifras nuevas: 71 ruedas para cambiar (antes 80) en 46 vehículos
--    (antes 56), más el del aviso de presión: 47 tarjetas.

select count(distinct vehiculo_id) as vehiculos,
       count(*) filter (where profundidad_mm is not null and profundidad_mm <= minimo_mm) as cambiar_ya,
       count(*) filter (where presion_aviso_at is not null) as presion,
       count(*) filter (where neumatico_id is not null and profundidad_mm is null) as sin_medir
  from tc_informes_alertas_vehiculos('a51c9662-4b6f-4681-8e2b-599e109659eb'::uuid);

-- 3. Y que las dos funciones cuentan lo mismo, cada una en su universo: 82 el
--    informe viejo (que no filtra los vehículos de baja: 71 + 11 suyas) y 71
--    la pantalla nueva.

select (select count(*) from tc_informes_alertas('a51c9662-4b6f-4681-8e2b-599e109659eb'::uuid)
         where tipo = 'bajo_minimo') as informe_viejo,
       (select count(*) from tc_informes_alertas_vehiculos('a51c9662-4b6f-4681-8e2b-599e109659eb'::uuid)
         where profundidad_mm is not null and profundidad_mm <= minimo_mm) as pantalla_nueva;
