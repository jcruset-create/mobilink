-- ============================================================
-- SEA TyreControl — Fase 31: soporte para la app móvil de revisiones
-- (tyrecontrol_app, Flutter). Bucket de fotos de revisión, mismo
-- patrón que tc-chasis/tc-marcas: lectura pública (para poder verlas
-- desde el panel web sin URLs firmadas), escritura solo autenticada.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('tc-revisiones-fotos', 'tc-revisiones-fotos', true)
on conflict (id) do nothing;

drop policy if exists tc_revisiones_fotos_read on storage.objects;
create policy tc_revisiones_fotos_read on storage.objects for select
  using ( bucket_id = 'tc-revisiones-fotos' and auth.uid() is not null );

drop policy if exists tc_revisiones_fotos_write on storage.objects;
create policy tc_revisiones_fotos_write on storage.objects for insert
  with check ( bucket_id = 'tc-revisiones-fotos' and auth.uid() is not null );
