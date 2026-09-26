/*
 * ════════════════════════════════════════════════════════════════════════════
 *  FASE 0 DE SEGURIDAD — MIGRACIÓN PREPARADA, **SIN APLICAR**
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Este fichero NO está en `supabase/migrations/`: está en
 * `supabase/migraciones-preparadas/` a propósito, para que no lo recoja ningún
 * despliegue automático. Se aplica a mano, con autorización explícita, y con el
 * plan de vuelta atrás de más abajo delante.
 *
 * Cierra cuatro agujeros del informe de seguridad que viven en la base de datos
 * y no en el código:
 *
 *   SEC-002  88 tablas de `public` sin RLS, alcanzables con la clave pública que
 *            va embebida en las APKs. Entre ellas `central_api_tokens`, toda la
 *            caja, los expedientes de tacógrafos y los albaranes.
 *   SEC-010  `pres_records` y los acuses de documentos abiertos a `anon`:
 *            cualquiera leía los fichajes de todos y podía cambiar una hora de
 *            entrada o marcar un documento como firmado por otro.
 *   SEC-004  `app_guardar_usuario` escribía `es_superadmin` sin comprobar que
 *            quien llama lo sea: un admin de módulo de una empresa cliente se
 *            hacía superadministrador de plataforma. Se cierra con un
 *            DISPARADOR sobre `app_usuarios`, no reescribiendo la función: ver
 *            la sección 4, que explica por qué reescribirla era imposible y
 *            además peligroso.
 *   SEC-005  `app_eliminar_usuario` es la misma causa raíz por otra superficie:
 *            `app_es_admin()` a secas, sin empresa y sin proteger a los
 *            superadministradores. El mismo disparador lo cubre, y la sección 5
 *            cierra además el borrado de la cuenta de Auth.
 *   SEC-003  La política de `perfiles_usuario` (`USING (true)` para cualquier
 *            autenticado) permitía escribirse `rol = 'admin'`.
 *
 * Y además: endurece el `search_path` de las funciones de las que depende la
 * autorización (hallazgo nuevo de la revisión, sección 7) y crea las dos tablas
 * que hacen falta: la de bajas de Auth y la de bloqueos de login.
 *
 * ── ANTES DE APLICARLA ─────────────────────────────────────────────────────
 *
 * 1. Ejecutar `verificacion-previa.sql` (al lado de este fichero) y revisar la
 *    salida. Importa sobre todo la primera consulta: este fichero solo conoce
 *    las tablas creadas en migraciones, y hay tablas creadas a mano en el
 *    dashboard cuyo estado no se puede saber desde el repositorio. La lista de
 *    abajo es un suelo, no un techo.
 * 2. Comprobar que ningún cliente lee esas tablas directamente con la clave
 *    pública. Se ha comprobado sobre el código: las 141 tablas que lee el panel
 *    y las 40 que leen las APKs no incluyen ninguna de estas. Si alguien ha
 *    añadido una lectura después, saldrá como fallo inmediato.
 * 3. Aplicarla en una ventana en la que se pueda mirar el resultado.
 *
 * ── VUELTA ATRÁS ───────────────────────────────────────────────────────────
 *
 * Todo lo de aquí es reversible y no borra datos. El fichero
 * `NNN_seguridad_fase0_rollback.sql` deshace exactamente esto.
 *
 * Aviso honesto sobre el rollback de la RLS: volver a dejar estas tablas
 * abiertas a `anon` es restaurar la vulnerabilidad. Está escrito porque un plan
 * de vuelta atrás que no existe es un plan que no se puede aprobar, no porque
 * ejecutarlo sea buena idea.
 */

begin;

-- ───────────────────────────────────────────────────────────────────────────
-- 1) SEC-002 · RLS en las tablas que no la tenían
-- ───────────────────────────────────────────────────────────────────────────
--
-- Sin políticas a propósito: a estas tablas solo llega el servidor, que usa la
-- clave de servicio y no pasa por RLS. Activar RLS sin políticas es la forma
-- correcta de decir «por PostgREST no se entra». Añadir políticas permisivas
-- para «no romper nada» sería volver al punto de partida.
--
-- El `revoke` va además de la RLS, y no en su lugar, porque son dos cosas
-- distintas: la RLS filtra filas y el `revoke` quita el permiso de tabla. Con
-- las dos, un fallo en cualquiera de ellas no abre la puerta sola.

