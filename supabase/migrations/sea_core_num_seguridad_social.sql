-- Nº de afiliación a la Seguridad Social (NAF) en la ficha del empleado.
-- Texto libre: el formato del NAF varía según provincia y antigüedad.
ALTER TABLE sea_employees
  ADD COLUMN IF NOT EXISTS num_seguridad_social TEXT;

COMMENT ON COLUMN sea_employees.num_seguridad_social
  IS 'Numero de afiliacion a la Seguridad Social (NAF), texto libre';
