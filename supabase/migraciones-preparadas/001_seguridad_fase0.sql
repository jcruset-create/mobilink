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
 *            hacía superadministrador de plataforma.
 *   SEC-005  `app_eliminar_usuario` tenía el mismo patrón: `app_es_admin()` a
 *            secas, sin empresa y sin proteger a los superadministradores.
 *   SEC-003  La política de `perfiles_usuario` (`USING (true)` para cualquier
 *            autenticado) permitía escribirse `rol = 'admin'`.
 *
 * Y crea la tabla que hace que los bloqueos de login sobrevivan a un reinicio.
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
-- 4) SEC-004 · `app_guardar_usuario` no concede lo que no se tiene
-- ───────────────────────────────────────────────────────────────────────────
--
-- La función calculaba `v_soy_super` y solo lo usaba para el chequeo de «otra
-- empresa». El `es_superadmin` lo escribía tal como llegara en el parámetro, y
-- la protegía `app_es_admin()`, que es cierto para cualquier
-- `adm_usuarios.rol = 'admin'` de cualquier empresa. Es decir: el administrador
-- del módulo de administración de una empresa cliente se llamaba a sí mismo con
-- `p_es_superadmin := true` y salía siendo superadministrador de plataforma, con
-- acceso a `/api/admin/*`, a todas las empresas y a todas las licencias.
--
-- Se añaden dos reglas y no se toca nada más de la función. El `create or
-- replace` completo va aquí porque no se puede parchear media función: el
-- cuerpo es el mismo que el de `administracion_fase12_licencia_en_alta_usuario.sql`
-- con las dos comprobaciones nuevas marcadas.

create or replace function app_guardar_usuario(
  p_id uuid,
  p_username text,
  p_nombre text,
  p_email_recuperacion text,
  p_telefono text,
  p_activo boolean,
  p_es_superadmin boolean,
  p_employee_id uuid,
  p_modulos jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_soy_super boolean;
  v_empresa uuid;
  v_empresa_previa uuid;
  v_objetivo_super boolean;
begin
  if not app_es_admin() then
    raise exception 'Solo un administrador puede gestionar usuarios';
  end if;

  select coalesce(es_superadmin, false) into v_soy_super
  from app_usuarios where id = auth.uid();
  v_soy_super := coalesce(v_soy_super, false);

  -- NUEVO (SEC-004): nadie concede un nivel que no tiene.
  if coalesce(p_es_superadmin, false) and not v_soy_super then
    raise exception 'Solo un superadministrador puede conceder el superadministrador';
  end if;

  -- NUEVO (SEC-004): y a un superadministrador existente no lo edita quien no
  -- lo es; si no, se le podría desactivar o cambiarle el nombre de usuario.
  select coalesce(es_superadmin, false) into v_objetivo_super
  from app_usuarios where id = p_id;
  if coalesce(v_objetivo_super, false) and not v_soy_super then
    raise exception 'Solo un superadministrador puede editar esa cuenta';
  end if;

  select empresa_id into v_empresa_previa from app_usuarios where id = p_id;

  select coalesce(
           v_empresa_previa,
           app_empresa_actual(),
           '00000000-0000-4000-a000-000000000001'::uuid)
    into v_empresa;

  -- Cada administrador, con los suyos.
  if not v_soy_super
     and v_empresa_previa is not null
     and v_empresa_previa is distinct from app_empresa_actual() then
    raise exception 'Ese usuario es de otra empresa';
  end if;

  insert into app_usuarios (id, username, nombre, email_recuperacion, telefono,
                            activo, es_superadmin, employee_id, empresa_id)
  values (p_id, p_username, p_nombre, p_email_recuperacion, p_telefono,
          coalesce(p_activo, true), coalesce(p_es_superadmin, false),
          p_employee_id, v_empresa)
  on conflict (id) do update set
    username           = excluded.username,
    nombre             = excluded.nombre,
    email_recuperacion = excluded.email_recuperacion,
    telefono           = excluded.telefono,
    activo             = excluded.activo,
    es_superadmin      = excluded.es_superadmin,
    employee_id        = excluded.employee_id,
    updated_at         = now()
  returning id into v_id;

  if p_modulos is not null then
    delete from app_usuario_modulos where user_id = v_id;
    insert into app_usuario_modulos (user_id, modulo, rol, pantallas, empresa_id)
    select v_id,
           m->>'modulo',
           m->>'rol',
           case when m ? 'pantallas' and jsonb_typeof(m->'pantallas') = 'array'
                then array(select jsonb_array_elements_text(m->'pantallas'))
                else null end,
           nullif(m->>'empresa_id', '')::uuid
    from jsonb_array_elements(p_modulos) as m;
  end if;

  return v_id;
end $$;

revoke execute on function app_guardar_usuario(uuid, text, text, text, text, boolean, boolean, uuid, jsonb) from public;
revoke execute on function app_guardar_usuario(uuid, text, text, text, text, boolean, boolean, uuid, jsonb) from anon;
grant execute on function app_guardar_usuario(uuid, text, text, text, text, boolean, boolean, uuid, jsonb) to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 5) SEC-005 · `app_eliminar_usuario`: ni de otra empresa, ni superadmins
-- ───────────────────────────────────────────────────────────────────────────
--
-- Tenía el mismo patrón: `app_es_admin()` a secas. Un admin de módulo de una
-- empresa cliente desactivaba o borraba a cualquiera, superadministradores
-- incluidos. Y el endpoint `/api/administracion/usuarios/eliminar-auth` se apoya
-- en esta función para autorizar, porque cuando le llega el turno la ficha ya no
-- existe y no puede comprobar la empresa.

