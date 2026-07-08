-- ============================================================
-- SEA — Fase 11: usuarios unificados de toda la aplicación
--
--   · app_usuarios: tabla maestra (login por USERNAME + contraseña;
--     el email de Supabase Auth queda interno/sintético).
--   · app_usuario_modulos: accesos por módulo (rol + pantallas).
--   · Sincronización automática maestro → adm_usuarios, tc_usuarios
--     y perfiles_usuario (almacén).
--   · RPC app_login_email: resuelve username → email interno para
--     poder hacer signInWithPassword desde el login unificado.
--   · Backfill de los usuarios ya existentes.
--
-- Pegar en Supabase (SQL Editor). Idempotente.
-- ============================================================

-- ── 1) Tabla maestra ─────────────────────────────────────────
create table if not exists app_usuarios (
  id                  uuid primary key references auth.users(id) on delete cascade,
  username            text not null,
  nombre              text not null,
  email_recuperacion  text,
  telefono            text,
  activo              boolean not null default true,
  es_superadmin       boolean not null default false,
  employee_id         uuid references sea_employees(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists idx_app_usuarios_username on app_usuarios (lower(username));

-- ── 2) Accesos por módulo ────────────────────────────────────
create table if not exists app_usuario_modulos (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references app_usuarios(id) on delete cascade,
  modulo      text not null
              check (modulo in ('administracion','tyrecontrol','almacen','sea-core','toolcontrol','safety','presencia')),
  rol         text not null,
  pantallas   text[],            -- null = todas las pantallas del rol
  empresa_id  uuid,              -- solo tyrecontrol (usuarios de tipo cliente)
  created_at  timestamptz not null default now(),
  unique (user_id, modulo)
);
create index if not exists idx_app_usuario_modulos_user on app_usuario_modulos (user_id);

-- ── 3) Helpers ───────────────────────────────────────────────
create or replace function app_es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select es_superadmin from app_usuarios where id = auth.uid() and activo), false)
      or coalesce((select rol = 'admin' from adm_usuarios where id = auth.uid() and activo), false)
$$;

-- Email interno de Auth para un username activo (para el login unificado).
-- Ejecutable por anon: solo devuelve el email interno, nunca la contraseña.
create or replace function app_login_email(p_username text)
returns text language sql stable security definer set search_path = public as $$
  select u.email::text
  from app_usuarios a
  join auth.users u on u.id = a.id
  where lower(a.username) = lower(trim(p_username)) and a.activo
$$;
grant execute on function app_login_email(text) to anon, authenticated;

