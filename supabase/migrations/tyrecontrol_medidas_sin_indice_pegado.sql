-- Medidas escritas siempre igual: catálogo, combinaciones y 31 neumáticos.
--
-- ── Qué pasaba ───────────────────────────────────────────────────────────────
--
-- Revisado en solo lectura el 17/11/2026, antes de cargar el catálogo de
-- camión:
--
--   · Combinaciones (tyre_sizes): 5 escritas con espacio, «315/80 R22.5 156L».
--     Dos de ellas tienen ya su gemela bien escrita (315/80R22.5 156/150K y
--     385/65R22.5 160K): la misma rueda, dos veces.
--   · Neumáticos: 31 llevan el índice de carga y la velocidad PEGADOS en la
--     medida («385/65R22.5 164K») y vacíos sus propios campos. Para el catálogo
--     y los informes son una medida que no existe.
--   · Catálogo de medidas: falta 245/45R19, 245/45R18, 225/50R17 y 195/65R15,
--     que llevan 16 neumáticos; y sobra una medida «0».
--
-- ── Qué hace ─────────────────────────────────────────────────────────────────
--
-- 1. Las combinaciones con gemela pasan sus modelos a la gemela y se
--    desactivan (no se borran). Las otras se reescriben sin espacio; su
--    nombre lo recalcula el disparador de la tabla. El nombre de las
--    referencias de modelo que las usan se corrige igual.
-- 2. Los 31 neumáticos: la medida se queda en la medida, y el índice y la
--    velocidad pasan a sus campos. «385/65R22.5 164K» → 385/65R22.5 · 164 · K.
--    SOLO esas tres columnas y SOLO si índice y velocidad están vacíos.
--    Autorizado expresamente por Jordi el 17/11/2026 (la norma general es no
--    tocar tc_neumaticos).
-- 3. Catálogo: entran las cuatro medidas de turismo y la «0» se desactiva.
--    Los 8 neumáticos con medida «0» no se tocan: no hay de dónde sacar la
--    buena, se corrigen a mano.
--
-- No toca montajes, vehículos, ejes, kilómetros ni almacén.
--
-- ── Se prueba sola ───────────────────────────────────────────────────────────
--
-- Antes de tocar nada cuenta lo que va a cambiar; si no es lo que se vio al
-- escribir esto (31 neumáticos, 5 combinaciones), no toca nada y dice qué ha
-- encontrado. Después comprueba que no queda ninguna medida con el índice
-- pegado ni combinación con espacio. Repetida, no hace nada.

do $migracion$
declare
  c_neumaticos constant int := 31;
  c_combos constant int := 5;
  v_neu int;
  v_neu_con_datos int;
  v_combos int;
  v_r record;
  v_gemela uuid;
  v_fusionadas int := 0;
  v_reescritas int := 0;
  v_neu_hechos int := 0;
  v_medidas int := 0;
