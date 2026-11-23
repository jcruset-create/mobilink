-- =============================================================================
-- Core · Número de trabajador por empresa (Fase A)
-- =============================================================================
--
-- QUÉ HACE
--   1. Añade sea_employees.numero_trabajador (TEXT, opcional).
--   2. Crea un índice único parcial (company_id, numero_trabajador): dentro de
--      una empresa no puede haber dos empleados con el mismo número. En
--      empresas distintas, sí.
--
-- QUÉ NO HACE
--   · No rellena ningún número: se ponen a mano desde Core → Empleados.
--   · No lo hace obligatorio (ni NOT NULL ni CHECK): se va rellenando poco a poco.
--   · No toca codigo_operario (es el usuario de login de ToolControl).
--   · No toca ninguna otra tabla ni añade triggers. No hay DROP.
--   · Los empleados sin company_id no pueden tener número (lo impide el servidor);
--     el índice tampoco los cubre, porque NULL no se compara.
--
-- ORDEN
--   1. core_numero_trabajador_informe.sql   (solo lectura, opcional pero útil)
--   2. ESTE FICHERO
--   3. Desplegar el servidor/web (funcionan también ANTES de este paso: la
--      pantalla sale sin la columna «Nº» y avisa de que falta la migración).
--
-- IDEMPOTENTE: se puede ejecutar las veces que haga falta.
-- =============================================================================

-- 1. La columna.
alter table sea_employees
  add column if not exists numero_trabajador text;

comment on column sea_employees.numero_trabajador is
  'Número interno del trabajador, único por empresa (company_id). Se pone a mano. '
  'Sirve para enlazar los módulos con Core; en los módulos se guarda employee_id, no este número.';

-- 2. Único por empresa. Recién creada la columna no puede haber repetidos;
--    si se re-ejecuta y alguien los hubiera metido a mano saltándose el
--    servidor, se para con un mensaje claro en vez de con el error de Postgres.
do $$
declare
  repetidos int;
begin
  select count(*) into repetidos
    from (
      select company_id, numero_trabajador
        from sea_employees
       where numero_trabajador is not null
       group by company_id, numero_trabajador
      having count(*) > 1
    ) d;

  if repetidos > 0 then
    raise exception
      'Hay % números de trabajador repetidos dentro de una misma empresa. '
      'Ejecuta la consulta 4 de core_numero_trabajador_informe.sql, corrígelos y vuelve a lanzar esto.',
      repetidos;
  end if;
end $$;

create unique index if not exists sea_employees_empresa_numero_trabajador_uq
  on sea_employees (company_id, numero_trabajador)
  where numero_trabajador is not null;
