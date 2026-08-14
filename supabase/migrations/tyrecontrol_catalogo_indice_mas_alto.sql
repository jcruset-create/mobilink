-- ============================================================
-- Mobilink TyreControl — Catálogo: una referencia por modelo y medida base
--
-- El catálogo tenía el mismo modelo con la misma medida repetido por cada
-- combinación de índice de carga y código de velocidad: Hankook AL50 en
-- 315/70 R22.5 aparecía como 154/148L, 154/150L, 154/150M, 156/150L… Para
-- elegir neumático eso es ruido: la goma es la misma, y de cara al catálogo
-- interesa UNA entrada por modelo y medida.
--
-- REGLA (pedida el 14-08-2026): de cada grupo modelo × medida base sobrevive
-- la referencia de MAYOR índice de carga; a igual carga, el código de
-- velocidad más alto; a igual todo, la de carga doble mayor y, en última
-- instancia, la más antigua (estabilidad entre pasadas).
--
-- Los productos del almacén que apuntaban a una referencia retirada se
-- repuntan a la superviviente ANTES de retirarla: un producto con stock no
-- puede quedarse señalando una ficha apagada.
--
-- Las retiradas se DESACTIVAN, no se borran: el listado solo enseña activas
-- (data.ts listarReferenciasNeumatico filtra activo=true), así que
-- desaparecen de pantalla, pero recuperarlas es un update.
--
-- OJO, esto NO toca:
--   · tyre_sizes — es la tabla de referencia universal de medidas; que este
--     catálogo no quiera dos índices no significa que la medida no exista.
--   · Marcas mal escritas ("Hankokk" ≠ "Hankook"): son modelos distintos en
--     tablas distintas y se arreglan con la normalización de marcas, no aquí.
--
-- Idempotente: al segundo pase los grupos ya tienen una sola activa y no
-- hay nada que hacer.
-- ============================================================

-- Sin "on commit drop": el editor de Supabase no ejecuta todo en la misma
-- transacción y la tabla se evaporaría antes de usarla (lección aprendida en
-- tyrecontrol_tipos_mal_puestos.sql).
drop table if exists _tc_catalogo_dedupe;
create temp table _tc_catalogo_dedupe as
with refs as (
  select r.id, r.modelo_id, r.referencia_completa,
         ts.ancho, coalesce(ts.perfil, -1) as perfil, ts.diametro_llanta,
         -- La carga viene como texto ('154'); si no es numérica, pierde.
         nullif(regexp_replace(ts.indice_carga_simple, '\D', '', 'g'), '')::int as carga,
         -- Orden real de códigos de velocidad (la H va entre U y V, herencia
         -- histórica de la norma; ordenar alfabéticamente la colocaría mal).
         coalesce(array_position(
           array['B','C','D','E','F','G','J','K','L','M','N','P','Q','R','S','T','U','H','V','W','Y'],
           upper(trim(ts.codigo_velocidad))), 0) as vel,
         nullif(regexp_replace(coalesce(ts.indice_carga_doble, ''), '\D', '', 'g'), '')::int as carga_doble,
         r.created_at
    from tc_referencias_neumatico r
    join tyre_sizes ts on ts.id = r.tyre_size_id
   where r.activo
),
ordenados as (
  select id, modelo_id, referencia_completa,
         first_value(id) over w as superviviente,
         first_value(referencia_completa) over w as ref_superviviente,
         count(*) over (partition by modelo_id, ancho, perfil, diametro_llanta) as n
    from refs
  window w as (
    partition by modelo_id, ancho, perfil, diametro_llanta
    order by carga desc nulls last, vel desc, carga_doble desc nulls last, created_at asc
    rows between unbounded preceding and unbounded following
  )
)
select id, referencia_completa, superviviente, ref_superviviente
  from ordenados
 where n > 1 and id <> superviviente;

-- 1) El stock del almacén, a la superviviente. Antes de apagar nada.
update productos_neumaticos p
   set referencia_neumatico_id = d.superviviente
  from _tc_catalogo_dedupe d
 where p.referencia_neumatico_id = d.id;

-- 2) Retirar las repetidas (desactivar, no borrar).
update tc_referencias_neumatico r
   set activo = false, updated_at = now()
  from _tc_catalogo_dedupe d
 where r.id = d.id;

-- ── Comprobación ────────────────────────────────────────────────────────────
do $$
declare v_retiradas int; v_colgando int; v_grupos_dobles int;
begin
  select count(*) into v_retiradas from _tc_catalogo_dedupe;

  -- Ningún producto puede quedar apuntando a una referencia inactiva.
  select count(*) into v_colgando
    from productos_neumaticos p
    join tc_referencias_neumatico r on r.id = p.referencia_neumatico_id
   where not r.activo;
  if v_colgando > 0 then
    raise exception 'Quedan % productos apuntando a referencias retiradas', v_colgando;
  end if;

  -- Y ningún grupo modelo × medida base puede seguir con más de una activa.
  select count(*) into v_grupos_dobles from (
    select 1
      from tc_referencias_neumatico r
      join tyre_sizes ts on ts.id = r.tyre_size_id
     where r.activo
     group by r.modelo_id, ts.ancho, coalesce(ts.perfil, -1), ts.diametro_llanta
    having count(*) > 1
  ) g;
  if v_grupos_dobles > 0 then
    raise exception 'Quedan % grupos con más de una referencia activa', v_grupos_dobles;
  end if;

  raise notice 'OK: % referencias repetidas retiradas; el catálogo queda con el índice más alto de cada modelo y medida', v_retiradas;
end $$;

drop table if exists _tc_catalogo_dedupe;
