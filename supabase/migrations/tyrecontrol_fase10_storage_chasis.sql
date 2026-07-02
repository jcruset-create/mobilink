-- ============================================================
-- SEA TyreControl — Fase 10: bucket de almacenamiento para las
-- imágenes de chasis del motor gráfico (subida directa desde
-- el panel, sin depender de URLs externas).
-- ============================================================

insert into storage.buckets (id, name, public)
values ('tc-chasis', 'tc-chasis', true)
on conflict (id) do nothing;

-- Lectura pública (son solo imágenes de chasis, sin datos sensibles)
drop policy if exists tc_chasis_read on storage.objects;
create policy tc_chasis_read on storage.objects for select
  using ( bucket_id = 'tc-chasis' );

-- Solo super-admin puede subir/actualizar/borrar (misma regla que calibrar posiciones)
drop policy if exists tc_chasis_write on storage.objects;
create policy tc_chasis_write on storage.objects for insert
  with check ( bucket_id = 'tc-chasis' and tc_is_superadmin() );

drop policy if exists tc_chasis_update on storage.objects;
create policy tc_chasis_update on storage.objects for update
  using ( bucket_id = 'tc-chasis' and tc_is_superadmin() );

drop policy if exists tc_chasis_delete on storage.objects;
create policy tc_chasis_delete on storage.objects for delete
  using ( bucket_id = 'tc-chasis' and tc_is_superadmin() );
