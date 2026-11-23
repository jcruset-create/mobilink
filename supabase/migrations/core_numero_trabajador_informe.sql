-- =============================================================================
-- Core · Número de trabajador — INFORME (solo lectura)
-- =============================================================================
--
-- QUÉ HACE
--   Consultas sueltas para pegar en el SQL Editor de una en una. Ninguna
--   escribe nada.
--
-- QUÉ NO HACE
--   No cambia datos, no crea nada, no corrige nada.
--
-- ORDEN
--   · Las consultas 1 y 2 se pueden lanzar ANTES de core_numero_trabajador.sql.
--   · Las 3 y 4 necesitan la columna, así que van DESPUÉS.
--   · Las del apartado 5 (módulos) se pueden lanzar en cualquier momento.
--     Si un módulo no está instalado en esta base, su consulta falla con
--     «relation ... does not exist» o «column ... does not exist»: se salta.
-- =============================================================================


-- 1. Empleados activos SIN empresa. No pueden tener número hasta que tengan
--    una: asígnasela en Core → Empleados antes de empezar a numerar.
select e.id, e.nombre, e.apellidos, e.codigo_operario, e.estado_alta
  from sea_employees e
 where e.activo = true
   and e.company_id is null
 order by e.nombre, e.apellidos;


-- 2. Plantilla activa por empresa (cuántos números habrá que poner).
select coalesce(c.nombre, '(sin empresa)') as empresa,
       count(*)                            as activos
  from sea_employees e
  left join sea_companies c on c.id = e.company_id
 where e.activo = true
 group by c.nombre
 order by c.nombre nulls first;


-- 3. [Después de la migración] Avance: activos con y sin número, por empresa.
select coalesce(c.nombre, '(sin empresa)')                    as empresa,
       count(*) filter (where e.numero_trabajador is not null) as con_numero,
       count(*) filter (where e.numero_trabajador is null)     as sin_numero
  from sea_employees e
  left join sea_companies c on c.id = e.company_id
 where e.activo = true
 group by c.nombre
 order by c.nombre nulls first;


-- 4. [Después de la migración] Números repetidos dentro de una misma empresa.
--    Debería salir vacía: el índice único lo impide. Si la migración se paró
--    por repetidos, esta es la lista a corregir.
select c.nombre               as empresa,
       e.numero_trabajador,
       array_agg(e.id)        as ids,
       array_agg(trim(e.nombre || ' ' || coalesce(e.apellidos, ''))) as nombres
  from sea_employees e
  left join sea_companies c on c.id = e.company_id
 where e.numero_trabajador is not null
 group by c.nombre, e.company_id, e.numero_trabajador
having count(*) > 1
 order by c.nombre, e.numero_trabajador;


-- =============================================================================
-- 5. Módulos: cuántos de sus operarios están ya enlazados con Core
--    (employee_id puesto) y cuántos no. Es el punto de partida de la Fase B.
-- =============================================================================

-- 5a. Taller — techs.employee_id (010_techs_employee_id.sql).
--     techs no tiene «activo»; se cuentan los no bloqueados.
select count(*) filter (where employee_id is not null) as enlazados,
       count(*) filter (where employee_id is null)     as sin_enlazar
  from techs
 where blocked = false;

-- 5b. Administración — app_usuarios.employee_id.
select count(*) filter (where employee_id is not null) as enlazados,
       count(*) filter (where employee_id is null)     as sin_enlazar
  from app_usuarios
 where activo = true;

-- 5c. Cash — destinos PERSONA de los gastos (cash_expense_targets.employee_id).
select count(*) filter (where employee_id is not null) as enlazados,
       count(*) filter (where employee_id is null)     as sin_enlazar
  from cash_expense_targets
 where tipo = 'PERSONA' and activo = true;

-- 5d. Almacén — perfiles_usuario. Aún NO tiene employee_id (se añade en la
--     Fase B); hoy solo se puede contar cuántos hay que enlazar.
select count(*) as por_enlazar
  from perfiles_usuario
 where activo is not false;

-- 5e. Recepciones — rcp_operarios. Aún NO tiene employee_id (Fase B).
select count(*) as por_enlazar
  from rcp_operarios
 where activo = true;

-- 5f. TyreControl — solo operarios internos (no clientes). Aún NO tiene
--     employee_id (Fase B).
select rol, count(*) as por_enlazar
  from tc_usuarios
 where activo = true
   and rol in ('administrador', 'operador')
 group by rol;
