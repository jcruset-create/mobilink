-- =============================================================================
-- Core · Teléfono de empresa en la ficha del empleado
-- =============================================================================
--
-- QUÉ HACE
--   1. Añade sea_employees.telefono_empresa (TEXT, opcional): el móvil o la
--      extensión que la empresa le ha asignado, si tiene. El `telefono` de
--      siempre queda como el personal.
--   2. Pasa UNA VEZ a ese campo el teléfono que cada técnico tiene hoy en
--      Taller (techs.phone), solo para los técnicos enlazados con Core y solo
--      si el empleado aún no tiene teléfono de empresa. A partir de aquí el
--      teléfono de un técnico enlazado se lee de Core y se cambia en Core.
--
-- QUÉ NO HACE
--   · No toca el teléfono personal (sea_employees.telefono).
--   · No borra ni cambia techs.phone: se queda como estaba (sin DROP). Lo
--      siguen usando los técnicos que no estén enlazados.
--   · No pisa un teléfono de empresa que ya esté puesto.
--   · No añade triggers: es una copia de una sola vez, no una sincronización.
--   · Si en esta base no hay tabla techs (o no tiene employee_id / phone), se
--     salta el paso 2.
--
-- ORDEN
--   1. core_numero_trabajador.sql y core_enlace_modulos.sql, ya ejecutados.
--   2. ESTE FICHERO.
--   El servidor y la web funcionan también ANTES de este paso: mientras la
--   columna no exista, Taller sigue enseñando su propio teléfono.
--
-- IDEMPOTENTE: se puede ejecutar las veces que haga falta. Si más adelante se
--   enlaza un técnico que tenía teléfono en Taller, volver a ejecutarlo se lo
--   pasa a Core.
-- =============================================================================

-- 1. La columna.
alter table sea_employees
  add column if not exists telefono_empresa text;

comment on column sea_employees.telefono_empresa is
  'Teléfono que la empresa ha asignado a esta persona (móvil o extensión), si tiene. '
  'Es el que enseñan los módulos; `telefono` es el personal.';

-- 2. Lo que hoy está en Taller pasa a Core, una vez.
do $$
declare
  pasados int;
begin
  if to_regclass('techs') is null
     or not exists (
       select 1 from information_schema.columns
        where table_name = 'techs' and column_name = 'employee_id'
          and table_schema = any (current_schemas(false)))
     or not exists (
       select 1 from information_schema.columns
        where table_name = 'techs' and column_name = 'phone'
          and table_schema = any (current_schemas(false)))
  then
    raise notice 'Sin técnicos enlazados en esta base: no hay teléfonos que pasar.';
    return;
  end if;

  execute $sql$
    update sea_employees e
       set telefono_empresa = regexp_replace(t.phone, '[\s.()-]', '', 'g')
      from techs t
     where t.employee_id = e.id
       and e.telefono_empresa is null
       and nullif(regexp_replace(t.phone, '[\s.()-]', '', 'g'), '') is not null
  $sql$;
  get diagnostics pasados = row_count;
  raise notice 'Teléfonos de Taller pasados a Core: %', pasados;
end $$;
