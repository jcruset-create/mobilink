-- Estado de partida para el banco de pruebas: reproduce lo que la fotografía
-- del 2026-09-26 dice que HAY en producción, no lo que el repositorio suponía.
--
-- Las diferencias importan, y son justamente donde la revisión 1 de la
-- migración fallaba:
--   · perfiles_usuario NO tiene `almacen_solo_autenticados`: tiene cuatro
--     políticas acotadas más `anon_read_activos`;
--   · las políticas de los acuses se llaman `portal_anon_acks_*`;
--   · pres_records y los acuses tienen además una política `ALL` para
--     cualquier autenticado;
--   · todas las tablas conceden CRUD a anon y authenticated (defecto Supabase).

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table if not exists auth.users (id uuid primary key, email text);

do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;

create table if not exists app_empresas (id uuid primary key, nombre text);
create table if not exists app_usuarios (
  id uuid primary key, username text not null, email_recuperacion text,
  activo boolean not null default true, es_superadmin boolean not null default false,
  empresa_id uuid, updated_at timestamptz default now());
create table if not exists app_usuario_modulos (user_id uuid, modulo text);
create table if not exists adm_usuarios (id uuid primary key, rol text, activo boolean);
create table if not exists tc_usuarios (id uuid primary key, activo boolean);
create table if not exists perfiles_usuario (
  id uuid primary key default gen_random_uuid(), user_id uuid, nombre text,
  rol text, ubicacion text, codigo_operario text, activo boolean default true);
create table if not exists pres_records (
  id uuid primary key default gen_random_uuid(), employee_id uuid, fecha date,
  hora_entrada timestamptz, hora_salida timestamptz, validado boolean default false);
create table if not exists sm_document_acknowledgements (
  id uuid primary key default gen_random_uuid(), employee_id uuid, document_id uuid,
  leido boolean default false, firmado boolean default false);

-- Cuatro de las 42 de la lista, suficientes para comprobar la sección 1.
create table if not exists cash_operations (id serial primary key, importe numeric);
create table if not exists central_api_tokens (id serial primary key, token text);
create table if not exists tac_expedientes (id serial primary key, matricula text);
create table if not exists rcp_albaranes (id serial primary key, numero text);

-- El defecto de Supabase: CRUD para anon y authenticated en todo.
do $$ declare t text; begin
  for t in select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
            where n.nspname='public' and c.relkind='r' loop
    execute format('grant select, insert, update, delete on public.%I to anon, authenticated', t);
  end loop;
end $$;

-- Y un grant a PUBLIC, que es el caso que se colaba. En producción no hay
-- ninguno sobre tablas, pero la prueba lo fuerza para que el revoke se ejerza.
grant select on central_api_tokens to public;

-- ── Funciones, tal como están en producción: security definer sin pg_temp ──
create or replace function app_es_admin() returns boolean
  language sql security definer set search_path = public as $$
  select exists (select 1 from adm_usuarios where id = auth.uid() and activo and rol='admin') $$;
create or replace function app_empresa_actual() returns uuid
  language sql security definer set search_path = public as $$
  select empresa_id from app_usuarios where id = auth.uid() $$;
create or replace function app_login_email(p_username text) returns text
  language sql security definer set search_path = public as $$
  select email from auth.users u join app_usuarios a on a.id=u.id
   where lower(a.username)=lower(p_username) and a.activo limit 1 $$;
create or replace function usuario_actual_es_admin() returns boolean
  language sql security definer set search_path = public as $$
  select exists (select 1 from perfiles_usuario where user_id=auth.uid() and activo and rol='admin') $$;

-- Una función SOBRECARGADA: `revoke on function f(args)` solo alcanza una
-- firma. La migración no toca ninguna de las dos; la prueba lo verifica.
create or replace function app_sobrecargada(p text) returns text
  language sql as $$ select p $$;
create or replace function app_sobrecargada(p int) returns text
  language sql as $$ select p::text $$;

grant execute on function app_login_email(text) to anon, authenticated;

