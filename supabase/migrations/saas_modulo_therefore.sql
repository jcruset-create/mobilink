-- ============================================================
-- Mobilink SaaS — módulo «therefore» como licencia y como acceso de usuario.
--
-- Sin esto, `requireModule("therefore")` contesta 403 a todo el mundo: el
-- módulo existe, la API está montada y nadie puede entrar. Y `app_mis_modulos`
-- no lo enseñaría en el hub de Inicio.
--
-- Los CHECK de app_licencias.modulo y app_usuario_modulos.modulo se reconstruyen
-- con la UNIÓN de lo que ya admiten hoy (los valores que haya en las tablas) y
-- la lista completa de módulos, incluido «therefore». Así no se pisa ningún
-- valor que otra migración haya añadido por su cuenta, y es idempotente.
--
-- Mismo molde que saas_modulo_assist.sql.
--
-- OJO: esta lista vive en TRES sitios que se pisan, y los otros dos son código
-- que se ejecuta en CADA arranque:
--
--   · MODULOS_LICENCIABLES en server/db.ts
--   · MODULOS en server/central/schema.ts
--
-- Los dos ya llevan «therefore». Si a alguno le faltara, su ALTER TABLE
-- fallaría en cuanto existiera la primera licencia — y en central/schema.ts el
-- DROP y el ADD no van en la misma transacción, así que la tabla se quedaría
-- SIN restricción y el error sólo saldría en el log del despliegue.
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
                        'therefore']) as m
    union
    select modulo from app_licencias
    union
    select modulo from app_usuario_modulos
  ) t;

  execute 'alter table app_licencias drop constraint if exists app_licencias_modulo_check';
  execute format('alter table app_licencias add constraint app_licencias_modulo_check check (modulo in (%s))', v_lista);

  execute 'alter table app_usuario_modulos drop constraint if exists app_usuario_modulos_modulo_check';
  execute format('alter table app_usuario_modulos add constraint app_usuario_modulos_modulo_check check (modulo in (%s))', v_lista);

  /*
   * Licencia sin caducidad para SEA Tarragona, que es el tenant que lo va a
   * usar. El uuid fijo es el que siembra saas_fase1_empresas_licencias.sql.
   *
   * Va DENTRO de este bloque a propósito. Un `insert ... where
   * to_regclass(...) is not null` de nivel superior no protege nada: PostgreSQL
   * resuelve la tabla al planificar la sentencia, así que falla con «relation
   * does not exist» antes de mirar el WHERE. Aquí el `return` de arriba ya ha
   * decidido, y PL/pgSQL no prepara esta sentencia si no se llega a ella.
   */
  insert into app_licencias (empresa_id, modulo)
  select '00000000-0000-4000-a000-000000000001', 'therefore'
  where not exists (
    select 1 from app_licencias
     where empresa_id = '00000000-0000-4000-a000-000000000001'
       and modulo = 'therefore'
  );

  raise notice 'OK: módulos admitidos → %', v_lista;
end
$migracion$;

-- ── Comprobación ────────────────────────────────────────────
do $$
begin
  if to_regclass('public.app_licencias') is null then
    raise notice 'Sin app_licencias: no se comprueba nada';
    return;
  end if;

  -- Que el CHECK admita el valor nuevo: si no, el insert de arriba habría
  -- fallado y el módulo sería inaccesible sin que nadie supiera por qué.
  if not exists (
    select 1 from app_licencias
     where empresa_id = '00000000-0000-4000-a000-000000000001' and modulo = 'therefore')
  then
    raise exception 'No se ha podido dar licencia de therefore a SEA';
  end if;

  raise notice 'OK: módulo therefore contratable y con licencia para SEA';
  raise notice 'Recuerda dar acceso a cada usuario: insert into app_usuario_modulos (user_id, modulo, rol) values (..., ''therefore'', ''gestor'')';
end $$;
