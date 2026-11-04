-- ─────────────────────────────────────────────────────────────────────────
-- LIMPIEZA · revisiones duplicadas por el importador del CheckPoint
--
-- ── Qué pasó ────────────────────────────────────────────────────────────────
--
-- `checkpointImport.ts` comprobaba qué revisiones ya existían con una
-- consulta sin paginar y sin acotar por fecha. PostgREST cortaba la
-- respuesta en su tope, el mapa llegaba incompleto, y el importador volvía a
-- crear revisiones que ya estaban. Cada importación del mismo fichero dejaba
-- otra copia. En producción: 18.251 revisiones, de las que sobran miles.
--
-- ── Lo que este script NO hace, y es lo importante ──────────────────────────
--
-- NO borra «una por vehículo y día». De los 1.816 grupos con más de una
-- revisión el mismo día, **539 tienen mediciones DISTINTAS**: son lecturas
-- de verdad —el vehículo pasó dos veces por el arco, o un técnico midió
-- además— y borrarlas sería destruir datos.
--
-- Solo se borran COPIAS EXACTAS: misma posición, misma profundidad y misma
-- presión en todas las ruedas. De cada juego de copias idénticas se conserva
-- una: la que tenga más mediciones y, en empate, la más antigua.
--
-- Tampoco se toca ninguna revisión con una INCIDENCIA, una operación o un
-- parte guiado colgando. Hay 3 con incidencia: una incidencia es trabajo de
-- una persona y no se tira por una limpieza automática. Se quedan, y si
-- molestan se miran a mano.
--
-- Las mediciones se van solas: `revisiones_neumaticos_detalle` tiene
-- `on delete cascade`.
--
-- ── Cómo se usa ─────────────────────────────────────────────────────────────
--
-- 1. BACKUP antes. Esto borra y no hay deshacer.
-- 2. Ejecutar el PASO 1 (solo lectura): dice cuántas se irían y cuántas se
--    quedan. Comprobar que el número cuadra con lo esperado.
-- 3. Solo entonces, ejecutar el PASO 2.
--
-- El editor de Supabase confirma cada sentencia por su cuenta: no sirve
-- envolver esto en `begin … rollback` para ensayarlo. Lo que se pega, se
-- aplica. Por eso el ensayo es el PASO 1, que no escribe.
-- ─────────────────────────────────────────────────────────────────────────

-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ PASO 1 · SOLO LECTURA. Qué se borraría.                               ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

with huellas as (
  select r.id, r.vehiculo_id, r.fecha_revision, r.empresa_id, r.created_at,
         md5(coalesce(string_agg(
               coalesce(d.posicion_id::text,'') || ':' ||
               coalesce(d.profundidad_mm::text,'') || ':' ||
               coalesce(d.presion_bar::text,''), '|' order by d.posicion_id), '')) huella,
         count(d.*) mediciones
    from revisiones_vehiculo r
    left join revisiones_neumaticos_detalle d on d.revision_id = r.id
   group by r.id
),
clasificadas as (
  select h.*, row_number() over (
           partition by h.vehiculo_id, h.fecha_revision, h.huella
           order by h.mediciones desc, h.created_at asc, h.id asc) pos
    from huellas h
),
sobrantes as (
  select c.* from clasificadas c
   where c.pos > 1
     -- Nada con trabajo humano colgando.
     and not exists (select 1 from tc_incidencias i        where i.revision_id = c.id)
     and not exists (select 1 from operaciones_neumaticos o where o.revision_id = c.id)
     and not exists (select 1 from tc_partes_guiados p      where p.revision_id = c.id)
)
select e.nombre cliente,
       count(*) a_borrar,
       count(*) filter (where s.mediciones = 0) de_ellas_sin_mediciones,
       count(distinct s.vehiculo_id) vehiculos_afectados,
       (select count(*) from revisiones_vehiculo r2 where r2.empresa_id = s.empresa_id) revisiones_hoy,
       (select count(*) from revisiones_vehiculo r2 where r2.empresa_id = s.empresa_id) - count(*) quedarian
  from sobrantes s join tc_empresas e on e.id = s.empresa_id
 group by e.nombre, s.empresa_id
 order by 2 desc;


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ PASO 2 · ESCRIBE. Ejecutar solo si el paso 1 cuadra y hay backup.     ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
--
-- Devuelve cuántas ha borrado. Es idempotente: pasarlo dos veces no borra
-- nada la segunda, porque ya no quedan copias exactas.

-- with huellas as (
--   select r.id, r.vehiculo_id, r.fecha_revision, r.created_at,
--          md5(coalesce(string_agg(
--                coalesce(d.posicion_id::text,'') || ':' ||
--                coalesce(d.profundidad_mm::text,'') || ':' ||
--                coalesce(d.presion_bar::text,''), '|' order by d.posicion_id), '')) huella,
--          count(d.*) mediciones
--     from revisiones_vehiculo r
--     left join revisiones_neumaticos_detalle d on d.revision_id = r.id
--    group by r.id
-- ),
-- clasificadas as (
--   select h.*, row_number() over (
--            partition by h.vehiculo_id, h.fecha_revision, h.huella
--            order by h.mediciones desc, h.created_at asc, h.id asc) pos
--     from huellas h
-- ),
-- sobrantes as (
--   select c.id from clasificadas c
--    where c.pos > 1
--      and not exists (select 1 from tc_incidencias i        where i.revision_id = c.id)
--      and not exists (select 1 from operaciones_neumaticos o where o.revision_id = c.id)
--      and not exists (select 1 from tc_partes_guiados p      where p.revision_id = c.id)
-- ),
-- borradas as (
--   delete from revisiones_vehiculo r
--    where r.id in (select id from sobrantes)
--   returning r.id
-- )
-- select count(*) revisiones_borradas from borradas;


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ PASO 3 · SOLO LECTURA. Comprobar después.                             ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
--
-- Lo que debe salir: cero copias exactas, y los 539 grupos con lecturas
-- distintas INTACTOS. Si ese segundo número baja, se ha borrado de más.
--
-- with huellas as (
--   select r.id, r.vehiculo_id, r.fecha_revision,
--          md5(coalesce(string_agg(
--                coalesce(d.posicion_id::text,'') || ':' ||
--                coalesce(d.profundidad_mm::text,'') || ':' ||
--                coalesce(d.presion_bar::text,''), '|' order by d.posicion_id), '')) huella
--     from revisiones_vehiculo r
--     left join revisiones_neumaticos_detalle d on d.revision_id = r.id
--    group by r.id
-- )
-- select
--   (select count(*) from revisiones_vehiculo) revisiones_totales,
--   (select coalesce(sum(n-1),0) from (
--      select count(*) n from huellas group by vehiculo_id, fecha_revision, huella
--       having count(*) > 1) x) copias_exactas_que_quedan,
--   (select count(*) from (
--      select vehiculo_id, fecha_revision from huellas
--       group by 1,2 having count(distinct huella) > 1) y) grupos_con_lecturas_distintas;