do $$
declare
  t text;
  faltan text[] := array[
    'app_zonas',
    'cash_advances',
    'cash_bank_deposit_sessions',
    'cash_bank_deposits',
    'cash_change_order_lines',
    'cash_change_orders',
    'cash_count_lines',
    'cash_counts',
    'cash_denomination_movements',
    'cash_denominations',
    'cash_document_counters',
    'cash_erp_configs',
    'cash_erp_logs',
    'cash_erp_outbox',
    'cash_event_outbox',
    'cash_external_documents',
    'cash_operation_documents',
    'cash_operation_payments',
    'cash_operations',
    'cash_payment_methods',
    'cash_reauth',
    'cash_registers',
    'cash_sessions',
    'cash_transfer_lines',
    'cash_transfers',
    'central_api_clients',
    'central_api_tokens',
    'central_bank_deposits',
    'central_bank_statements',
    'central_denomination_stock',
    'central_deposit_sources',
    'central_events',
    'central_float_topups',
    'central_incidents',
    'central_notification_channels',
    'central_notifications',
    'central_registers',
    'central_rules',
    'central_sessions',
    'central_statement_lines',
    'central_transits',
    'central_webhook_deliveries',
    'central_webhooks',
    'erp_articulo_plantilla',
    'orm_avisos',
    'orm_blocs',
    'orm_config',
    'orm_documentos',
    'orm_entregas',
    'orm_eventos',
    'orm_or',
    'orm_procesamientos',
    'rcp_albaran_lineas',
    'rcp_albaranes',
    'rcp_avisos',
    'rcp_buzon_pasadas',
    'rcp_config',
    'rcp_contadores',
    'rcp_correos',
    'rcp_documentos',
    'rcp_eventos',
    'rcp_incidencias',
    'rcp_operarios',
    'rcp_pedido_lineas',
    'rcp_pedidos',
    'rcp_proveedor_articulos',
    'rcp_proveedores',
    'rcp_recepcion_lineas',
    'rcp_recepciones',
    'rcp_rectificacion_lineas',
    'rcp_rectificaciones',
    'recepciones_vehiculo',
    'recordatorios_caducidad',
    'tac_centros',
    'tac_comunicaciones',
    'tac_documentos',
    'tac_expedientes',
    'tac_firmas',
    'tac_plantillas',
    'tc_contadores_numero_interno',
    'tc_contadores_numero_operacion',
    'thf_albaran_linea_descuentos',
    'thf_albaran_lineas',
    'thf_albaranes_analizados',
    'thf_buzon_pasadas',
    'thf_documentos',
    'thf_validaciones',
    'vacaciones_config'
  ];
begin
  foreach t in array faltan loop
    if to_regclass('public.' || quote_ident(t)) is null then
      raise notice 'La tabla % no existe en este proyecto, se salta', t;
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    /*
     * PUBLIC va PRIMERO y no es adorno. Si a una tabla se le concedió algo a
     * PUBLIC alguna vez, `revoke ... from anon` no quita nada: `anon` hereda de
     * PUBLIC y sigue entrando. Comprobado contra PostgreSQL 16:
     * `grant select on t to public` + `revoke all on t from anon` deja
     * `has_table_privilege('anon','t','select')` en cierto. Es el mismo patrón
     * que apareció con app_login_email, y aquí aplica igual.
     */
    execute format('revoke all on public.%I from public', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
  end loop;
end $$;

-- Y que una tabla NUEVA no nazca abierta. Esto es lo que evita que la lista de
-- arriba vuelva a crecer: el defecto de Supabase concede todo a anon y
-- authenticated en cada tabla que se crea.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on tables from authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 2) SEC-010 · Fuera las políticas abiertas a `anon`
-- ───────────────────────────────────────────────────────────────────────────
--
-- Las migraciones 007-009 endurecieron `pres_login` pero nunca retiraron estas
-- políticas, así que la puerta de al lado siguió abierta: con la clave pública
-- se listaban todos los fichajes, se cambiaba una hora de entrada o se marcaba
-- un documento como firmado en nombre de otro empleado. Eso es registro de
-- jornada y evidencia de firma.
--
-- Las apps de Presencia y Safety no se quedan sin nada: entran por
-- `/api/presencia-operator/*`, que va por el servidor.