-- ── 4) Sincronización maestro → módulos ──────────────────────
create or replace function app_sync_acceso(p_user_id uuid, p_modulo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_u app_usuarios%rowtype;
  v_a app_usuario_modulos%rowtype;
  v_email text;
  v_activo boolean;
  v_empresa uuid;
  v_perfil_id uuid;
begin
  select * into v_u from app_usuarios where id = p_user_id;
  if not found then return; end if;

  select * into v_a from app_usuario_modulos where user_id = p_user_id and modulo = p_modulo;
  -- activo en el módulo = usuario activo Y tiene fila de acceso
  v_activo := v_u.activo and found;

  select email::text into v_email from auth.users where id = p_user_id;
  v_email := coalesce(v_email, lower(v_u.username) || '@usuarios.sea');

  if p_modulo = 'administracion' then
    if v_activo then
      insert into adm_usuarios (id, nombre, email, rol, activo)
      values (p_user_id, v_u.nombre, v_email, v_a.rol::adm_rol, true)
      on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = true;
    else
      update adm_usuarios set activo = false, nombre = v_u.nombre where id = p_user_id;
    end if;

  elsif p_modulo = 'tyrecontrol' then
    if v_activo then
      v_empresa := coalesce(v_a.empresa_id, (select id from tc_empresas order by created_at limit 1));
      insert into tc_usuarios (id, empresa_id, nombre, email, rol, activo, es_superadmin, acceso_panel)
      values (p_user_id, v_empresa, v_u.nombre, v_email, v_a.rol::tc_rol, true, v_u.es_superadmin, true)
      on conflict (id) do update
        set nombre = excluded.nombre, rol = excluded.rol, activo = true,
            empresa_id = excluded.empresa_id, es_superadmin = excluded.es_superadmin;
    else
      update tc_usuarios set activo = false, nombre = v_u.nombre where id = p_user_id;
    end if;

  elsif p_modulo = 'almacen' then
    select id into v_perfil_id from perfiles_usuario where user_id = p_user_id limit 1;
    if v_activo then
      if v_perfil_id is not null then
        update perfiles_usuario
          set nombre = v_u.nombre, rol = v_a.rol, activo = true
          where id = v_perfil_id;
      else
        insert into perfiles_usuario (user_id, nombre, email, rol, activo)
        values (p_user_id, v_u.nombre, v_email, v_a.rol, true);
      end if;
    elsif v_perfil_id is not null then
      update perfiles_usuario set activo = false, nombre = v_u.nombre where id = v_perfil_id;
    end if;
  end if;
  -- sea-core / toolcontrol / safety / presencia usan sea_employees
  -- (vinculado con employee_id); sin espejo propio en esta fase.
end $$;

create or replace function app_trg_sync_modulo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform app_sync_acceso(old.user_id, old.modulo);
    return old;
  end if;
  perform app_sync_acceso(new.user_id, new.modulo);
  return new;
end $$;

drop trigger if exists trg_app_sync_modulo on app_usuario_modulos;
create trigger trg_app_sync_modulo
  after insert or update or delete on app_usuario_modulos
  for each row execute function app_trg_sync_modulo();

create or replace function app_trg_touch_usuario()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_app_touch_usuario on app_usuarios;
create trigger trg_app_touch_usuario
  before update on app_usuarios
  for each row execute function app_trg_touch_usuario();

create or replace function app_trg_sync_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_mod text;
begin
  for v_mod in select modulo from app_usuario_modulos where user_id = new.id loop
    perform app_sync_acceso(new.id, v_mod);
  end loop;
  -- si se desactiva el usuario, apagar también espejos sin fila de acceso
  if not new.activo then
    update adm_usuarios set activo = false where id = new.id;
    update tc_usuarios set activo = false where id = new.id;
    update perfiles_usuario set activo = false where user_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists trg_app_sync_usuario on app_usuarios;
create trigger trg_app_sync_usuario
  after insert or update on app_usuarios
  for each row execute function app_trg_sync_usuario();

-- ── 5) Guardar usuario (crear/editar) ────────────────────────
-- p_accesos: json array [{"modulo":"administracion","rol":"admin","pantallas":["recobros",...]|null,"empresa_id":null}]
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

  insert into app_usuarios (id, username, nombre, email_recuperacion, telefono, activo, es_superadmin, employee_id)
  values (p_id, trim(p_username), trim(p_nombre), nullif(trim(coalesce(p_email_recuperacion,'')),''),
          nullif(trim(coalesce(p_telefono,'')),''), coalesce(p_activo, true),
          coalesce(p_es_superadmin, false), p_employee_id)
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

-- ── 6) Eliminar usuario ──────────────────────────────────────
-- Devuelve 'eliminado' si se pudo borrar, 'desactivado' si tenía historial.
create or replace function app_eliminar_usuario(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_tiene_historial boolean;
begin
  if not app_es_admin() then
    raise exception 'Solo un administrador puede eliminar usuarios';
  end if;
  if p_id = auth.uid() then
    raise exception 'No puedes eliminar tu propio usuario';
  end if;

  v_tiene_historial :=
       exists (select 1 from adm_payments where registered_by = p_id)
    or exists (select 1 from adm_recovery_actions where user_id = p_id)
    or exists (select 1 from adm_payment_tracking_actions where user_id = p_id)
    or exists (select 1 from adm_payment_tracking where responsible_user = p_id)
    or exists (select 1 from adm_recovery_cases where responsible_user = p_id)
    or exists (select 1 from adm_notificaciones where created_by = p_id);

  if v_tiene_historial then
    update app_usuarios set activo = false where id = p_id;  -- el trigger apaga los espejos
    return 'desactivado';
  end if;

  delete from app_usuario_modulos where user_id = p_id;
  delete from adm_usuarios where id = p_id;
  delete from tc_usuarios where id = p_id;
  delete from perfiles_usuario where user_id = p_id;
  delete from app_usuarios where id = p_id;
  return 'eliminado';
end $$;

-- ── 7) RLS ───────────────────────────────────────────────────
alter table app_usuarios          enable row level security;
alter table app_usuario_modulos   enable row level security;

