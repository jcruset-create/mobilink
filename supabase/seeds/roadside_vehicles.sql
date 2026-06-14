-- Furgonetas de asistencia en carretera
-- Paso 1: añadir columnas nuevas (ejecutar primero si no existen)
ALTER TABLE roadside_vehicles ADD COLUMN IF NOT EXISTS base VARCHAR(100);
ALTER TABLE roadside_vehicles ADD COLUMN IF NOT EXISTS marca VARCHAR(100);
ALTER TABLE roadside_vehicles ADD COLUMN IF NOT EXISTS modelo VARCHAR(100);
ALTER TABLE roadside_vehicles ADD COLUMN IF NOT EXISTS "esTaller" BOOLEAN NOT NULL DEFAULT false;

-- Paso 2: insertar furgonetas
-- Ajusta: name, marca, modelo, base, esTaller y workshopId según corresponda
INSERT INTO roadside_vehicles
  ("workshopId", name, plate, "webfleetVehicleId", base, marca, modelo, "esTaller", notes, active, "createdAtMs", "updatedAtMs")
VALUES
  (1, 'Furgoneta 001', '6133LXF', '001', 'Tarragona', '', '', false, NULL, true, extract(epoch from now())*1000, extract(epoch from now())*1000),
  (1, 'Furgoneta 002', '1749LRX', '002', 'Vila-seca',  '', '', false, NULL, true, extract(epoch from now())*1000, extract(epoch from now())*1000),
  (1, 'Furgoneta 003', '2321HZT', '003', 'Tarragona', '', '', false, NULL, true, extract(epoch from now())*1000, extract(epoch from now())*1000),
  (1, 'Furgoneta 004', '6803GWH', '004', 'Tarragona', '', '', false, NULL, true, extract(epoch from now())*1000, extract(epoch from now())*1000),
  (1, 'Furgoneta 007', '1949MJS', '007', 'Reus',      '', '', false, NULL, true, extract(epoch from now())*1000, extract(epoch from now())*1000),
  (1, 'Furgoneta 008', '2216HCK', '008', 'Reus',      '', '', false, NULL, true, extract(epoch from now())*1000, extract(epoch from now())*1000),
  (1, 'Furgoneta 010', '4329NFT', '010', 'Tarragona', '', '', false, NULL, true, extract(epoch from now())*1000, extract(epoch from now())*1000),
  (1, 'Furgoneta 011', '8784NDR', '011', 'Tarragona', '', '', false, NULL, true, extract(epoch from now())*1000, extract(epoch from now())*1000),
  (1, 'Furgoneta 012', '3318NDN', '012', 'Tarragona', '', '', false, NULL, true, extract(epoch from now())*1000, extract(epoch from now())*1000),
  (1, 'Furgoneta 013', '9597MWG', '013', 'Reus',      '', '', false, NULL, true, extract(epoch from now())*1000, extract(epoch from now())*1000)
ON CONFLICT DO NOTHING;