drop policy if exists "pres_anon_select" on pres_records;
drop policy if exists "pres_anon_insert" on pres_records;
drop policy if exists "pres_anon_update" on pres_records;
revoke all on pres_records from anon;

do $$
begin
  if to_regclass('public.sm_document_acknowledgements') is not null then
    execute 'drop policy if exists "sm_ack_anon_select" on sm_document_acknowledgements';
    execute 'drop policy if exists "sm_ack_anon_insert" on sm_document_acknowledgements';
    execute 'drop policy if exists "sm_ack_anon_update" on sm_document_acknowledgements';
    execute 'revoke all on sm_document_acknowledgements from anon';
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3) SEC-003 · `perfiles_usuario` deja de ser escribible por cualquiera
-- ───────────────────────────────────────────────────────────────────────────
--
-- La política era `for all to authenticated using (true) with check (true)`.
-- Con ella, cualquier usuario autenticado del proyecto —incluido un operario de
-- otra app, porque el proyecto de Supabase es uno— podía escribir su propia
-- fila y ponerse `rol = 'admin'`. A partir de ahí, la Edge Function
-- `admin-update-user` le dejaba cambiar la contraseña de cualquiera.
--
-- Se separa lectura de escritura: leer sigue abierto a los autenticados (lo
-- usan las pantallas de almacén), y escribir pasa a ser solo de quien ya es
-- admin, sin poder tocar su propio rol.

do $$
begin
  if to_regclass('public.perfiles_usuario') is null then
    raise notice 'perfiles_usuario no existe en este proyecto, se salta';
    return;
  end if;

  execute 'drop policy if exists almacen_solo_autenticados on perfiles_usuario';
  -- Idempotente: sin estos tres `drop`, una segunda pasada moría con
  -- «policy "perfiles_lectura" already exists». Comprobado ejecutándola dos
  -- veces seguidas.
  execute 'drop policy if exists perfiles_lectura on perfiles_usuario';
  execute 'drop policy if exists perfiles_escritura_admin on perfiles_usuario';
  execute 'drop policy if exists perfiles_alta_admin on perfiles_usuario';

  execute $pol$
    create policy perfiles_lectura on perfiles_usuario
      for select to authenticated using (true)
  $pol$;

  -- Escribir: solo un admin activo, y el rol propio no se toca.
  execute $pol$
    create policy perfiles_escritura_admin on perfiles_usuario
      for update to authenticated
      using (
        exists (
          select 1 from perfiles_usuario p
          where p.user_id = auth.uid() and p.activo and p.rol = 'admin'
        )
      )
      with check (
        exists (
          select 1 from perfiles_usuario p
          where p.user_id = auth.uid() and p.activo and p.rol = 'admin'
        )
      )
  $pol$;

  execute $pol$
    create policy perfiles_alta_admin on perfiles_usuario
      for insert to authenticated
      with check (
        exists (
          select 1 from perfiles_usuario p
          where p.user_id = auth.uid() and p.activo and p.rol = 'admin'
        )
      )
  $pol$;
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 4) SEC-004 y SEC-005 · nadie concede ni borra lo que no le corresponde
-- ───────────────────────────────────────────────────────────────────────────
--
-- ── Qué se arregla ─────────────────────────────────────────────────────────
--
-- `app_guardar_usuario` escribía `es_superadmin` tal como llegara en el
-- parámetro, y solo la protegía `app_es_admin()`, que es cierto para cualquier
-- `adm_usuarios.rol = 'admin'` de CUALQUIER empresa. Un administrador del módulo
-- de administración de una empresa cliente se llamaba a sí mismo con
-- `p_es_superadmin := true` y salía siendo superadministrador de plataforma.
-- `app_eliminar_usuario` tenía el mismo patrón para desactivar y borrar.
--
-- ── Por qué un DISPARADOR y no reescribir las funciones ────────────────────
--
-- La primera versión de esta migración hacía `create or replace` de las dos
-- funciones con las comprobaciones añadidas. Estaba mal por dos razones que
-- solo salieron al probarla, y las dos merecen quedar escritas:
--
-- 1. **No se puede.** El último parámetro real se llama `p_accesos`, y
--    PostgreSQL rechaza `create or replace` si cambia el nombre de un parámetro:
--    «cannot change name of input parameter». La migración habría abortado
--    entera.
--
-- 2. **Y aunque se pudiera, era peligroso.** Reescribir la función obliga a
--    copiar sus cien líneas de lógica de negocio: la unicidad del nombre de
--    usuario, el «un empleado no puede tener dos cuentas», la comprobación de
--    licencia de cada módulo que se AÑADE, el borrado de accesos que ya no
--    están, el aforo de usuarios por licencia y la fila de auditoría cuando el
--    superadmin se pasa del tope. Una copia hecha a mano habría borrado en
--    silencio la mitad de eso. Un arreglo de seguridad que se lleva por delante
--    el control de licencias no es un arreglo.
--
-- Un disparador sobre `app_usuarios` no toca ninguna función, y además cubre
-- MÁS: cualquier camino de escritura —esa RPC, otra futura, el editor SQL del
-- dashboard, PostgREST directo— pasa por él. La regla vive junto al dato.
--
-- ── El escape para el servidor, dicho en voz alta ──────────────────────────
--
-- `auth.uid()` es null cuando escribe el backend (conexión directa con
-- DATABASE_URL, o service_role por PostgREST) y cuando corre una migración. En
-- ese caso el disparador deja pasar: el backend es de confianza y tiene sus
-- propias comprobaciones desde la Fase 0. Quien pudiera llegar con `auth.uid()`
-- nulo siendo un atacante necesitaría ya la contraseña de la base o la clave de
-- servicio, y entonces esto es lo de menos.

