-- ============================================================
-- MOBILINK TOOLCONTROL — Migración 009: varias fotos por
-- herramienta / máquina (galería en el panel web y ficha QR).
-- Ejecutar a mano en el SQL Editor de Supabase.
-- ============================================================

create table if not exists tc_item_photos (
  id          uuid primary key default gen_random_uuid(),
  tool_id     uuid references tc_tools(id) on delete cascade,
  machine_id  uuid references tc_machines(id) on delete cascade,
  url         text not null,
  orden       int not null default 0,
  created_at  timestamptz default now(),
  check (tool_id is not null or machine_id is not null)
);

create index if not exists idx_tc_item_photos_tool    on tc_item_photos (tool_id);
create index if not exists idx_tc_item_photos_machine on tc_item_photos (machine_id);

alter table tc_item_photos enable row level security;

-- Gestión completa desde el panel (usuarios autenticados)
drop policy if exists tc_item_photos_all on tc_item_photos;
create policy tc_item_photos_all on tc_item_photos
  for all to authenticated using (true) with check (true);

-- Lectura anónima (la ficha QR se consulta sin sesión)
drop policy if exists tc_item_photos_read_anon on tc_item_photos;
create policy tc_item_photos_read_anon on tc_item_photos
  for select to anon using (true);
