-- ============================================================
-- SEA TyreControl — Migraciones pendientes (todo junto).
-- Seguro de ejecutar varias veces: usa if exists / if not exists /
-- create or replace / drop-antes-de-add. Si ya subiste alguno, no pasa nada.
-- ============================================================

begin;

-- 1) Sonda: aceptar metodo = 'sonda' (desatasca la sincronización) ----------
alter table revisiones_neumaticos_detalle
  drop constraint if exists revisiones_neumaticos_detalle_metodo_profundidad_check,
  drop constraint if exists revisiones_neumaticos_detalle_metodo_presion_check;

alter table revisiones_neumaticos_detalle
  add constraint revisiones_neumaticos_detalle_metodo_profundidad_check
    check (metodo_profundidad is null or metodo_profundidad in ('manual','bluetooth','sonda','importacion_excel')),
  add constraint revisiones_neumaticos_detalle_metodo_presion_check
    check (metodo_presion is null or metodo_presion in ('manual','bluetooth','sonda','importacion_excel'));

-- 2) RFID / nº de serie vacíos -> NULL (arregla el montaje) ------------------
create or replace function tc_neumaticos_normaliza_vacios()
returns trigger
language plpgsql
as $$
begin
  if new.rfid_epc     is not null and btrim(new.rfid_epc)     = '' then new.rfid_epc     := null; end if;
  if new.numero_serie is not null and btrim(new.numero_serie) = '' then new.numero_serie := null; end if;
  if new.dot          is not null and btrim(new.dot)          = '' then new.dot          := null; end if;
  return new;
end $$;

drop trigger if exists trg_tc_neumaticos_normaliza_vacios on tc_neumaticos;
create trigger trg_tc_neumaticos_normaliza_vacios
  before insert or update on tc_neumaticos
  for each row execute function tc_neumaticos_normaliza_vacios();

update tc_neumaticos set rfid_epc     = null where rfid_epc     is not null and btrim(rfid_epc)     = '';
update tc_neumaticos set numero_serie = null where numero_serie is not null and btrim(numero_serie) = '';
update tc_neumaticos set dot          = null where dot          is not null and btrim(dot)          = '';

-- 3) Orden de revisión configurable por posición ----------------------------
alter table tc_posiciones_vehiculo add column if not exists orden_revision int;
comment on column tc_posiciones_vehiculo.orden_revision is
  'Orden de revisión en la tablet (1,2,3,…). NULL = recorrido en círculo por defecto.';

-- 4) Enlazar 2321HZT con su objeto Webfleet (003) ---------------------------
update tc_vehiculos
set webfleet_vehicle_id = '003'
where id = '3bc7e05d-baa2-4bd7-8757-80bc8b678ba8';

commit;
