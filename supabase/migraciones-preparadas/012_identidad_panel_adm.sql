/*
 * IDENTIFICAR AL USUARIO DEL PANEL DE ADMINISTRACIÓN — SOLO LECTURA
 *
 * Confirma o descarta la causa raíz propuesta: que el usuario del smoke test
 * es un SUPERADMIN DE PLATAFORMA sin fila en `adm_usuarios`, al que el panel
 * le fabrica un perfil sintético de «admin» en el navegador mientras la base
 * de datos no sabe nada de él.
 *
 * No devuelve contraseñas, ni hashes, ni tokens. Devuelve UUID, nombre de
 * usuario, rol y estado de actividad, que es lo mínimo para cruzar las tablas.
 */

select jsonb_build_object(
'meta', jsonb_build_object('fecha_utc', now()),

-- ── 1) Quién hay en adm_usuarios, y si su id existe en auth.users ─────────
-- Si `en_auth_users` saliera falso para alguno, el enlace estaría roto y
-- `adm_rol_actual()` nunca lo encontraría.
'adm_usuarios', (select coalesce(jsonb_agg(jsonb_build_object(
    'id', u.id,
    'nombre', u.nombre,
    'rol', u.rol::text,
    'activo', u.activo,
    'en_auth_users', exists (select 1 from auth.users au where au.id = u.id)
  ) order by u.rol::text, u.nombre),'[]'::jsonb)
  from adm_usuarios u),

-- ── 2) Los superadministradores de plataforma ────────────────────────────
-- Y, la columna que lo decide todo: si tienen o no fila en `adm_usuarios`.
-- El panel les da perfil de «admin» aunque no la tengan; la base, no.
'superadmins', (select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'username', a.username,
    'activo', a.activo,
    'tiene_fila_en_adm_usuarios', exists (select 1 from adm_usuarios x where x.id = a.id),
    'rol_en_adm_usuarios', (select x.rol::text from adm_usuarios x where x.id = a.id),
    'tiene_acceso_al_modulo', exists (select 1 from app_usuario_modulos m
                                       where m.user_id = a.id and m.modulo = 'administracion')
  ) order by a.username),'[]'::jsonb)
  from app_usuarios a where coalesce(a.es_superadmin,false)),

-- ── 3) Quién tiene acceso al módulo según app_usuario_modulos ────────────
-- Es la tabla desde la que `app_sync_acceso()` rellena `adm_usuarios`. Si hay
-- filas aquí que no tienen espejo allí, la sincronización no corrió.
'acceso_modulo_administracion', (select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', m.user_id,
    'username', (select a.username from app_usuarios a where a.id = m.user_id),
    'rol_en_el_modulo', m.rol::text,
    'usuario_activo', (select a.activo from app_usuarios a where a.id = m.user_id),
    'espejo_en_adm_usuarios', exists (select 1 from adm_usuarios x where x.id = m.user_id)
  ) order by m.user_id),'[]'::jsonb)
  from app_usuario_modulos m where m.modulo = 'administracion'),

-- ── 4) El recuento que ya conocemos, para tenerlo todo en la misma salida ─
'recuento_roles', (select coalesce(jsonb_agg(jsonb_build_object(
    'rol', rol::text, 'activo', activo, 'n', n) order by rol::text, activo),'[]'::jsonb)
  from (select rol, activo, count(*) as n from adm_usuarios group by rol, activo) z),

-- ── 5) Cuántas cuentas de Auth hay en total ──────────────────────────────
-- Solo el número. Si es mucho mayor que las filas de adm_usuarios, confirma
-- que la mayoría de autenticados del proyecto NO son de este módulo: son los
-- que hoy leen la vista por el salto de privilegios.
'total_cuentas_auth', (select count(*) from auth.users)
) as identidad_panel;
