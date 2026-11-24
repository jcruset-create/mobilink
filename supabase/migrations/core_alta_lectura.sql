-- ============================================================
-- Mobilink Core — lo que dice la documentación
--
-- La IA pasa de solo comparar lo tecleado con la foto a LEER el
-- documento: el numero y la caducidad del DNI, y del carnet el
-- numero, las clases que tiene y la caducidad de CADA clase, que es
-- la tabla del reverso y lo que de verdad caduca por separado.
--
-- Lo leido no se escribe solo en la ficha: se guarda aqui, se enseña
-- al que revisa y lo pasa el con un boton.
--
-- Pegar en Supabase (SQL Editor). Idempotente.
-- ============================================================

-- La caducidad del DNI, que hasta ahora no estaba en ninguna parte.
alter table sea_employees
  add column if not exists dni_caducidad date;

comment on column sea_employees.dni_caducidad is
  'Fecha de caducidad del DNI o NIE. Sale de la lectura del documento.';

-- Lo que la IA ha leido de las fotos de ESTE envio.
alter table sea_employee_invites
  add column if not exists lectura  jsonb,
  add column if not exists leido_at timestamptz;

comment on column sea_employee_invites.lectura is
  'Lo leido del DNI y del carnet: numeros, caducidades y clases con su fecha.';
