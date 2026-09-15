-- ============================================================
-- Mobilink SaaS — módulo «recepciones» como licencia y como acceso de usuario.
--
-- Sin esto, `requireModule("recepciones")` contesta 403 a todo el mundo: el
-- módulo existe, la API está montada y nadie puede entrar. Y `app_mis_modulos`
-- no lo enseñaría en el hub de Inicio.
--
-- Los CHECK de app_licencias.modulo y app_usuario_modulos.modulo se reconstruyen
-- con la UNIÓN de lo que ya admiten hoy (los valores que haya en las tablas) y
-- la lista completa de módulos, incluido «recepciones». Idempotente.
--
-- Mismo molde que saas_modulo_therefore.sql.
--
-- OJO: esta lista vive en CUATRO sitios que se pisan, y tres son código que
-- se ejecuta en CADA arranque:
--
--   · MODULOS_LICENCIABLES en server/db.ts
--   · MODULOS en server/central/schema.ts
--   · registrarModuloRecepciones en server/recepciones/schema.ts
--
-- Los tres llevan ya «recepciones».
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
                        'presencia','taller','workplanner','cash','central','tacografos','assist',
                        'therefore','recepciones']) as m
    union
    select modulo from app_licencias
    union
    select modulo from app_usuario_modulos
  ) t;

  execute 'alter table app_licencias drop constraint if exists app_licencias_modulo_check';
  execute format('alter table app_licencias add constraint app_licencias_modulo_check check (modulo in (%s))', v_lista);

  execute 'alter table app_usuario_modulos drop constraint if exists app_usuario_modulos_modulo_check';
  execute format('alter table app_usuario_modulos add constraint app_usuario_modulos_modulo_check check (modulo in (%s))', v_lista);

  -- Licencia sin caducidad para SEA Tarragona (el uuid fijo de saas_fase1).
  insert into app_licencias (empresa_id, modulo)
  select '00000000-0000-4000-a000-000000000001', 'recepciones'
  where not exists (
    select 1 from app_licencias
     where empresa_id = '00000000-0000-4000-a000-000000000001'
       and modulo = 'recepciones'
  );

  raise notice 'OK: módulos admitidos → %', v_lista;
  raise notice 'Recuerda dar acceso a cada usuario: insert into app_usuario_modulos (user_id, modulo, rol) values (..., ''recepciones'', ''gestor'')';
end
$migracion$;
