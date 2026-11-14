-- Las alertas, agrupadas por vehículo y con el plano de sus ruedas.
--
-- ── Qué pide la pantalla ────────────────────────────────────────────────────
--
-- Informes → Alertas enseña hoy UNA FILA POR RUEDA: 195 filas para 64
-- vehículos. El 9586HBH ocupa cuatro seguidas, mezcladas con las de otros
-- autobuses, así que hay que ir juntándolas con la vista. Lo que se pide es
-- una tarjeta por vehículo, con la foto de su chasis, cada rueda marcada y la
-- fecha de la medición.
--
-- Para eso no basta con añadirle una columna a `tc_informes_alertas`: esa
-- función devuelve SOLO las ruedas que avisan, y la tarjeta tiene que pintar
-- TODAS las del vehículo —las buenas en verde y las que faltan en gris—.
-- Por eso una función nueva, y la vieja se queda como está para la lista y
-- para los vehículos sin revisar, que no tienen ruedas que pintar.
--
-- ── Una fila por rueda, no por alerta ───────────────────────────────────────
--
-- Devuelve las posiciones ACTIVAS de todos los vehículos que tienen al menos
-- una incidencia: una goma en su mínimo o por debajo, o un aviso de presión
-- abierto. Un vehículo sin ninguna de las dos cosas no sale.
--
-- La posición sin neumático montado SÍ sale, con `neumatico_id` a null: en el
-- plano es un hueco, y un hueco no es lo mismo que una goma sin medir. Las dos
-- cosas se distinguen en la pantalla, y las dos son verdad.
--
-- ── El mínimo sale del mismo sitio que en el informe ────────────────────────
--
-- Mismo `coalesce` que `tc_informes_alertas`: override por medida, por
-- categoría, por empresa, luego la regla por llanta de
-- `tc_profundidad_minima_por_llanta` y por último 1,6. Copiarlo es feo, pero
-- lo alternativo —que cada pantalla tenga su criterio— ya pasó una vez: el PDF
-- del parte sigue con 1,6 fijo y por eso dice otra cosa que el informe.
-- Mientras esté copiado, que al menos sea la misma cadena, carácter por
-- carácter.
--
-- ── Qué vehículos NO pueden salir ──────────────────────────────────────────
--
-- Los que no tienen `tipo_vehiculo_id`, porque las posiciones cuelgan del
-- tipo: sin tipo no hay plano que pintar. Hoy son 79 en Plana y NINGUNO de
-- los 64 con incidencia, así que no se pierde ni una alerta; si mañana uno de
-- ésos avisa, seguirá saliendo en la lista de `tc_informes_alertas`.
--
-- ── Los de baja NO salen ───────────────────────────────────────────────────
--
-- `v.activo`, pedido expresamente. Son 8 vehículos con 11 ruedas gastadas: a
-- un autobús dado de baja no se le cambian las gomas, así que en una pantalla
-- que dice «cambiar ya» solo hacen ruido.
--
-- Eso deja esta función en 80 ruedas donde `tc_informes_alertas` sigue
-- diciendo 91, porque aquélla no filtra por `activo`. No se toca: ya no se
-- pinta en ninguna pantalla —la de Alertas usa esta— y sigue sirviendo a los
-- vehículos sin revisar, que sí filtran por activo por su cuenta.
--
-- `en_seguimiento` no se mira: de los 65 vehículos con incidencia, los 65
-- están en seguimiento. Añadir una condición que hoy no quita ni una fila
-- sería una regla sin probar escondida en la consulta.

-- La función puede existir ya con OTRAS columnas de vuelta: la primera versión
-- devolvía `vehiculo_activo` y llegó a pasarse a producción. `create or
-- replace` no deja cambiar el tipo de vuelta («cannot change return type of
-- existing function»), así que primero se quita. Los permisos se vuelven a dar
-- más abajo, que el drop se los lleva.
drop function if exists tc_informes_alertas_vehiculos(uuid);

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
  with ult as (
    -- La última medición de cada goma, con su fecha: la fecha es justo lo que
    -- le faltaba al informe para poder decir «medido el 11/11».
    select distinct on (d.neumatico_id)
           d.neumatico_id, d.profundidad_mm, rv.fecha_revision
    from revisiones_neumaticos_detalle d
    join revisiones_vehiculo rv on rv.id = d.revision_id
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
    -- Un lateral y no un join: si alguna vez hubiera dos avisos abiertos para
    -- la misma rueda, un join duplicaría la rueda entera en el plano.
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

-- ── Comprobación ───────────────────────────────────────────────────────────
--
-- 1. Tiene que devolver 57 vehículos y 80 ruedas para cambiar: los 65 y las 91
--    del informe, menos los 8 vehículos de baja con sus 11 ruedas.

select count(distinct vehiculo_id) as vehiculos,
       count(*) filter (where profundidad_mm is not null and profundidad_mm <= minimo_mm) as cambiar_ya,
       count(*) filter (where presion_aviso_at is not null) as presion,
       count(*) filter (where neumatico_id is null) as posiciones_vacias,
       count(*) filter (where neumatico_id is not null and profundidad_mm is null) as sin_medir,
       count(*) as filas
  from tc_informes_alertas_vehiculos('a51c9662-4b6f-4681-8e2b-599e109659eb'::uuid);

-- 2. Y que cuadra rueda a rueda con `tc_informes_alertas`: lo único que puede
--    salir aquí son las 11 ruedas de los 8 vehículos dados de baja, que están
--    en el informe y no aquí. Ni una más, y ninguna con otra profundidad.

select coalesce(a.matricula, b.matricula) as matricula,
       coalesce(a.posicion, b.codigo_posicion) as posicion,
       a.valor as en_el_informe, b.profundidad_mm as en_el_plano
  from (select matricula, posicion, valor
          from tc_informes_alertas('a51c9662-4b6f-4681-8e2b-599e109659eb'::uuid)
         where tipo = 'bajo_minimo') a
  full join (select matricula, codigo_posicion, profundidad_mm
               from tc_informes_alertas_vehiculos('a51c9662-4b6f-4681-8e2b-599e109659eb'::uuid)
              where profundidad_mm is not null and profundidad_mm <= minimo_mm) b
    on b.matricula = a.matricula and b.codigo_posicion = a.posicion
 where a.matricula is null or b.matricula is null or a.valor <> b.profundidad_mm;