-- ── Sobre el propietario y el SECURITY DEFINER de este disparador ──────────
--
-- La función es `security definer` a propósito, y tiene que quedar dicho porque
-- es la clase de decisión que se copia sin pensar:
--
--   · necesita leer `es_superadmin` del que llama en CUALQUIER contexto. La RLS
--     de `app_usuarios` permite leer la propia fila (`id = auth.uid() or
--     app_es_admin()`), así que hoy funcionaría también como `security invoker`;
--     pero basta que mañana se acote esa política para que el disparador deje de
--     ver la fila y decida con información incompleta;
--   · no ejecuta SQL dinámico, así que no hay dónde inyectar nada;
--   · lleva `search_path = public, pg_temp` con `pg_temp` nombrado al final, que
--     es lo que impide suplantar `app_usuarios` con una tabla temporal (ver la
--     sección 7).
--
-- El PROPIETARIO importa: una función `security definer` corre con los
-- privilegios de su dueño. Al aplicar esta migración desde el editor SQL del
-- dashboard, el dueño será el rol que la ejecute —normalmente `postgres`—, que es
-- lo que hace falta para leer la tabla sin depender de la RLS. Si se aplica con
-- otro rol, conviene comprobar que ese rol puede leer `app_usuarios`.
--
-- Y una aclaración de reparto de papeles: la política `app_usuarios_write` ya
-- exige `app_es_admin()` para escribir, o sea «hay que ser algún tipo de
-- administrador». Lo que añade el disparador es la granularidad que faltaba
-- ENTRE administradores: cuál de ellos puede hacer qué, y sobre quién.

create or replace function app_usuarios_guardia()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_soy_super boolean;
  v_empresa_actor uuid;