create or replace function app_eliminar_usuario(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_tiene_historial boolean;
  v_soy_super boolean;
  v_objetivo_super boolean;
  v_empresa_objetivo uuid;
begin
  if not app_es_admin() then
    raise exception 'Solo un administrador puede eliminar usuarios';
  end if;
  if p_id = auth.uid() then
    raise exception 'No puedes eliminar tu propio usuario';
  end if;

  select coalesce(es_superadmin, false) into v_soy_super
  from app_usuarios where id = auth.uid();
  v_soy_super := coalesce(v_soy_super, false);

  select coalesce(es_superadmin, false), empresa_id
    into v_objetivo_super, v_empresa_objetivo
  from app_usuarios where id = p_id;

  -- NUEVO (SEC-005): a un superadministrador no lo borra quien no lo es.
  if coalesce(v_objetivo_super, false) and not v_soy_super then
    raise exception 'Solo un superadministrador puede eliminar esa cuenta';
  end if;

  -- NUEVO (SEC-005): y cada administrador, con los de su empresa.
  if not v_soy_super
     and v_empresa_objetivo is not null
     and v_empresa_objetivo is distinct from app_empresa_actual() then
    raise exception 'Ese usuario es de otra empresa';
  end if;

  v_tiene_historial :=
       exists (select 1 from adm_payments where registered_by = p_id)
    or exists (select 1 from adm_recovery_actions where user_id = p_id)
    or exists (select 1 from adm_payment_tracking_actions where user_id = p_id)
    or exists (select 1 from adm_payment_tracking where responsible_user = p_id)
    or exists (select 1 from adm_recovery_cases where responsible_user = p_id)
    or exists (select 1 from adm_notificaciones where created_by = p_id);

  if v_tiene_historial then
    update app_usuarios set activo = false where id = p_id;
    return 'desactivado';
  end if;

  delete from app_usuarios where id = p_id;
  return 'eliminado';
end $$;

revoke execute on function app_eliminar_usuario(uuid) from public;
revoke execute on function app_eliminar_usuario(uuid) from anon;
grant execute on function app_eliminar_usuario(uuid) to authenticated;

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
-- 7) Tabla de bloqueos de login
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
