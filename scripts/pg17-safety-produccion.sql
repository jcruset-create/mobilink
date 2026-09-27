-- Estado REAL de las diez tablas de Safety en produccion (fotografia del
-- 2026-09-26), para probar la contencion en laboratorio.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;

create table if not exists sea_companies (id uuid primary key default gen_random_uuid(), nombre text);
create table if not exists sea_work_centers (id uuid primary key default gen_random_uuid(), nombre text);
create table if not exists sea_employees (
  id uuid primary key default gen_random_uuid(), company_id uuid, work_center_id uuid,
  user_id uuid, nombre text, apellidos text, dni_nie text, telefono text, email text,
  cargo text, departamento text, fecha_alta date, fecha_baja date, rol text,
  pin_hash text, codigo_operario text, activo boolean default true,
  num_seguridad_social text, direccion text, codigo_postal text, poblacion text, provincia text);
create table if not exists sea_authorizations (id uuid primary key default gen_random_uuid(), nombre text, activa boolean default true);
create table if not exists sea_competencies (id uuid primary key default gen_random_uuid(), nombre text, activa boolean default true);
create table if not exists sea_employee_authorizations (id uuid primary key default gen_random_uuid(), employee_id uuid, authorization_id uuid);
create table if not exists sea_employee_certifications (id uuid primary key default gen_random_uuid(), employee_id uuid, nombre text);
create table if not exists sea_employee_clothing (id uuid primary key default gen_random_uuid(), employee_id uuid, talla text);
create table if not exists sea_employee_competencies (id uuid primary key default gen_random_uuid(), employee_id uuid, competency_id uuid);
create table if not exists sea_training_records (id uuid primary key default gen_random_uuid(), employee_id uuid, curso text);

do $$ declare t text; begin
  foreach t in array array['sea_companies','sea_work_centers','sea_employees','sea_authorizations',
    'sea_competencies','sea_employee_authorizations','sea_employee_certifications',
    'sea_employee_clothing','sea_employee_competencies','sea_training_records'] loop
    execute format('grant select, insert, update, delete on public.%I to anon, authenticated', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Las politicas REALES: una ALL para anon en las diez, mas las portal_* de
-- solo lectura en ocho de ellas, mas sea_auth_all para el panel.
create policy sea_anon_all on sea_employees for all to anon using (true) with check (true);
create policy portal_anon_employees on sea_employees for select to anon using (activo = true);
create policy sea_anon_companies on sea_companies for all to anon using (true) with check (true);
create policy sea_anon_centers on sea_work_centers for all to anon using (true) with check (true);
create policy sea_anon_authorizations on sea_authorizations for all to anon using (true) with check (true);
create policy portal_anon_authorizations_cat on sea_authorizations for select to anon using (activa = true);
create policy sea_anon_competencies on sea_competencies for all to anon using (true) with check (true);
create policy portal_anon_competencies_cat on sea_competencies for select to anon using (activa = true);
create policy sea_anon_emp_aut on sea_employee_authorizations for all to anon using (true) with check (true);
create policy portal_anon_authorizations_emp on sea_employee_authorizations for select to anon using (true);
create policy sea_anon_emp_cert on sea_employee_certifications for all to anon using (true) with check (true);
create policy portal_anon_certifications on sea_employee_certifications for select to anon using (true);
create policy sea_anon_clothing on sea_employee_clothing for all to anon using (true) with check (true);
create policy portal_anon_clothing on sea_employee_clothing for select to anon using (true);
create policy sea_anon_emp_comp on sea_employee_competencies for all to anon using (true) with check (true);
create policy portal_anon_competencies_emp on sea_employee_competencies for select to anon using (true);
create policy sea_anon_training on sea_training_records for all to anon using (true) with check (true);
create policy portal_anon_training on sea_training_records for select to anon using (true);

do $$ declare t text; begin
  foreach t in array array['sea_companies','sea_work_centers','sea_employees','sea_authorizations',
    'sea_competencies','sea_employee_authorizations','sea_employee_certifications',
    'sea_employee_clothing','sea_employee_competencies','sea_training_records'] loop
    execute format('create policy sea_auth_all on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

insert into sea_companies (id,nombre) values ('00000000-0000-4000-e000-000000000001','Mobilink');
insert into sea_work_centers (id,nombre) values ('00000000-0000-4000-e000-000000000002','Tarragona');
insert into sea_employees (id,company_id,work_center_id,nombre,apellidos,dni_nie,
  num_seguridad_social,direccion,pin_hash,codigo_operario,activo)
  values ('00000000-0000-4000-e000-000000000003','00000000-0000-4000-e000-000000000001',
   '00000000-0000-4000-e000-000000000002','Ana','Ruiz','12345678Z','281234567890',
   'Calle Falsa 1','$2a$10$hash','OPER-4471',true);
insert into sea_training_records (employee_id,curso)
  values ('00000000-0000-4000-e000-000000000003','Trabajos en altura');
insert into sea_employee_authorizations (employee_id) values ('00000000-0000-4000-e000-000000000003');
