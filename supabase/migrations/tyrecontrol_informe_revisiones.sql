-- ============================================================
-- SEA TyreControl — Las mediciones de un informe de revisiones, con su umbral.
--
-- El informe en PDF necesita, por cada rueda medida, el MÍNIMO que le aplica
-- a esa rueda. No es un número fijo: puede estar configurado por medida, por
-- categoría o por empresa, y si no hay nada, manda el legal de 1,6 mm.
--
-- ── Por qué una función y no tres consultas desde el servidor ───────────────
--
-- Resolver el umbral son tres `left join` y un `coalesce`. Hacerlo desde
-- Node obligaría a traerse las tres tablas de configuración y cruzarlas a
-- mano, que es la misma regla escrita por segunda vez en otro lenguaje. La
-- cadena `medida → categoría → empresa → 1,6` es exactamente la que usan
-- los informes de TyreControl, y se repite aquí tal cual para que no se
-- desincronicen.
--
-- ── Qué NO hace ─────────────────────────────────────────────────────────────
--
-- No decide qué revisiones entran, no filtra por fechas y no sabe nada de
-- clientes ni de borradores: recibe una lista de revisiones y devuelve sus
-- mediciones. Quién puede pedir qué lo decide la RLS, y qué sale en el PDF
-- lo decide el servidor.
--
-- `security invoker` a propósito: así la RLS de `revisiones_vehiculo` y de
-- `revisiones_neumaticos_detalle` sigue aplicándose. Un usuario no puede
-- sacar las mediciones de otra empresa pasando sus ids a mano.
--
-- Reversible con `drop function`. No altera ninguna tabla.
-- ============================================================

create or replace function tc_informe_revisiones_mediciones(
  p_empresa    uuid,
  p_revisiones uuid[]
) returns table (
  revision_id      uuid,
  posicion         text,
  orden            int,
  profundidad_mm   numeric,
  presion_bar      numeric,
  minimo_mm        numeric,
  aviso_mm         numeric,
  no_accesible     boolean,
  neumatico_ausente boolean,
  marca            text,
  medida           text,
  codigo_interno   text
)
language sql stable security invoker set search_path = public as $$
  select
    d.revision_id,
    coalesce(p.nombre, p.codigo_posicion)                      as posicion,
    coalesce(p.orden_revision, p.orden_visual)                 as orden,
    d.profundidad_mm,
    d.presion_bar,
    -- La misma cadena que los informes: medida, categoría, empresa, legal.
    coalesce(um.profundidad_minima_mm, uc.profundidad_minima_mm,
             ue.profundidad_minima_mm, 1.6)                    as minimo_mm,
    coalesce(um.profundidad_aviso_mm, uc.profundidad_aviso_mm,
             ue.profundidad_aviso_mm, 3.0)                     as aviso_mm,
    coalesce(d.no_accesible, false)                            as no_accesible,
    coalesce(d.neumatico_ausente, false)                       as neumatico_ausente,
    n.marca,
    n.medida,
    n.codigo_interno
  from revisiones_neumaticos_detalle d
  join revisiones_vehiculo r          on r.id = d.revision_id
  left join tc_posiciones_vehiculo p  on p.id = d.posicion_id
  left join tc_neumaticos n           on n.id = d.neumatico_id
  left join tc_config_umbrales ue     on ue.empresa_id = r.empresa_id
  left join tc_cat_medidas_neumatico cm on lower(cm.valor) = lower(n.medida)
  left join tc_config_umbrales_medida um
         on um.empresa_id = r.empresa_id and lower(um.medida) = lower(n.medida)
  left join tc_config_umbrales_categoria uc
         on uc.empresa_id = r.empresa_id and uc.categoria = cm.categoria
  where r.empresa_id = p_empresa
    and d.revision_id = any (p_revisiones)
  order by d.revision_id, coalesce(p.orden_revision, p.orden_visual), p.codigo_posicion;
$$;

comment on function tc_informe_revisiones_mediciones(uuid, uuid[]) is
  'Mediciones de las revisiones indicadas con el umbral que aplica a cada '
  'rueda, resuelto medida → categoría → empresa → 1,6 mm, la misma cadena '
  'que usan los informes. security invoker: la RLS sigue mandando.';

grant execute on function tc_informe_revisiones_mediciones(uuid, uuid[]) to authenticated;
