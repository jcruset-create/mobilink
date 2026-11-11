-- Purga del histórico de scores de Connect.
--
-- NO LANZAR ESTO ANTES DE DESPLEGAR EL CÓDIGO DE ESTA MISMA RAMA. Hasta que
-- `server/connect/score.ts` lleve la guarda de «solo si cambia», la tabla se
-- vuelve a llenar a 7.670 filas al día y esto no habrá servido de nada.
--
-- ── Qué pasaba ──────────────────────────────────────────────────────────────
--
-- `computeWorkshopScores` insertaba una fila por taller cada cinco minutos,
-- pasara lo que pasara. Desde el 22/07/2026 eso dejó:
--
--     704.714 filas · 206 MB · el 47 % de toda la base de datos
--
-- con UN SOLO valor de score distinto en todas ellas: 70. El motivo está en la
-- propia fórmula: sin volumen (`volume90d = 0`) el suavizado bayesiano devuelve
-- la media neutra de la red, que es 70. El 92,5 % de las filas —651.754— tienen
-- además todos los componentes a null: no hay nada medido que puntuar.
--
-- ── Qué se borra y qué NO ───────────────────────────────────────────────────
--
-- Se borra lo que tenga más de 30 días. Se conservan 30 días porque hay
-- exactamente DOS lectores del histórico y ninguno mira más atrás de 14:
--
--   · `backoffice.ts:537`  → la última fila de cada taller (ORDER BY id DESC
--                            LIMIT 1), para enseñar el score en la ficha.
--   · `score.ts:188`       → la última fila ANTERIOR a hace 14 días, para
--                            avisar de una caída de score de 15 puntos o más.
--
-- No se toca nada más. En particular NO se toca `connect_workshops`, que es
-- donde vive el `currentScore` que ve la pantalla: es otra tabla, una fila por
-- taller, y los 26 la tienen. Y no hay ninguna clave ajena apuntando aquí.
--
-- ── Un apunte sobre el futuro ───────────────────────────────────────────────
--
-- Con la guarda puesta, la tabla pasa a crecer solo cuando el score cambia de
-- verdad, más un latido diario por taller para que se note si el cálculo se
-- para. Son 26 filas al día en el peor caso, frente a 7.670.

-- ════════════════════════════════════════════════════════════════════════════
-- PASO 1 — MIRAR. No escribe nada. Lánzalo solo.
-- ════════════════════════════════════════════════════════════════════════════

select count(*)                                                   as filas_totales,
       count(*) filter (
         where "computedAtMs" <  (extract(epoch from now()) - 30*86400)*1000
       )                                                          as se_borrarian,
       count(*) filter (
         where "computedAtMs" >= (extract(epoch from now()) - 30*86400)*1000
       )                                                          as se_quedan,
       count(distinct "workshopId")                               as talleres,
       count(distinct score)                                      as valores_de_score_distintos,
       pg_size_pretty(pg_total_relation_size('connect_workshop_scores')) as ocupa
  from connect_workshop_scores;

-- Lo que salía el 10/11/2026:
--
--   filas_totales 704.714 · se_borrarian 477.682 · se_quedan 227.032
--   talleres 26 · valores_de_score_distintos 1 · ocupa 206 MB
--
-- `valores_de_score_distintos = 1` es la comprobación que importa: si saliera
-- más de 1, el histórico SÍ tendría variación y habría que mirar antes de
-- borrar nada. Con 1, lo que se borra es la misma línea repetida.

-- Y que cada taller conserva su última fila (las 26 tienen que salir):

select count(*) as talleres_que_conservan_su_ultima_fila
  from (select distinct on ("workshopId") "workshopId", "computedAtMs"
          from connect_workshop_scores
         order by "workshopId", id desc) u
 where u."computedAtMs" >= (extract(epoch from now()) - 30*86400)*1000;


-- ════════════════════════════════════════════════════════════════════════════
-- PASO 2 — BORRAR. A una hora tranquila.
-- ════════════════════════════════════════════════════════════════════════════
--
-- Son 477.682 filas de golpe: genera del orden de 140 MB de WAL y deja otras
-- tantas tuplas muertas. Es un pico puntual y es justo lo que se quiere evitar
-- en horario de trabajo, así que mejor de noche o en fin de semana.

delete from connect_workshop_scores
 where "computedAtMs" < (extract(epoch from now()) - 30*86400)*1000;


-- ════════════════════════════════════════════════════════════════════════════
-- PASO 3 — RECUPERAR EL ESPACIO. Lánzalo SOLO, sin nada más en el buffer.
-- ════════════════════════════════════════════════════════════════════════════
--
-- El `delete` de arriba NO devuelve los 206 MB: marca el espacio como
-- reutilizable dentro de la propia tabla. Para que el disco lo recupere de
-- verdad hace falta esto, que reescribe la tabla y sus índices.
--
-- Bloquea la tabla mientras dura (segundos, con 227.000 filas). Nadie la lee
-- salvo las dos consultas de arriba, así que no se nota.
--
-- SI DA «VACUUM cannot run inside a transaction block»: es que el editor SQL
-- está envolviendo el buffer. Entonces hay que lanzarlo desde una conexión
-- directa con psql, no desde el editor:
--
--   psql "$DATABASE_URL" -c 'vacuum full analyze connect_workshop_scores;'

vacuum full analyze connect_workshop_scores;


-- ════════════════════════════════════════════════════════════════════════════
-- PASO 4 — COMPROBAR
-- ════════════════════════════════════════════════════════════════════════════
--
-- `ocupa` tiene que haber bajado de 206 MB a unos 70, y `talleres` tiene que
-- seguir siendo 26: si algún taller se quedara sin ninguna fila, la ficha del
-- backoffice dejaría de enseñar su score.

select count(*)                                                   as filas,
       count(distinct "workshopId")                               as talleres,
       pg_size_pretty(pg_total_relation_size('connect_workshop_scores')) as ocupa,
       to_char(to_timestamp(min("computedAtMs")/1000), 'DD/MM/YYYY') as desde,
       to_char(to_timestamp(max("computedAtMs")/1000), 'DD/MM/YYYY') as hasta
  from connect_workshop_scores;

-- Y que la base entera ha adelgazado:

select pg_size_pretty(pg_database_size(current_database())) as tamano_de_la_base;
