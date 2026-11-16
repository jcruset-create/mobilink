-- ============================================================
-- Mobilink Core — alta de operario por enlace
--
-- El encargado da de alta al operario con el nombre y el móvil, y el
-- operario rellena el resto desde un enlace que le llega por SMS.
--
-- Tres cosas:
--   1. Las columnas de la ficha que el formulario pide y que hoy no
--      existen (nacimiento, carnet, CAP, emergencia) y el estado del
--      alta.
--   2. `sea_employee_invites`: el enlace, su caducidad y por dónde va.
--   3. `sea_employee_documents`: las fotos del DNI y del carnet.
--
-- El IBAN NO está aquí a propósito: la cuenta bancaria se queda fuera
-- de Core. Un dato que no está en la base no se filtra desde la base.
--
-- Pegar en Supabase (SQL Editor). Idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1 · La ficha
-- ------------------------------------------------------------
alter table sea_employees
  add column if not exists fecha_nacimiento    date,
  add column if not exists nacionalidad        text,
  add column if not exists carnet_numero       text,
  add column if not exists carnet_clases       text,
  add column if not exists carnet_caducidad    date,
  add column if not exists cap_numero          text,
  add column if not exists cap_caducidad       date,
  add column if not exists emergencia_nombre   text,
  add column if not exists emergencia_telefono text;

/*
 * En qué punto está el alta.
 *
 * Por defecto 'completa', y es la decisión que importa: la columna nace
 * para toda la plantilla que ya está dada de alta a mano, y si naciera
 * en 'pendiente' los 21 empleados de hoy aparecerían mañana como si les
 * faltara media ficha.
 *
 *   pendiente → creado con nombre y movil, sin enlace todavia
 *   enviado   → se le ha mandado el enlace
 *   abierto   → lo ha abierto
 *   recibida  → ha enviado la ficha; falta que un admin la apruebe
 *   completa  → aprobada (o dada de alta a mano, como siempre)
 */
alter table sea_employees
  add column if not exists estado_alta text not null default 'completa';

do $$
begin
  alter table sea_employees
    add constraint sea_employees_estado_alta_check
    check (estado_alta in ('pendiente', 'enviado', 'abierto', 'recibida', 'completa'));
exception
  when duplicate_object then null;
end $$;

-- ------------------------------------------------------------
-- 2 · El enlace
--
-- Del token solo se guarda el sha256: quien entre en la base no puede
-- abrir la ficha de nadie. El valor en claro existe una vez, dentro del
-- SMS, y no se registra en ningun sitio.
-- ------------------------------------------------------------
create table if not exists sea_employee_invites (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references sea_employees(id) on delete cascade,
  token_hash   text not null unique,
  telefono     text not null,
  canal        text not null default 'sms',
  estado       text not null default 'enviado',
  caduca_at    timestamptz not null,
  enviado_por  uuid,
  enviado_at   timestamptz not null default now(),
  abierto_at   timestamptz,
  recibida_at  timestamptz,
  mensaje_sid  text,
  error        text,
  -- La firma de ESTE envio. Los consentimientos van a `sea_consents` y la
  -- firma tambien queda en `sea_signatures`, que es donde Core guarda esas
  -- dos cosas desde el principio; aqui solo el puntero, para no tener que
  -- buscarla cuando se revisa el alta.
  firma_path   text,
  firmado_at   timestamptz,
  created_at   timestamptz not null default now()
);

alter table sea_employee_invites
  add column if not exists firma_path text,
  add column if not exists firmado_at timestamptz;

/*
 * Una fila de tallas por empleado.
 *
 * La tabla nacio sin esa restriccion y la pantalla la respeta a mano
 * (inserta la primera vez, actualiza despues). El formulario escribe desde
 * el servidor y necesita un ON CONFLICT, asi que la regla pasa a estar
 * donde no se puede olvidar. Si esto falla, es que hay un empleado con dos
 * filas: borra la vieja y vuelve a ejecutarlo.
 */
create unique index if not exists sea_employee_clothing_employee_idx
  on sea_employee_clothing (employee_id);

create index if not exists sea_employee_invites_employee_idx
  on sea_employee_invites (employee_id, enviado_at desc);

do $$
begin
  alter table sea_employee_invites
    add constraint sea_employee_invites_estado_check
    check (estado in ('enviado', 'abierto', 'recibida', 'anulada'));
exception
  when duplicate_object then null;
end $$;

-- ------------------------------------------------------------
-- 3 · Las fotos del DNI y del carnet
--
-- El fichero vive en un bucket PRIVADO de Storage; aqui solo su ruta.
-- Una foto por tipo: volver a hacerla sustituye a la anterior, que es
-- lo que pasa cuando la primera sale movida.
--
-- IMPORTANTE: hay que crear el bucket a mano en Supabase (Storage →
-- New bucket), llamado `core-documentos` y SIN marcar «Public».
-- ------------------------------------------------------------
create table if not exists sea_employee_documents (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references sea_employees(id) on delete cascade,
  tipo         text not null,
  storage_path text not null,
  mime         text,
  bytes        integer,
  subido_at    timestamptz not null default now(),
  unique (employee_id, tipo)
);

do $$
begin
  alter table sea_employee_documents
    add constraint sea_employee_documents_tipo_check
    check (tipo in ('dni_anverso', 'dni_reverso', 'carnet_anverso', 'carnet_reverso'));
exception
  when duplicate_object then null;
end $$;

-- ------------------------------------------------------------
-- 4 · Quien puede leer esto desde el navegador
--
-- Las dos tablas las escribe el servidor con la service role, que se
-- salta RLS. Se activa RLS sin politica de escritura para que la clave
-- anonima no pueda tocarlas, y se deja leer a los usuarios con sesion
-- (la pantalla de Core enseña el estado del enlace).
-- ------------------------------------------------------------
alter table sea_employee_invites   enable row level security;
alter table sea_employee_documents enable row level security;

drop policy if exists sea_employee_invites_lectura on sea_employee_invites;
create policy sea_employee_invites_lectura on sea_employee_invites
  for select to authenticated using (true);

drop policy if exists sea_employee_documents_lectura on sea_employee_documents;
create policy sea_employee_documents_lectura on sea_employee_documents
  for select to authenticated using (true);
