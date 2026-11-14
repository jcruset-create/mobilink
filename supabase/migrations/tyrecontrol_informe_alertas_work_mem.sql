-- El informe de alertas dejaba de contestar: «canceling statement due to
-- statement timeout».
--
-- ── Qué pasaba ──────────────────────────────────────────────────────────────
--
-- `tc_informes_alertas` tarda, para Empresa Plana, entre 2,5 y 8 segundos con
-- la caché fría. El rol `authenticated` tiene `statement_timeout = 8s`, así
-- que la pantalla cancelaba la consulta y enseñaba el error en rojo.
--
-- No es por las alertas de presión que se añadieron en
-- `tyrecontrol_alertas_presion_en_informe.sql`: medida por separado, esa rama
-- tarda 7 MILISEGUNDOS. Lo caro llevaba ahí desde siempre y la pantalla vivía
-- al borde del límite; lo que pasa es que nadie lo había medido.
--
-- ── Dónde se iba el tiempo ──────────────────────────────────────────────────
--
-- En el CTE `ult`, que busca la última profundidad medida de cada neumático.
-- Junta 58.622 filas de `revisiones_neumaticos_detalle` con sus revisiones y
-- las ORDENA para quedarse con la más reciente de cada una. Ese `order by`
-- lleva `rv.fecha_revision`, que está en la tabla de al lado, así que ningún
-- índice puede dar ese orden: hay que ordenar de verdad.
--
-- Y ahí estaba el problema: `work_mem` son 2,1 MB en esta instalación y la
-- ordenación necesita 4,7 MB. Postgres la hacía en DISCO —«external merge
-- Disk: 2872kB»— en cada carga de la pantalla.
--
-- ── El arreglo, medido ──────────────────────────────────────────────────────
--
--   work_mem 2,1 MB (ahora):  external merge a disco  →  2.557 ms
--   work_mem 16 MB:           quicksort en memoria    →    161 ms
--
-- Dieciséis veces más rápido, y de paso deja de escribir ficheros temporales
-- en cada carga, que es justo el consumo de Disk IO que avisó Supabase.
--
-- ── Por qué así y no de otras formas ───────────────────────────────────────
--
-- · No se toca el cuerpo de la función. Es un `alter function ... set`, así
--   que las tres alertas de profundidad que ya funcionan no pueden romperse.
--
-- · No se sube el `work_mem` global: eso daría 16 MB a CADA ordenación de cada
--   conexión, con 60 conexiones posibles. Aquí lo recibe una función que se
--   llama al abrir una pantalla.
--
-- · Se probó reescribir `ult` con un LATERAL por neumático montado, para
--   cambiar la ordenación por búsquedas por índice. Sale PEOR: 3.719 ms y
--   121.616 bloques leídos, porque por cada neumático hay que mirar todas sus
--   mediciones y luego su revisión. Queda escrito para que no se vuelva a
--   intentar.
--
-- 16 MB y no 32: la ordenación pide 4,7 MB y conviene dejar margen para que
-- crezca el histórico, pero sin regalar memoria que no se usa.

alter function tc_informes_alertas(uuid) set work_mem to '16MB';

-- ── Comprobación ───────────────────────────────────────────────────────────
--
-- `ajuste` tiene que contener «work_mem=16MB». Y la llamada tiene que bajar de
-- los 8 segundos con holgura: midiendo con la caché fría salía en 0,6 s.

select p.proname,
       p.proconfig                                   as ajuste,
       clock_timestamp()                             as antes,
       (select count(*) from tc_informes_alertas(
          'a51c9662-4b6f-4681-8e2b-599e109659eb'::uuid)) as alertas_plana,
       clock_timestamp()                             as despues
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'tc_informes_alertas';
