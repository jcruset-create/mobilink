-- Dirección postal completa en la ficha del empleado.
ALTER TABLE sea_employees
  ADD COLUMN IF NOT EXISTS direccion     TEXT,
  ADD COLUMN IF NOT EXISTS codigo_postal TEXT,
  ADD COLUMN IF NOT EXISTS poblacion     TEXT,
  ADD COLUMN IF NOT EXISTS provincia     TEXT;

COMMENT ON COLUMN sea_employees.direccion     IS 'Calle, numero, piso y puerta';
COMMENT ON COLUMN sea_employees.codigo_postal IS 'Codigo postal';
COMMENT ON COLUMN sea_employees.poblacion     IS 'Poblacion / municipio';
COMMENT ON COLUMN sea_employees.provincia     IS 'Provincia';
