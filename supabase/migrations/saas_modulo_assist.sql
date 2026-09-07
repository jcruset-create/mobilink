-- ============================================================
-- Mobilink SaaS — módulo «assist» (Mobilink Assist, asistencias en carretera)
-- como licencia y como acceso de usuario.
--
-- Hasta ahora Assist entraba por su propio login y no se podía contratar como
-- módulo. A partir de aquí una empresa puede tener licencia de «assist» y un
-- usuario acceso a él; app_mis_modulos los cruza y el panel enseña el acceso
-- directo en la cabecera de los otros módulos.
--
-- Los CHECK de app_licencias.modulo y app_usuario_modulos.modulo se
-- reconstruyen con la UNIÓN de lo que ya admiten hoy (los valores que haya en
-- las tablas) y la lista completa de módulos, incluido «assist». Así no se
-- pisa ningún valor que otra migración haya añadido por su cuenta, y es
-- idempotente.
-- ============================================================

do $migracion$
declare
  v_lista text;
begin
  if to_regclass('public.app_licencias') is null then
    raise notice 'Sin app_licencias: nada que hacer';
    return;
  end if;

  select string_agg(quote_literal(m), ',' order by m) into v_lista
  from (
    select unnest(array['administracion','tyrecontrol','almacen','sea-core','toolcontrol','safety',
                        'presencia','taller','workplanner','cash','central','tacografos','assist']) as m
    union
    select modulo from app_licencias
    union
    select modulo from app_usuario_modulos
  ) t;

  execute 'alter table app_licencias drop constraint if exists app_licencias_modulo_check';
  execute format('alter table app_licencias add constraint app_licencias_modulo_check check (modulo in (%s))', v_lista);

  execute 'alter table app_usuario_modulos drop constraint if exists app_usuario_modulos_modulo_check';
  execute format('alter table app_usuario_modulos add constraint app_usuario_modulos_modulo_check check (modulo in (%s))', v_lista);

  raise notice 'OK: módulos admitidos → %', v_lista;
end
$migracion$;
