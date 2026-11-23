-- =============================================================================
-- Core · Enlazar trabajadores con los módulos (Fase B)
-- =============================================================================
--
-- QUÉ HACE
--   Añade employee_id → sea_employees(id) a las tablas de operarios de los
--   módulos que aún no lo tienen:
--     · perfiles_usuario  (Almacén)
--     · rcp_operarios     (Recepciones)
--     · tc_usuarios       (TyreControl; solo se enlazarán los operarios internos)
--   La columna es opcional y la FK es ON DELETE SET NULL: borrar un empleado
--   de Core no borra al usuario del módulo, solo lo desenlaza.
--
-- QUÉ NO HACE
--   · No enlaza a nadie: eso se hace a mano en Core → Enlazar trabajadores.
--   · No toca techs, app_usuarios ni cash_expense_targets: ya tienen employee_id.
--   · No copia ningún dato entre tablas ni añade triggers. No hay DROP.
--   · No cambia logins ni PIN de ninguna app.
--   · Si una de las tres tablas no existe en esta base, se la salta.
--
-- ORDEN
--   1. core_numero_trabajador.sql (Fase A) tiene que estar ejecutado antes.
--   2. ESTE FICHERO.
--   3. Enlazar desde Core → Enlazar trabajadores. La pantalla funciona también
--      antes de este paso: esas tres pestañas avisan de que falta la migración.
--
-- IDEMPOTENTE: se puede ejecutar las veces que haga falta.
-- =============================================================================

do $$
declare
  t text;
begin
  foreach t in array array['perfiles_usuario', 'rcp_operarios', 'tc_usuarios'] loop
    if to_regclass(t) is null then
      raise notice 'La tabla % no existe en esta base: se salta.', t;
      continue;
    end if;

    execute format('alter table %I add column if not exists employee_id uuid', t);

    if not exists (
      select 1 from pg_constraint
       where conname = t || '_employee_id_fkey'
         and conrelid = t::regclass
    ) then
      execute format(
        'alter table %I add constraint %I foreign key (employee_id) '
        'references sea_employees(id) on delete set null',
        t, t || '_employee_id_fkey'
      );
    end if;

    execute format(
      'create index if not exists %I on %I (employee_id) where employee_id is not null',
      t || '_employee_id_idx', t
    );

    execute format(
      'comment on column %I.employee_id is %L',
      t,
      'Persona de Core (sea_employees) a la que corresponde este usuario. '
      'Se enlaza a mano por número de trabajador. La identidad se lee de Core.'
    );
  end loop;
end $$;
