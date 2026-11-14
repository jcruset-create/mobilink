-- ════════════════════════════════════════════════════════════════════════════
-- SEA TyreControl — Kilómetros por milímetro, por modelo de neumático
-- ════════════════════════════════════════════════════════════════════════════
--
-- Cuántos kilómetros aguanta cada milímetro de dibujo. Es la pregunta con la
-- que se compara un modelo con otro y se decide qué comprar, y hasta ahora
-- había que sacarla a mano con SQL.
--
-- SECURITY INVOKER → respeta la RLS por empresa.
--
-- ── Por qué esto no es «última medición menos primera» ──────────────────────
--
-- Porque ese cálculo, con estos datos, da un número falso. Dos trampas, las
-- dos medidas sobre la flota real de Plana antes de escribir esta función:
--
-- 1. ENTRE REVISIONES PASAN 305 KM DE MEDIANA. El arco del CheckPoint mide
--    casi cada vez que el autobús entra en base. A esa escala el desgaste real
--    es de 0,03 mm y el ruido de medida de ±0,6 mm, así que el 39 % de las
--    parejas consecutivas dice que el neumático GANA dibujo. Medir pareja a
--    pareja es medir ruido. Por eso solo cuentan los tramos largos
--    (`p_min_km`, 10.000 por defecto).
--
-- 2. EN TRAMOS LARGOS EL PROBLEMA YA NO ES EL RUIDO, ES LA IDENTIDAD. De los
--    690 historiales del Hankook AH51 de más de 10.000 km, 204 ganaban dibujo:
--    +2,5 mm de mediana y hasta +9,9. Eso no es error de medida —el ruido es
--    de medio milímetro—, es OTRO NEUMÁTICO montado en el mismo hueco sin
--    registrar el cambio. Solo 1 de esos 204 estaba marcado como
--    reesculturado, así que tampoco es eso. Encaja con que 1.191 de los 3.169
--    AH51 tengan `identidad_reconstruida`, de la importación del histórico.
--
--    Descartar esos tramos da 12.000 km/mm; contarlos como desgaste negativo
--    da 27.000. Ninguno vale. Lo que hay que hacer es CORTAR la serie ahí.
--
-- ── Lo que hace, entonces ───────────────────────────────────────────────────
--
-- La serie de mediciones de cada neumático se parte en tramos. Empieza uno
-- nuevo cuando:
--
--   · el neumático cambia de vehículo —el odómetro es otro—;
--   · el dibujo SUBE más de `p_salto` (2 mm) —es otra goma en el hueco—;
--   · el odómetro va hacia atrás.
--
-- Dentro de cada tramo con al menos 3 mediciones y `p_min_km` de recorrido se
-- mide lo que se gastó, y los tramos se suman por modelo y eje. Con este corte
-- solo 32 de 624 tramos del AH51 siguen sin mostrar desgaste, frente a 204 de
-- 690 sin cortar, y el resultado es estable: moviendo `p_salto` entre 1,5 y 4
-- la cifra del AH51 se queda entre 8.500 y 10.000 km/mm.
--
-- ── Cómo se promedia ────────────────────────────────────────────────────────
--
-- `km_por_mm` es la razón de las sumas (Σkm / Σmm), no la media de las razones:
-- un tramo de 60.000 km pesa lo que ha rodado y no lo mismo que uno de 10.000.
-- La mediana y los cuartiles sí van por tramo, que es lo que dice la dispersión
-- real entre gomas —ruta, conductor, presión—.
--
-- `mm_nuevo` y `mm_retirada` son los percentiles 99 y 1 de todo lo medido de
-- ese modelo: aproximan con qué dibujo entra y con cuál se retira, y son los
-- que permiten traducir km/mm a vida completa. Van por MODELO, repetidos en
-- cada fila de eje, para que la pantalla no tenga que pedirlos aparte.
--
-- ── El suelo: 3 tramos y 5 mm medidos ───────────────────────────────────────
--
-- Una fila con dos tramos y medio milímetro gastado entre los dos sale a
-- 2.727.948 km/mm. No es un modelo que dure para siempre: es el ruido de medida
-- dividiendo. El error relativo de la razón es aproximadamente
-- ruido·√tramos / mm_totales, así que con medio milímetro no se puede afirmar
-- nada y con cinco el margen baja al orden del 20 %. Por eso un modelo y eje
-- que no llegue a 3 tramos y 5 mm medidos NO sale en el informe: es mejor no
-- decir nada que decir un número que nadie va a poder cuestionar.