begin
  -- Sin usuario final detrás: backend o migración. Ver el comentario de arriba.
  if v_actor is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  select coalesce(es_superadmin, false) into v_soy_super
    from app_usuarios where id = v_actor;
  v_soy_super := coalesce(v_soy_super, false);

  if v_soy_super then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  v_empresa_actor := app_empresa_actual();

  -- 1) Nadie concede un nivel que no tiene.
  if tg_op in ('INSERT', 'UPDATE') and coalesce(new.es_superadmin, false) then
    raise exception 'Solo un superadministrador puede conceder el superadministrador'
      using errcode = '42501';
  end if;

  -- 2) Y a un superadministrador no lo toca quien no lo es: ni para editarlo,
  --    ni para desactivarlo, ni para borrarlo.
  if tg_op in ('UPDATE', 'DELETE') and coalesce(old.es_superadmin, false) then
    raise exception 'Solo un superadministrador puede gestionar esa cuenta'
      using errcode = '42501';
  end if;

  -- 3) Cada administrador, con los de su empresa. El id de un usuario no es un
  --    secreto: sale en listados y en enlaces, así que saberlo no puede ser la
  --    autorización para editarlo o borrarlo.
  if tg_op in ('UPDATE', 'DELETE')
     and old.empresa_id is not null
     and v_empresa_actor is not null
     and old.empresa_id is distinct from v_empresa_actor then
    raise exception 'Ese usuario es de otra empresa' using errcode = '42501';
  end if;
  if tg_op in ('INSERT', 'UPDATE')
     and new.empresa_id is not null
     and v_empresa_actor is not null
     and new.empresa_id is distinct from v_empresa_actor then
    raise exception 'No puedes asignar un usuario a otra empresa' using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;

drop trigger if exists trg_app_usuarios_guardia_escritura on app_usuarios;
create trigger trg_app_usuarios_guardia_escritura
  before insert or update on app_usuarios
  for each row execute function app_usuarios_guardia();

drop trigger if exists trg_app_usuarios_guardia_borrado on app_usuarios;
create trigger trg_app_usuarios_guardia_borrado
  before delete on app_usuarios
  for each row execute function app_usuarios_guardia();

-- ───────────────────────────────────────────────────────────────────────────
-- 5) El id de Auth se autoriza ANTES de perder la empresa a la que pertenece
-- ───────────────────────────────────────────────────────────────────────────
--
-- Flujo del borrado de un usuario, tal como está hoy:
--
--   1. la pantalla llama a la RPC `app_eliminar_usuario(p_id)`, que borra —o
--      desactiva, si tiene historial— la fila de `app_usuarios`;
--   2. después llama a `POST /api/administracion/usuarios/eliminar-auth`, que
--      comprueba que la ficha YA NO EXISTE y borra la cuenta de `auth.users`.
--
-- El problema es el paso 2: cuando le llega el turno, la relación
-- usuario → empresa ya no existe, así que no puede autorizar nada. Acepta
-- cualquier `userId` cuya ficha no esté, y hay cuentas de `auth.users` que nunca
-- tuvieron ficha en `app_usuarios`: operarios con email sintético, usuarios que
-- solo viven en `tc_usuarios`. Un administrador de la empresa A podía borrar la
-- cuenta de acceso de alguien de la empresa B.
--
-- La propiedad que hace falta es: **ningún identificador de `auth.users` llega a
-- una operación destructiva sin haber sido autorizado contra su empresa antes de
-- perder esa información.** Se consigue dejando constancia en el momento en que
-- todavía se sabe: la RPC apunta la baja, con la empresa y quién la pidió, y el
-- endpoint solo borra lo que esté apuntado.

create table if not exists app_bajas_auth (
  user_id        uuid primary key,
  empresa_id     uuid,
  solicitado_por uuid,
  creado_en      timestamptz not null default now()
);

alter table app_bajas_auth enable row level security;
revoke all on app_bajas_auth from public;
revoke all on app_bajas_auth from anon;
revoke all on app_bajas_auth from authenticated;

-- Lo apunta el propio disparador de borrado: así queda constancia tanto si la
-- baja viene de la RPC como de cualquier otro camino, y no hay que copiar el
-- cuerpo de la función (ver el razonamiento del punto 4).
create or replace function app_apunta_baja_auth()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into app_bajas_auth (user_id, empresa_id, solicitado_por)
  values (old.id, old.empresa_id, auth.uid())
  on conflict (user_id) do update
    set empresa_id     = excluded.empresa_id,
        solicitado_por = excluded.solicitado_por,
        creado_en      = now();
  return old;
end $$;

drop trigger if exists trg_app_usuarios_apunta_baja on app_usuarios;
create trigger trg_app_usuarios_apunta_baja
  after delete on app_usuarios
  for each row execute function app_apunta_baja_auth();

