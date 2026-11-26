-- =============================================================================
-- Core · Nóminas en la ficha del empleado
-- =============================================================================
--
-- QUÉ HACE
--   Crea sea_employee_payslips: una fila por nómina guardada en la ficha de un
--   empleado. El PDF en sí va al bucket PRIVADO de Core (el de los DNI); aquí
--   queda dónde está, de qué periodo es, quién la subió y cuándo se abrió por
--   última vez.
--
-- QUÉ NO HACE
--   · No guarda ningún importe: ni el líquido, ni el bruto, ni nada del
--     cuerpo de la nómina. Solo el periodo y los días.
--   · No da acceso a nadie desde el navegador. La tabla tiene la seguridad a
--     nivel de fila ACTIVADA y SIN NINGUNA política: con las claves del
--     navegador no se puede leer ni una fila. Solo el servidor (clave de
--     servicio), que es quien comprueba que quien pregunta es
--     superadministrador. Es justo lo contrario que el resto de tablas sea_*,
--     que cualquier usuario con sesión puede leer.
--   · No toca ninguna otra tabla. Sin triggers. Sin DROP.
--
-- ORDEN
--   1. ESTE FICHERO.
--   2. A partir de ahí, «Importar de nóminas» ofrece «Guardar cada nómina en
--      la ficha de su trabajador» y la ficha enseña la pestaña «Nóminas» al
--      superadministrador. Antes de ejecutarlo, las dos cosas simplemente no
--      aparecen.
--
-- IDEMPOTENTE: se puede ejecutar las veces que haga falta.
-- =============================================================================

create table if not exists sea_employee_payslips (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references sea_employees(id) on delete cascade,
  -- El mes al que corresponde, para ordenar y agrupar.
  anio           integer not null,
  mes            integer not null check (mes between 1 and 12),
  -- El periodo tal como lo escribe la nómina: «Del 01 al 30 de Noviembre de 2.026».
  -- Una persona puede tener dos en el mismo mes (una baja a mitad de mes).
  periodo        text not null,
  dias           integer,
  storage_path   text not null,
  bytes          integer,
  subida_at      timestamptz not null default now(),
  subida_por     uuid,
  subida_nombre  text,
  -- La última vez que alguien la abrió. El rastro completo está en la auditoría.
  vista_at       timestamptz,
  vista_nombre   text,
  -- Volver a subir el mismo periodo sustituye a la anterior: no se duplican.
  unique (employee_id, periodo)
);

create index if not exists sea_employee_payslips_empleado_idx
  on sea_employee_payslips (employee_id, anio desc, mes desc);

comment on table sea_employee_payslips is
  'Nóminas guardadas en la ficha del empleado. Sin importes. RLS activada y sin políticas: solo el servidor.';

-- Activada y sin políticas a propósito: nadie la lee con una clave de navegador.
alter table sea_employee_payslips enable row level security;