create or replace function public.tc_informes_km_por_mm(
  p_empresa uuid default null,
  p_min_km  numeric default 10000,
  p_salto   numeric default 2.0
)
returns table(
  marca text, modelo text, eje int,
  tramos bigint, neumaticos bigint,
  km_totales numeric, mm_totales numeric, km_por_mm numeric,
  p25 numeric, mediana numeric, p75 numeric,
  mm_nuevo numeric, mm_retirada numeric,
  neumaticos_modelo bigint
)
language sql security invoker stable as $$
  with m as (
    select d.neumatico_id                as nid,
           n.marca, n.modelo,
           rv.vehiculo_id                as vid,
           rv.fecha_revision::date       as f,
           rv.km_vehiculo::numeric       as km,
           d.profundidad_mm::numeric     as mm,
           p.eje
      from revisiones_neumaticos_detalle d
      join revisiones_vehiculo rv on rv.id = d.revision_id
      join tc_neumaticos       n  on n.id  = d.neumatico_id
      left join tc_posiciones_vehiculo p on p.id = d.posicion_id
     where d.profundidad_mm is not null
       and rv.estado_revision is distinct from 'anulada'
       and rv.km_vehiculo is not null and rv.km_vehiculo > 0
       and coalesce(d.neumatico_ausente, false) = false
       and coalesce(d.no_accesible,      false) = false
       and n.marca is not null and n.modelo is not null
       and (p_empresa is null or n.empresa_id = p_empresa)
  ),
  -- Dónde empieza un tramo nuevo. Ver la cabecera: las tres razones.
  marcado as (
    select m.*,
           case when vid is distinct from lag(vid) over w then 1
                when mm - lag(mm) over w > p_salto        then 1
                when km - lag(km) over w < 0              then 1
                else 0 end as corte
      from m
    window w as (partition by nid order by f, km)
  ),
  seg as (
    select marcado.*,
           sum(corte) over (partition by nid order by f, km rows unbounded preceding) as tramo
      from marcado
  ),
  -- Un tramo = una goma viviendo en un sitio, de punta a punta.
  tramo as (
    select nid, marca, modelo, tramo,
           count(*)                                          as n,
           max(km) - min(km)                                 as span_km,
           mode() within group (order by eje)                as eje,
           (array_agg(mm order by f, km))[1]
             - (array_agg(mm order by f desc, km desc))[1]   as desgaste
      from seg
     group by nid, marca, modelo, tramo
  ),
  buenos as (
    select * from tramo
     where n >= 3 and span_km >= p_min_km and desgaste > 0
  ),
  -- Con qué dibujo entra y con cuál se retira cada modelo. De TODO lo medido,
  -- no solo de los tramos buenos: son los extremos de la población.
  extremos as (
    select marca, modelo,
           round(percentile_cont(0.99) within group (order by mm)::numeric, 1) as mm_nuevo,
           round(percentile_cont(0.01) within group (order by mm)::numeric, 1) as mm_retirada
      from m group by marca, modelo
  ),
  -- Las gomas distintas del MODELO entero. No vale sumar las de cada eje: una
  -- que haya rodado en el directriz y luego en el de tracción se contaría dos
  -- veces, y el informe diría que hay más neumáticos de los que hay.
  del_modelo as (
    select marca, modelo, count(distinct nid) as neumaticos_modelo
      from buenos group by marca, modelo
  )
  select b.marca, b.modelo, b.eje,
         count(*)                                                   as tramos,
         count(distinct b.nid)                                      as neumaticos,
         round(sum(b.span_km), 0)                                   as km_totales,
         round(sum(b.desgaste), 1)                                  as mm_totales,
         round(sum(b.span_km) / sum(b.desgaste), 0)                 as km_por_mm,
         round(percentile_cont(0.25) within group (order by b.span_km / b.desgaste)::numeric, 0) as p25,
         round(percentile_cont(0.50) within group (order by b.span_km / b.desgaste)::numeric, 0) as mediana,
         round(percentile_cont(0.75) within group (order by b.span_km / b.desgaste)::numeric, 0) as p75,
         e.mm_nuevo, e.mm_retirada, dm.neumaticos_modelo
    from buenos b
    join extremos  e  on e.marca  = b.marca and e.modelo  = b.modelo
    join del_modelo dm on dm.marca = b.marca and dm.modelo = b.modelo
   group by b.marca, b.modelo, b.eje, e.mm_nuevo, e.mm_retirada, dm.neumaticos_modelo
  having count(*) >= 3 and sum(b.desgaste) >= 5
   order by sum(b.span_km) desc
   limit 500;
$$;

grant execute on function public.tc_informes_km_por_mm(uuid, numeric, numeric) to authenticated;
