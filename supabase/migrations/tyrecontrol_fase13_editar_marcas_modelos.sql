-- ============================================================
-- SEA TyreControl — Fase 13: editar/borrar marcas y modelos de
-- neumático + logo de marca (bucket de almacenamiento propio).
-- ============================================================

alter table tc_cat_marcas_neumatico
  add column if not exists logo_url text;

-- Bucket para logos de marca (público en lectura, escritura solo super-admin)
insert into storage.buckets (id, name, public)
values ('tc-marcas', 'tc-marcas', true)
on conflict (id) do nothing;

drop policy if exists tc_marcas_logo_read on storage.objects;
create policy tc_marcas_logo_read on storage.objects for select
  using ( bucket_id = 'tc-marcas' );

drop policy if exists tc_marcas_logo_write on storage.objects;
create policy tc_marcas_logo_write on storage.objects for insert
  with check ( bucket_id = 'tc-marcas' and tc_is_superadmin() );

drop policy if exists tc_marcas_logo_update on storage.objects;
create policy tc_marcas_logo_update on storage.objects for update
  using ( bucket_id = 'tc-marcas' and tc_is_superadmin() );

drop policy if exists tc_marcas_logo_delete on storage.objects;
create policy tc_marcas_logo_delete on storage.objects for delete
  using ( bucket_id = 'tc-marcas' and tc_is_superadmin() );
