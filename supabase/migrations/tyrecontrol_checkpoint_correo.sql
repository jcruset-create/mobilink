-- ============================================================
-- Mobilink TyreControl — Registro de las importaciones del CheckPoint
--
-- El informe del arco va a entrar solo: un buzón IMAP al que se reenvía el
-- correo semanal de Bridgestone, y el servidor lo mira cada pocos minutos.
--
-- Un proceso que escribe en la base de datos sin que nadie mire tiene que
-- dejar rastro. Si no, el día que deje de funcionar nadie se entera hasta que
-- alguien pregunta por qué el informe está viejo, y entonces no hay forma de
-- saber desde cuándo ni por qué.
--
-- Aquí se apunta cada pasada: cuándo, de qué correo, qué se cargó y qué se
-- saltó. También sirve para no procesar dos veces el mismo mensaje.
--
-- Las credenciales del buzón NO van aquí: van en variables de entorno
-- (CHECKPOINT_IMAP_*), que es donde va una contraseña.
--
-- Idempotente.
-- ============================================================

create table if not exists tc_checkpoint_ejecuciones (
  id             uuid primary key default gen_random_uuid(),
  -- Identificador del correo. Único: si el buzón devuelve dos veces el mismo
  -- mensaje —pasa al reconectar—, la segunda no se procesa.
  message_id     text unique,
  asunto         text,
  remitente      text,
  fecha_correo   timestamptz,
  fichero        text,
  empresa_id     uuid references tc_empresas(id) on delete set null,

  -- Qué salió de esa pasada.
  mediciones     int  not null default 0,
  revisiones     int  not null default 0,
  altas          int  not null default 0,
  ya_cargados    int  not null default 0,
  sin_medir      int  not null default 0,
  avisos         jsonb not null default '[]'::jsonb,

  estado         text not null default 'ok' check (estado in ('ok','con_avisos','error')),
  error          text,
  aviso_enviado  boolean not null default false,
  created_at     timestamptz not null default now()
);

create index if not exists idx_chk_ejec_fecha on tc_checkpoint_ejecuciones (created_at desc);

comment on table tc_checkpoint_ejecuciones is
  'Una fila por correo del CheckPoint procesado. Deja rastro de un import que '
  'nadie mira mientras ocurre, y su message_id evita procesar dos veces el '
  'mismo mensaje.';

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Lo escribe el servidor con la clave de servicio, que se salta la RLS. Para
-- el panel, solo lectura y solo de lo suyo.
alter table tc_checkpoint_ejecuciones enable row level security;

drop policy if exists tc_chk_ejec_select on tc_checkpoint_ejecuciones;
create policy tc_chk_ejec_select on tc_checkpoint_ejecuciones for select
  using ( tc_is_superadmin() or empresa_id is null or tc_puede_ver_empresa(empresa_id) );

-- ── Comprobación ────────────────────────────────────────────────────────────
do $$
declare n int;
begin
  select count(*) into n from information_schema.columns
   where table_name = 'tc_checkpoint_ejecuciones';
  if n = 0 then raise exception 'No se ha creado tc_checkpoint_ejecuciones'; end if;

  -- El unique de message_id es lo que evita el doble proceso: se comprueba,
  -- no se supone.
  if not exists (
    select 1 from pg_indexes
     where tablename = 'tc_checkpoint_ejecuciones' and indexdef like '%UNIQUE%message_id%')
  then
    raise exception 'Falta el unique de message_id: el mismo correo podría procesarse dos veces';
  end if;

  raise notice 'OK: registro de importaciones del CheckPoint';
end $$;