begin
  if to_regprocedure('public.tc_medida_normalizada(text)') is null then
    raise exception 'No se toca nada: falta tc_medida_normalizada.';
  end if;

  select count(*) into v_neu from tc_neumaticos
   where medida ~ '^\S+ \d{2,3}(/\d{2,3})?[A-Z]$';
  select count(*) into v_neu_con_datos from tc_neumaticos
   where medida ~ '^\S+ \d{2,3}(/\d{2,3})?[A-Z]$'
     and (nullif(btrim(indice_carga), '') is not null or nullif(btrim(indice_velocidad), '') is not null);
  select count(*) into v_combos from tyre_sizes
   where activo and medida is distinct from tc_medida_normalizada(medida);

  -- Ya hecha: no hay nada que hacer.
  if v_neu = 0 and v_combos = 0 then
    perform set_config('mobilink.resultado', 'Nada que hacer: ya estaba normalizado.', false);
    raise notice 'Nada que hacer: ya estaba normalizado.';
    return;
  end if;

  if v_neu <> c_neumaticos or v_combos <> c_combos or v_neu_con_datos > 0 then
    raise exception 'No se toca nada: se esperaban % neumáticos y % combinaciones y hay % y % (% de esos neumáticos ya tienen índice o velocidad). Hay que revisar antes de seguir.',
      c_neumaticos, c_combos, v_neu, v_combos, v_neu_con_datos;
  end if;

  -- 1. Combinaciones.
  for v_r in
    select t.* from tyre_sizes t
     where t.activo and t.medida is distinct from tc_medida_normalizada(t.medida)
  loop
    select g.id into v_gemela from tyre_sizes g
     where g.id <> v_r.id and g.activo
       and g.medida = tc_medida_normalizada(v_r.medida)
       and g.indice_carga_simple = v_r.indice_carga_simple
       and coalesce(g.indice_carga_doble, '') = coalesce(v_r.indice_carga_doble, '')
       and coalesce(g.codigo_velocidad, '') = coalesce(v_r.codigo_velocidad, '')
     limit 1;

    if v_gemela is not null then
      -- Sus modelos pasan a la gemela; uno que ya estuviera en ella no se repite.
      update tc_referencias_neumatico r
         set tyre_size_id = v_gemela,
             referencia_completa = replace(r.referencia_completa, v_r.referencia_completa,
                                           (select referencia_completa from tyre_sizes where id = v_gemela)),
             updated_at = now()
       where r.tyre_size_id = v_r.id
         and not exists (select 1 from tc_referencias_neumatico o where o.tyre_size_id = v_gemela and o.modelo_id = r.modelo_id);
      update tc_referencias_neumatico set activo = false, updated_at = now() where tyre_size_id = v_r.id;
      update tyre_sizes set activo = false, updated_at = now() where id = v_r.id;
      v_fusionadas := v_fusionadas + 1;
    else
      update tyre_sizes set medida = tc_medida_normalizada(medida), updated_at = now() where id = v_r.id;
      update tc_referencias_neumatico r
         set referencia_completa = replace(r.referencia_completa, v_r.referencia_completa,
                                           (select referencia_completa from tyre_sizes where id = v_r.id)),
             updated_at = now()
       where r.tyre_size_id = v_r.id;
      v_reescritas := v_reescritas + 1;
    end if;
  end loop;

  -- 2. Los 31 neumáticos: solo medida, índice de carga y velocidad.
  update tc_neumaticos n
     set medida = substring(n.medida from '^(\S+) '),
         indice_carga = substring(n.medida from ' (\d{2,3}(?:/\d{2,3})?)[A-Z]$'),
         indice_velocidad = substring(n.medida from '([A-Z])$')
   where n.medida ~ '^\S+ \d{2,3}(/\d{2,3})?[A-Z]$'
     and nullif(btrim(n.indice_carga), '') is null
     and nullif(btrim(n.indice_velocidad), '') is null;
  get diagnostics v_neu_hechos = row_count;

  -- 3. Catálogo.
  insert into tc_cat_medidas_neumatico (valor, activo, categoria, ancho, perfil, diametro)
  select v, true, 'turismo',
         substring(v from '^(\d{3})')::numeric,
         substring(v from '^\d{3}/(\d{2})')::numeric,
         substring(v from 'R(\d{2}(?:\.\d)?)')::numeric
    from unnest(array['245/45R19', '245/45R18', '225/50R17', '195/65R15']) v
   where not exists (select 1 from tc_cat_medidas_neumatico m where tc_medida_normalizada(m.valor) = v)
  on conflict (valor) do nothing;
  get diagnostics v_medidas = row_count;
  update tc_cat_medidas_neumatico set activo = false where valor = '0' and activo;

  -- Comprobación: nada con el índice pegado ni con espacio.
  if exists (select 1 from tc_neumaticos where medida ~ '^\S+ \d{2,3}(/\d{2,3})?[A-Z]$')
     or exists (select 1 from tyre_sizes where activo and medida is distinct from tc_medida_normalizada(medida)) then
    raise exception 'La comprobación ha fallado: queda alguna medida sin normalizar. No se toca nada.';
  end if;

  perform set_config('mobilink.resultado', format(
    'OK. Combinaciones: %s reescritas y %s unidas a su gemela. Neumáticos corregidos: %s. Medidas añadidas: %s.',
    v_reescritas, v_fusionadas, v_neu_hechos, v_medidas), false);
  raise notice '%', current_setting('mobilink.resultado');
end
$migracion$;

select current_setting('mobilink.resultado', true) as resultado,
       (select json_object_agg(m, n) from (
          select medida || ' · ' || coalesce(indice_carga, '—') || ' · ' || coalesce(indice_velocidad, '—') as m, count(*) as n
            from tc_neumaticos
           where medida in ('385/65R22.5', '295/80R22.5', '315/80R22.5') and indice_carga is not null
           group by 1) x) as neumaticos_por_medida,
       (select count(*) from tc_neumaticos where medida ~ ' ') as medidas_con_espacio_en_neumaticos,
       (select count(*) from tyre_sizes where activo and medida is distinct from tc_medida_normalizada(medida)) as combinaciones_sin_normalizar;
