-- ============================================================
-- Administración — Fase 11b: app_guardar_usuario rellena empresa_id
--
-- La fase SaaS 1 añadió `app_usuarios.empresa_id NOT NULL` (sin valor
-- por defecto) DESPUÉS de escribir `app_guardar_usuario`, que nunca lo
-- pone. Resultado: cualquier alta o edición de usuario fallaba con
--   null value in column "empresa_id" ... violates not-null constraint
-- porque el NOT NULL se comprueba sobre la fila del INSERT, antes de
-- resolver el ON CONFLICT.
--
-- La empresa se resuelve, en este orden:
--   1) la que ya tuviera el usuario (editar no la cambia nunca),
--   2) la del administrador que está dando de alta,
--   3) el tenant inicial, para no dejar el alta bloqueada si el
--      administrador es un usuario antiguo sin empresa.
--
-- Pegar en Supabase (SQL Editor). Idempotente.
-- ============================================================

create or replace function app_guardar_usuario(
  p_id uuid,
  p_username text,
  p_nombre text,
  p_email_recuperacion text,
  p_telefono text,
  p_activo boolean,
  p_es_superadmin boolean,
  p_employee_id uuid,
  p_accesos jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_acc jsonb;
  v_pantallas text[];
  v_empresa uuid;
begin
  if not app_es_admin() then
    raise exception 'Solo un administrador puede gestionar usuarios';
  end if;
  if p_id is null then raise exception 'Falta el id del usuario de Auth'; end if;
  if p_username is null or length(trim(p_username)) < 2 then
    raise exception 'El nombre de usuario debe tener al menos 2 caracteres';
  end if;
  if exists (select 1 from app_usuarios where lower(username) = lower(trim(p_username)) and id <> p_id) then
    raise exception 'Ya existe un usuario con ese nombre';
  end if;
  -- un empleado de Core no puede tener dos cuentas: la ficha del empleado y
  -- la pantalla de Usuarios escriben sobre la misma fila.
  if p_employee_id is not null and exists (
    select 1 from app_usuarios where employee_id = p_employee_id and id <> p_id
  ) then
    raise exception 'Ese empleado ya tiene una cuenta de acceso';
  end if;

  select coalesce(
           (select empresa_id from app_usuarios where id = p_id),
           app_empresa_actual(),
           '00000000-0000-4000-a000-000000000001'::uuid)
    into v_empresa;

  insert into app_usuarios (id, username, nombre, email_recuperacion, telefono, activo, es_superadmin, employee_id, empresa_id)
  values (p_id, trim(p_username), trim(p_nombre), nullif(trim(coalesce(p_email_recuperacion,'')),''),
          nullif(trim(coalesce(p_telefono,'')),''), coalesce(p_activo, true),
          coalesce(p_es_superadmin, false), p_employee_id, v_empresa)
  on conflict (id) do update set
    username = excluded.username,
    nombre = excluded.nombre,
    email_recuperacion = excluded.email_recuperacion,
    telefono = excluded.telefono,
    activo = excluded.activo,
    es_superadmin = excluded.es_superadmin,
    employee_id = excluded.employee_id;

  -- quitar accesos que ya no están en la lista
  delete from app_usuario_modulos
  where user_id = p_id
    and modulo not in (select jsonb_array_elements(coalesce(p_accesos,'[]'::jsonb))->>'modulo');

  -- upsert de los accesos indicados
  for v_acc in select jsonb_array_elements(coalesce(p_accesos,'[]'::jsonb)) loop
    if jsonb_typeof(v_acc->'pantallas') = 'array' then
      select array_agg(x) into v_pantallas from jsonb_array_elements_text(v_acc->'pantallas') as x;
    else
      v_pantallas := null;
    end if;
    insert into app_usuario_modulos (user_id, modulo, rol, pantallas, empresa_id)
    values (p_id, v_acc->>'modulo', v_acc->>'rol', v_pantallas, nullif(v_acc->>'empresa_id','')::uuid)
    on conflict (user_id, modulo) do update
      set rol = excluded.rol, pantallas = excluded.pantallas, empresa_id = excluded.empresa_id;
  end loop;

  return p_id;
end $$;

-- Un empleado, una cuenta (lo que antes solo vigilaba la aplicación).
create unique index if not exists idx_app_usuarios_employee
  on app_usuarios (employee_id) where employee_id is not null;
