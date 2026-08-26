-- ============================================================
-- MOBILINK TOOLCONTROL — Migración 008: bucket de fotos de
-- herramientas y máquinas (subida desde el panel web).
-- Ejecutar a mano en el SQL Editor de Supabase.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('toolcontrol-fotos', 'toolcontrol-fotos', true)
on conflict (id) do nothing;

-- Lectura pública (las fotos se muestran también en la ficha QR sin sesión)
drop policy if exists toolcontrol_fotos_read on storage.objects;
create policy toolcontrol_fotos_read on storage.objects for select
  using ( bucket_id = 'toolcontrol-fotos' );

-- Escritura solo para usuarios autenticados del panel
drop policy if exists toolcontrol_fotos_write on storage.objects;
create policy toolcontrol_fotos_write on storage.objects for insert to authenticated
  with check ( bucket_id = 'toolcontrol-fotos' );

drop policy if exists toolcontrol_fotos_update on storage.objects;
create policy toolcontrol_fotos_update on storage.objects for update to authenticated
  using ( bucket_id = 'toolcontrol-fotos' );

drop policy if exists toolcontrol_fotos_delete on storage.objects;
create policy toolcontrol_fotos_delete on storage.objects for delete to authenticated
  using ( bucket_id = 'toolcontrol-fotos' );
