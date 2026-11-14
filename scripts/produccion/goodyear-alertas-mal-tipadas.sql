-- Arreglar las alertas de Goodyear que entraron mal tipadas.
--
-- ── Qué pasó, y fue culpa del parser ────────────────────────────────────────
--
-- `leerAlerta` buscaba el tipo de aviso en el asunto y el cuerpo JUNTOS y se
-- quedaba con el primero de su lista. Salió mal de las dos maneras posibles:
-- de las 53 alertas que había abiertas el 13/11/2026, NINGUNA estaba bien.
--
--   45  avisos de PROFUNDIDAD DE DIBUJO guardados como «Neumático desinflado».
--       Entraron en una tabla de bares sin traer un solo bar, así que salen
--       como «Neumático desinflado · Sin lectura de presión» en la ficha del
--       vehículo, en la tablet y en la campana. 31 vehículos enseñando una
--       banda roja que manda a buscar una fuga que no existe, cuando lo que
--       pasa es que la goma está gastada.
--
--    8  avisos de PRESIÓN BAJA de verdad guardados como «desinflado». Éstos sí
--       traen lectura, así que la ficha pintaba «Neumático desinflado · 4.4
--       bar de 8 recomendados», que se contradice sola: el desinflado es
--       justo el aviso que NO trae número.
--
-- La vía de entrada ya está tapada: el parser mira ahora el ASUNTO primero,
-- que es la única línea donde Goodyear nombra el aviso una sola vez. Esto
-- arregla lo que entró antes.
--
-- ── Cómo se distingue una de otra ───────────────────────────────────────────
--
-- Por el ASUNTO DEL CORREO que la originó, no por si trae presión o no.
-- Podría parecer más simple decir «las que no tienen presión son de
-- profundidad», y sería un error: un aviso de «neumático desinflado» de
-- verdad TAMPOCO trae presión —el correo pone `!!!`— y se habría borrado uno
-- bueno. El asunto es el dato, la ausencia de presión es una consecuencia.
--
-- ── Por qué todo el cambio va en UN bloque `do` ────────────────────────────
--
-- El primer intento usaba una tabla temporal con `on commit drop` dentro de un
-- `begin; ... commit;`, y falló con «relation "_de_profundidad" does not
-- exist». El editor SQL de Supabase ejecuta SENTENCIA A SENTENCIA con
-- autocommit: el `begin` no agrupa nada, así que la tabla temporal moría al
-- terminar la propia sentencia que la creaba.
--
-- Un bloque `do` es UNA SOLA SENTENCIA, así que es atómico se comporte como se
-- comporte el editor: o hace las dos cosas o no hace ninguna. Los recuentos
-- salen por `raise notice`, que Supabase enseña bajo los resultados.
--
-- Se ejecuta entero, de una vez. Es idempotente: pasado otra vez no encuentra
-- nada que hacer.

-- ══ 1. ANTES DE TOCAR: mirar qué se va a cambiar ═══════════════════════════
--
-- Lanzar SOLO esto primero. Si los números no son los esperados (45 y 8 el
-- 13/11/2026, más los que hayan entrado después), parar y avisar.

select
  count(*) filter (where g.asunto ilike '%profundidad%')      as se_borran,
  count(*) filter (where g.asunto ilike '%presi%n baja%'
                     and a.tipo <> 'presion_baja')            as se_retipan,
  count(*) filter (where g.id is null)                        as sin_correo_enlazado,
  count(*)                                                    as abiertas_en_total
from tc_alertas_presion a
left join tc_goodyear_avisos g on g.alerta_id = a.id
where a.estado = 'abierta';


-- ══ 2. EL CAMBIO ═══════════════════════════════════════════════════════════

do $arreglo$
declare
  v_borradas int;
  v_retipadas int;
begin
  /*
   * Primero se MARCA el correo y después se borra la alerta, en este orden y
   * no al revés: la clave ajena es `on delete set null`, así que borrar
   * primero dejaría el correo sin puntero y ya no se sabría cuál marcar.
   *
   * `alerta_id` NO se pone a null aquí a mano: lo hace la propia clave ajena
   * al borrar, en el paso siguiente. Nulificarlo ahora rompería el enlace que
   * ese mismo paso necesita para encontrar las alertas.
   */
  update tc_goodyear_avisos g
     set estado = 'no_casado',
         motivo = 'Es un aviso de profundidad de dibujo, no de presión (corregido a posteriori)'
   where g.asunto ilike '%profundidad%'
     and g.alerta_id in (select id from tc_alertas_presion where estado = 'abierta');

  delete from tc_alertas_presion a
   where a.estado = 'abierta'
     and exists (
       select 1 from tc_goodyear_avisos g
        where g.alerta_id = a.id
          and g.asunto ilike '%profundidad%');
  get diagnostics v_borradas = row_count;

  -- Y las de presión, con su nombre.
  update tc_alertas_presion a
     set tipo = 'presion_baja',
         actualizado_at = now()
    from tc_goodyear_avisos g
   where g.alerta_id = a.id
     and a.estado = 'abierta'
     and a.tipo <> 'presion_baja'
     and g.asunto ilike '%presi%n baja%';
  get diagnostics v_retipadas = row_count;

  raise notice 'Borradas % alertas que eran de profundidad', v_borradas;
  raise notice 'Retipadas % alertas de presion baja', v_retipadas;
end
$arreglo$;


-- ══ 3. COMPROBACIÓN ════════════════════════════════════════════════════════
--
-- Tiene que salir:
--   · `de_profundidad` a 0 — no queda ninguna.
--   · `presion_mal_tipada` a 0 — todas con su nombre.
--   · `presion_baja` con las que había mal tipadas (8 el 13/11) y
--     `desinflado` solo con las que lo sean de verdad.
--
-- Si `desinflado` sigue alto, PARAR: significa que quedan avisos de
-- profundidad que este guion no ha reconocido y hay que mirar sus asuntos.

select
  count(*) filter (where g.asunto ilike '%profundidad%')  as de_profundidad,
  count(*) filter (where g.asunto ilike '%presi%n baja%'
                     and a.tipo <> 'presion_baja')        as presion_mal_tipada,
  count(*) filter (where a.tipo = 'presion_baja')         as presion_baja,
  count(*) filter (where a.tipo = 'desinflado')           as desinflado,
  count(*)                                                as abiertas_en_total
from tc_alertas_presion a
left join tc_goodyear_avisos g on g.alerta_id = a.id
where a.estado = 'abierta';
