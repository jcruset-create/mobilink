-- ============================================================
-- SEA TyreControl - Modulo ficha tecnica ITV (3/3): historial
--
-- Cada cambio de un valor de ficha tecnica (alta, correccion manual,
-- aplicacion de un escaneo nuevo o borrado) deja rastro de quien, con
-- que documento y que habia antes.
--
-- Requiere tyrecontrol_itv_2_valores.sql
-- ============================================================

create table if not exists tc_vehiculo_ficha_historial (
  id                uuid primary key default gen_random_uuid(),
  atributo_id       uuid,
  vehiculo_id       uuid not null references tc_vehiculos (id) on delete cascade,
  campo_ficha_id    uuid not null references tc_cat_campos_ficha_tecnica (id) on delete restrict,
  valor_anterior    jsonb,
  valor_nuevo       jsonb,
  motivo_cambio     text not null default 'manual',
  cambiado_por      uuid,
  documento_id      uuid references tc_vehiculo_documentos (id) on delete set null,
  created_at        timestamptz not null default now()
);

alter table tc_vehiculo_ficha_historial drop constraint if exists chk_ficha_hist_motivo;
alter table tc_vehiculo_ficha_historial add constraint chk_ficha_hist_motivo check (
  motivo_cambio in ('manual','ocr','importacion','api','borrado')
);

create index if not exists idx_ficha_hist_vehiculo on tc_vehiculo_ficha_historial (vehiculo_id);
create index if not exists idx_ficha_hist_campo    on tc_vehiculo_ficha_historial (campo_ficha_id);
create index if not exists idx_ficha_hist_fecha    on tc_vehiculo_ficha_historial (vehiculo_id, created_at desc);

alter table tc_vehiculo_ficha_historial enable row level security;

-- Mismo criterio que los valores: solo la empresa dueña del vehiculo.
drop policy if exists ficha_hist_select on tc_vehiculo_ficha_historial;
create policy ficha_hist_select on tc_vehiculo_ficha_historial for select using (
  exists (select 1 from tc_vehiculos v where v.id = tc_vehiculo_ficha_historial.vehiculo_id
            and tc_puede_ver_empresa(v.empresa_id))
);
drop policy if exists ficha_hist_insert on tc_vehiculo_ficha_historial;
create policy ficha_hist_insert on tc_vehiculo_ficha_historial for insert with check (
  exists (select 1 from tc_vehiculos v where v.id = tc_vehiculo_ficha_historial.vehiculo_id
            and tc_puede_ver_empresa(v.empresa_id))
);
-- El historial no se edita ni se borra: no se crean policies de update/delete.

notify pgrst, 'reload schema';

-- ── Rollback ───────────────────────────────────────────────────────
-- drop table if exists tc_vehiculo_ficha_historial;