-- ───────────────────────────────────────────────────────────────────────────
-- 6) SEC-065 · `app_login_email` deja de contestar a cualquiera
-- ───────────────────────────────────────────────────────────────────────────
--
-- Devolvía el email interno de Auth de cualquier usuario activo a quien
-- preguntara con la clave pública: un enumerador de usuarios, y la mitad de lo
-- que hace falta para probar contraseñas contra Supabase. La resolución
-- usuario → identidad pasa a hacerse en el servidor, que ya tiene la clave de
-- servicio; la función se queda para que la use él.

-- OJO con el orden: `revoke ... from anon` NO basta. El defecto de PostgreSQL
-- concede EXECUTE a PUBLIC en cada función que se crea, y `anon` hereda de
-- PUBLIC, así que sin quitarlo de PUBLIC la función seguía siendo ejecutable
-- por cualquiera. Se comprobó ejecutando esta migración contra una base de
-- pruebas: el primer intento dejaba `has_function_privilege('anon', ...)` en
-- cierto. Es el mismo patrón que el informe señaló en las 170 funciones
-- `security definer` del proyecto.
revoke execute on function app_login_email(text) from public;
revoke execute on function app_login_email(text) from anon;
revoke execute on function app_login_email(text) from authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 7) HALLAZGO NUEVO · el `search_path` de las funciones `security definer`
-- ───────────────────────────────────────────────────────────────────────────
--
-- Salió al revisar esta migración, y no estaba en el informe. Todas las
-- funciones `security definer` del proyecto —unas 170— se declaran con
-- `set search_path = public`. Eso NO basta: PostgreSQL busca el esquema temporal
-- ANTES que los nombrados, salvo que `pg_temp` se nombre explícitamente. Así que
-- quien pueda crear una tabla temporal suplanta las tablas que la función lee.
--
-- Comprobado contra PostgreSQL 16, con `app_es_admin()` reproducida:
--
--   set search_path = public            → crear pg_temp.app_usuarios con
--                                         es_superadmin = true hace que
--                                         app_es_admin() devuelva CIERTO
--   set search_path = public, pg_temp   → devuelve falso, el ataque no entra
--
-- Y `app_es_admin()` es la puerta de `app_guardar_usuario` y
-- `app_eliminar_usuario`: con ella en cierto, se abre lo demás.
--
-- ── Alcance real, dicho sin inflarlo ───────────────────────────────────────
--
-- Crear una tabla temporal exige una conexión directa a PostgreSQL. Por
-- PostgREST no se puede: solo admite llamar funciones y consultar, no DDL. Así
-- que esto NO es explotable con la clave publicable de las APKs; hace falta la
-- contraseña de la base o algo equivalente. Es endurecimiento en profundidad,
-- no una escalada remota: por eso va aquí y no en la lista de críticos.
--
-- Aquí se arreglan solo las funciones que esta migración toca o de las que
-- depende. El barrido de las 170 va con SEC-043, en la Fase 3: `alter function`
-- no cambia el cuerpo, así que es mecánico, pero son 170 firmas y conviene
-- generarlas leyendo el catálogo y no a mano.

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as firma
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef                                -- security definer
       and p.proname in ('app_es_admin', 'app_empresa_actual',
                         'app_guardar_usuario', 'app_eliminar_usuario',
                         'app_login_email', 'app_licencia_activa')
  loop
    execute format('alter function %s set search_path = public, pg_temp', f.firma);
    raise notice 'search_path endurecido en %', f.firma;
  end loop;
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 8) Tabla de bloqueos de login
-- ───────────────────────────────────────────────────────────────────────────
--
-- El freno de intentos ya funciona sin esto, en memoria del proceso. Con la
-- tabla, un reinicio —y este servicio reinicia— deja de regalar un contador a
-- cero. `clave` es `tipo:ámbito:valor`; nunca contiene una contraseña.

create table if not exists app_auth_intentos (
  clave               text primary key,
  bloqueado_hasta_ms  bigint not null default 0,
  bloqueos            integer not null default 0,
  actualizado_en      timestamptz not null default now()
);

alter table app_auth_intentos enable row level security;
revoke all on app_auth_intentos from anon;
revoke all on app_auth_intentos from authenticated;

create index if not exists idx_app_auth_intentos_bloqueo
  on app_auth_intentos (bloqueado_hasta_ms);

commit;
