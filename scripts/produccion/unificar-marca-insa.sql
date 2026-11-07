-- ============================================================================
-- Mobilink TyreControl — Unificar «INSATURBO» con «Insa»
--
-- QUÉ SE PIDIÓ
--
-- Unificar Insa e INSATURBO en el catálogo, porque el informe mensual los
-- cuenta como dos marcas distintas: 101 ruedas de Insa y 8 de INSATURBO en
-- octubre de 2026.
--
-- QUÉ PASA DE VERDAD, QUE NO ES EXACTAMENTE ESO
--
-- En el catálogo (`tc_cat_marcas_neumatico`) **no hay ningún INSATURBO**. Hay
-- `Insa` y hay `INSATRUCK`, y ya está. Así que no hay dos entradas de catálogo
-- que fundir.
--
-- Lo que pasa es otra cosa: `tc_neumaticos.marca` es TEXTO LIBRE y no tiene
-- clave ajena al catálogo —comprobado: la única que apunta ahí es
-- `tc_cat_modelos_neumatico.marca_id`—. O sea que cualquiera puede escribir
-- lo que quiera, y 12 neumáticos de Plana tienen escrito «INSATURBO», que no
-- es ninguna entrada del catálogo.
--
-- Los 12 se dieron de alta el 10/08/2026, el día de la importación masiva.
--
-- QUÉ HACE ESTE SCRIPT
--
--   update tc_neumaticos set marca = 'Insa' where marca = 'INSATURBO';
--
-- 12 filas, todas de Plana. Nada más.
--
-- POR QUÉ A «Insa» Y NO AL REVÉS
--
-- Porque `Insa` es la entrada que SÍ está en el catálogo y la usan 662
-- neumáticos de DOS empresas. Renombrar `Insa` tocaría los datos de otro
-- cliente para arreglar doce filas de éste.
--
-- LO QUE NO TOCA, Y POR QUÉ
--
-- **`INSATRUCK` se queda como está.** Son 3 neumáticos y son de OTRA empresa
-- (b343cb36…), no de Plana. Además tiene su propia entrada en el catálogo, así
-- que alguien la dio de alta a propósito. Insa Truck es la gama de camión de
-- Insa Turbo, así que puede que sean la misma marca y puede que ese cliente
-- las quiera separadas: eso lo decide quien lleva ese cliente, no este script.
--
-- Idempotente: la segunda vez no encuentra ninguna fila y no cambia nada.
-- ============================================================================

-- ── ANTES: pegar esto primero y guardar lo que salga ────────────────────────
--
--   select marca, count(*) n, count(distinct empresa_id) empresas
--     from tc_neumaticos
--    where marca in ('Insa','INSATURBO','INSATRUCK')
--    group by marca order by 2 desc;
--
--   Esperado hoy:  Insa 662 (2 empresas) · INSATURBO 12 (1) · INSATRUCK 3 (1)

begin;

update tc_neumaticos
   set marca = 'Insa',
       updated_at = now()
 where marca = 'INSATURBO';

commit;

-- ── DESPUÉS: las tres comprobaciones ────────────────────────────────────────
--
--   -- 1 · Ya no queda ningún INSATURBO, e Insa ha subido justo en 12
--   select marca, count(*) n
--     from tc_neumaticos
--    where marca in ('Insa','INSATURBO','INSATRUCK')
--    group by marca order by 2 desc;
--   -- esperado: Insa 674 · INSATRUCK 3 · (INSATURBO ya no sale)
--
--   -- 2 · El total de neumáticos no se ha movido: esto renombra, no borra
--   select count(*) from tc_neumaticos;
--   -- esperado: lo mismo que antes
--
--   -- 3 · Y no se ha tocado ninguna otra empresa
--   select empresa_id, count(*) from tc_neumaticos where marca = 'Insa'
--    group by 1 order by 2 desc;
--   -- esperado: las mismas dos empresas, una con 12 más
-- ============================================================================
