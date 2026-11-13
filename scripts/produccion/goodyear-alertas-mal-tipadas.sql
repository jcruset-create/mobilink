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
-- ── Qué hace este guion ─────────────────────────────────────────────────────
--
--   1. BORRA las alertas que en realidad son de profundidad.
--   2. CORRIGE el tipo de las que son de presión baja.
--
-- No se borra nada recuperable: el correo original sigue en
-- `tc_goodyear_avisos` con su asunto y su message_id, así que si algún día se
-- decide qué hacer con los avisos de profundidad, están todos ahí.
--
-- ── Cómo se distingue una de otra ───────────────────────────────────────────
--
-- Por el ASUNTO DEL CORREO que la originó, no por si trae presión o no.
-- Podría parecer más simple decir «las que no tienen presión son de
-- profundidad», y sería un error: un aviso de «neumático desinflado» de
-- verdad TAMPOCO trae presión —el correo pone `!!!`— y se habría borrado uno
-- bueno. El asunto es el dato, la ausencia de presión es una consecuencia.
--
-- Se ejecuta de una vez, en una transacción. Es idempotente: pasado una
-- segunda vez no encuentra nada que hacer.

begin;

-- ── 1. Antes de tocar: qué se va a cambiar ─────────────────────────────────
--
-- Mirar esto ANTES de seguir. Si los números no son los esperados (45 y 8 el
-- 13/11/2026, más los que hayan entrado después), parar y mirarlo.

select
  count(*) filter (where g.asunto ilike '%profundidad%')      as se_borran,
  count(*) filter (where g.asunto ilike '%presi%n baja%'
                     and a.tipo <> 'presion_baja')            as se_retipan,
  count(*) filter (where g.id is null)                        as sin_correo_enlazado,
  count(*)                                                    as abiertas_en_total
from tc_alertas_presion a
left join tc_goodyear_avisos g on g.alerta_id = a.id
where a.estado = 'abierta';

-- ── 2. Fuera las de profundidad ────────────────────────────────────────────
--
-- Se APUNTAN PRIMERO los ids y después se borra por id. Hacerlo al revés
-- —desenlazar del registro de correos y luego borrar «las que no tienen
-- correo enlazado»— parecía más corto y es justo donde se cuela un borrado de
-- más: después de desenlazar, una alerta recién desenlazada y otra que nunca
-- tuvo correo son indistinguibles, y hay una de ésas.

create temp table _de_profundidad on commit drop as
select a.id
  from tc_alertas_presion a
  join tc_goodyear_avisos g on g.alerta_id = a.id
 where a.estado = 'abierta'
   and g.asunto ilike '%profundidad%';

-- Se desenlazan del registro de correos y se marcan con su motivo verdadero:
-- `tc_goodyear_avisos.alerta_id` apunta aquí, y dejar el puntero colgando
-- perdería el rastro de por qué ese correo se dio por bueno.
update tc_goodyear_avisos
   set estado = 'no_casado',
       motivo = 'Es un aviso de profundidad de dibujo, no de presión (corregido a posteriori)',
       alerta_id = null
 where alerta_id in (select id from _de_profundidad);

delete from tc_alertas_presion
 where id in (select id from _de_profundidad);

-- ── 3. Y las de presión, con su nombre ─────────────────────────────────────

update tc_alertas_presion a
   set tipo = 'presion_baja',
       actualizado_at = now()
  from tc_goodyear_avisos g
 where g.alerta_id = a.id
   and a.estado = 'abierta'
   and a.tipo <> 'presion_baja'
   and g.asunto ilike '%presi%n baja%';

-- ── 4. Comprobación ────────────────────────────────────────────────────────
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

-- Si todo cuadra:
commit;
-- Si no:
-- rollback;
