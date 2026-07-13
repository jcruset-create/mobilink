-- ============================================================
-- SEA TyreControl — Fix: RFID / nº de serie vacíos ("") rompen
-- los índices únicos parciales.
--
-- Índices afectados (definidos en fase4):
--   uq_tc_neu_rfid  : unique (rfid_epc)                 where rfid_epc     is not null
--   uq_tc_neu_serie : unique (empresa_id, numero_serie) where numero_serie is not null
--
-- El formulario "Montar fuera de almacén" (y otros altas) envían
-- cadena vacía "" en RFID / nº de serie cuando el técnico no los
-- rellena. Como "" NO es NULL, dos neumáticos sin RFID chocan y
-- salta: duplicate key value violates unique constraint "uq_tc_neu_rfid".
--
-- Solución centralizada: un trigger BEFORE INSERT/UPDATE que
-- convierte los vacíos a NULL. Cubre TODAS las vías de alta
-- (montar fuera de almacén, desde ficha, sustituir, importar…),
-- presentes y futuras, sin tocar cada función.
-- ============================================================

create or replace function tc_neumaticos_normaliza_vacios()
returns trigger
language plpgsql
as $$
begin
  -- Un identificador en blanco es "sin dato": debe ser NULL para no
  -- colisionar con otros neumáticos sin ese dato en los índices únicos.
  if new.rfid_epc     is not null and btrim(new.rfid_epc)     = '' then new.rfid_epc     := null; end if;
  if new.numero_serie is not null and btrim(new.numero_serie) = '' then new.numero_serie := null; end if;
  if new.dot          is not null and btrim(new.dot)          = '' then new.dot          := null; end if;
  return new;
end $$;

drop trigger if exists trg_tc_neumaticos_normaliza_vacios on tc_neumaticos;
create trigger trg_tc_neumaticos_normaliza_vacios
  before insert or update on tc_neumaticos
  for each row execute function tc_neumaticos_normaliza_vacios();

-- Limpieza de datos ya existentes con "" (libera los índices únicos).
update tc_neumaticos set rfid_epc     = null where rfid_epc     is not null and btrim(rfid_epc)     = '';
update tc_neumaticos set numero_serie = null where numero_serie is not null and btrim(numero_serie) = '';
update tc_neumaticos set dot          = null where dot          is not null and btrim(dot)          = '';