drop policy if exists app_usuarios_select on app_usuarios;
create policy app_usuarios_select on app_usuarios for select
  using ( id = auth.uid() or app_es_admin() );
drop policy if exists app_usuarios_write on app_usuarios;
create policy app_usuarios_write on app_usuarios for all
  using ( app_es_admin() ) with check ( app_es_admin() );

drop policy if exists app_usuario_modulos_select on app_usuario_modulos;
create policy app_usuario_modulos_select on app_usuario_modulos for select
  using ( user_id = auth.uid() or app_es_admin() );
drop policy if exists app_usuario_modulos_write on app_usuario_modulos;
create policy app_usuario_modulos_write on app_usuario_modulos for all
  using ( app_es_admin() ) with check ( app_es_admin() );

-- ── 8) Backfill de usuarios existentes ───────────────────────
-- Username inicial = parte local del email (editable después en la pantalla).
insert into app_usuarios (id, username, nombre, email_recuperacion, activo, es_superadmin)
select u.id,
       split_part(u.email, '@', 1),
       u.nombre,
       case when u.email not like '%@usuarios.sea' and u.email not like 'apk-%' then u.email end,
       u.activo,
       false
from adm_usuarios u
where not exists (select 1 from app_usuarios a where a.id = u.id)
on conflict do nothing;

insert into app_usuarios (id, username, nombre, email_recuperacion, activo, es_superadmin)
select t.id,
       split_part(t.email, '@', 1),
       t.nombre,
       case when t.email not like '%@usuarios.sea' and t.email not like 'apk-%' then t.email end,
       t.activo,
       t.es_superadmin
from tc_usuarios t
where not exists (select 1 from app_usuarios a where a.id = t.id)
on conflict do nothing;

update app_usuarios a set es_superadmin = true
from tc_usuarios t where t.id = a.id and t.es_superadmin;

insert into app_usuario_modulos (user_id, modulo, rol)
select u.id, 'administracion', u.rol::text
from adm_usuarios u
join app_usuarios a on a.id = u.id
where not exists (select 1 from app_usuario_modulos m where m.user_id = u.id and m.modulo = 'administracion');

insert into app_usuario_modulos (user_id, modulo, rol, empresa_id)
select t.id, 'tyrecontrol', t.rol::text, t.empresa_id
from tc_usuarios t
join app_usuarios a on a.id = t.id
where not exists (select 1 from app_usuario_modulos m where m.user_id = t.id and m.modulo = 'tyrecontrol');

insert into app_usuario_modulos (user_id, modulo, rol)
select p.user_id, 'almacen', coalesce(p.rol, 'operario')
from perfiles_usuario p
join app_usuarios a on a.id = p.user_id
where p.user_id is not null
  and not exists (select 1 from app_usuario_modulos m where m.user_id = p.user_id and m.modulo = 'almacen');

-- Perfiles del almacén con login que aún no estén en la maestra
insert into app_usuarios (id, username, nombre, email_recuperacion, activo, es_superadmin)
select p.user_id,
       split_part(coalesce(p.email, u.email::text, p.nombre), '@', 1),
       p.nombre,
       case when coalesce(p.email, u.email::text) not like '%@usuarios.sea' then coalesce(p.email, u.email::text) end,
       coalesce(p.activo, true),
       false
from perfiles_usuario p
join auth.users u on u.id = p.user_id
where p.user_id is not null
  and not exists (select 1 from app_usuarios a where a.id = p.user_id)
on conflict do nothing;

insert into app_usuario_modulos (user_id, modulo, rol)
select p.user_id, 'almacen', coalesce(p.rol, 'operario')
from perfiles_usuario p
where p.user_id is not null
  and exists (select 1 from app_usuarios a where a.id = p.user_id)
  and not exists (select 1 from app_usuario_modulos m where m.user_id = p.user_id and m.modulo = 'almacen');
