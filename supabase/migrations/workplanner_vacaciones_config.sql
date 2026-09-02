-- Cupo anual de vacaciones y modo de cómputo (WorkPlanner → Ausencias).
--
-- El servidor la crea sola al arrancar (server/db.ts, CREATE TABLE IF NOT
-- EXISTS); este fichero es el equivalente para aplicarla a mano en el SQL
-- editor de Supabase.
--
-- Una fila por taller y año con "techName" = '' guarda el valor por defecto
-- (modo y días). Las filas con nombre son el cupo propio de ese técnico
-- (antigüedad, jornada parcial, incorporación a mitad de año); un técnico sin
-- fila hereda el valor por defecto.

CREATE TABLE IF NOT EXISTS vacaciones_config (
  id                 SERIAL PRIMARY KEY,
  "workshopId"       TEXT NOT NULL DEFAULT '',
  anio               INTEGER NOT NULL,
  "techName"         TEXT NOT NULL DEFAULT '',
  modo               TEXT NOT NULL DEFAULT 'naturales',   -- 'naturales' | 'laborables'
  "diasPorDefecto"   INTEGER NOT NULL DEFAULT 30,
  dias               INTEGER,
  "createdAtMs"      BIGINT NOT NULL,
  "updatedAtMs"      BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS vacaciones_config_unica
  ON vacaciones_config ("workshopId", anio, "techName");