-- La función que la migración NO reescribe. Los nombres de los parámetros son
-- los REALES del repositorio, y eso importa: `create or replace` no puede
-- cambiarle el nombre a un parámetro («cannot change name of input parameter»),
-- que es lo que hundió la primera versión de esta migración. Si este stub
-- llevara nombres inventados, la prueba pasaría sin probar nada.
create or replace function app_guardar_usuario(
  p_id uuid, p_username text, p_nombre text, p_email_recuperacion text,
  p_telefono text, p_activo boolean, p_es_superadmin boolean,
  p_employee_id uuid, p_accesos jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid());
begin
  insert into app_usuarios (id, username, activo, es_superadmin, empresa_id)
  values (v_id, p_username, coalesce(p_activo,true), coalesce(p_es_superadmin,false), p_empresa_id)
  on conflict (id) do update set username=excluded.username,
    activo=excluded.activo, es_superadmin=excluded.es_superadmin, empresa_id=excluded.empresa_id;
  return v_id;
end $$;

-- ── Los disparadores que YA existen en app_usuarios ────────────────────────
create or replace function app_trg_touch_usuario() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists trg_app_touch_usuario on app_usuarios;
create trigger trg_app_touch_usuario before update on app_usuarios
  for each row execute function app_trg_touch_usuario();
create or replace function app_trg_sync_usuario() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if not new.activo then
    update adm_usuarios set activo=false where id=new.id;
    update tc_usuarios set activo=false where id=new.id;
    update perfiles_usuario set activo=false where user_id=new.id;
  end if;
  return new;
end $$;
drop trigger if exists trg_app_sync_usuario on app_usuarios;
create trigger trg_app_sync_usuario after insert or update on app_usuarios
  for each row execute function app_trg_sync_usuario();

-- ── Las políticas REALES ───────────────────────────────────────────────────
alter table app_usuarios enable row level security;
drop policy if exists app_usuarios_write on app_usuarios;
create policy app_usuarios_write on app_usuarios for all to authenticated
  using (app_es_admin()) with check (app_es_admin());

alter table perfiles_usuario enable row level security;
drop policy if exists perfiles_usuario_select_propio_o_admin on perfiles_usuario;
create policy perfiles_usuario_select_propio_o_admin on perfiles_usuario
  for select to authenticated using (usuario_actual_es_admin() or user_id = auth.uid());
drop policy if exists perfiles_usuario_insert_admin on perfiles_usuario;
create policy perfiles_usuario_insert_admin on perfiles_usuario
  for insert to authenticated with check (usuario_actual_es_admin());
drop policy if exists perfiles_usuario_update_admin on perfiles_usuario;
create policy perfiles_usuario_update_admin on perfiles_usuario
  for update to authenticated using (usuario_actual_es_admin()) with check (usuario_actual_es_admin());
drop policy if exists perfiles_usuario_delete_admin on perfiles_usuario;
create policy perfiles_usuario_delete_admin on perfiles_usuario
  for delete to authenticated using (usuario_actual_es_admin());
drop policy if exists anon_read_activos on perfiles_usuario;
create policy anon_read_activos on perfiles_usuario
  for select to anon using (activo = true);

alter table pres_records enable row level security;
drop policy if exists pres_anon_select on pres_records;
create policy pres_anon_select on pres_records for select to anon using (true);
drop policy if exists pres_anon_insert on pres_records;
create policy pres_anon_insert on pres_records for insert to anon with check (true);
drop policy if exists pres_anon_update on pres_records;
create policy pres_anon_update on pres_records for update to anon using (true) with check (true);
drop policy if exists pres_auth_all on pres_records;
create policy pres_auth_all on pres_records for all to authenticated using (true) with check (true);

alter table sm_document_acknowledgements enable row level security;
drop policy if exists portal_anon_acks_select on sm_document_acknowledgements;
create policy portal_anon_acks_select on sm_document_acknowledgements for select to anon using (true);
drop policy if exists portal_anon_acks_insert on sm_document_acknowledgements;
create policy portal_anon_acks_insert on sm_document_acknowledgements for insert to anon with check (true);
drop policy if exists portal_anon_acks_update on sm_document_acknowledgements;
create policy portal_anon_acks_update on sm_document_acknowledgements for update to anon using (true) with check (true);
drop policy if exists sm_auth_all on sm_document_acknowledgements;
create policy sm_auth_all on sm_document_acknowledgements for all to authenticated using (true) with check (true);
