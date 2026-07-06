-- ============================================================
-- SEA Administración — Fase 8
-- Envíos automáticos de WhatsApp y email en recobros:
--   · adm_notificacion_destinatarios: teléfonos internos que
--     reciben los avisos por WhatsApp (se gestiona en Configuración).
--   · adm_notificaciones: cola y registro de envíos (programados
--     y automáticos), procesada por el servidor.
-- Pegar en Supabase (SQL Editor). Idempotente.
-- ============================================================

create table if not exists adm_notificacion_destinatarios (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  telefono    text not null,
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists adm_notificaciones (
  id                 uuid primary key default gen_random_uuid(),
  recovery_case_id   uuid references adm_recovery_cases(id) on delete cascade,
  canal              text not null
                     check (canal in ('whatsapp_deudor','email_deudor','whatsapp_interno','resumen_interno')),
  destinatario       text,
  mensaje            text,
  fecha_programada   date not null default current_date,
  estado             text not null default 'pendiente'
                     check (estado in ('pendiente','enviado','error','cancelado')),
  enviado_at         timestamptz,
  error_text         text,
  created_by         uuid references adm_usuarios(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists idx_adm_notif_estado_fecha on adm_notificaciones (estado, fecha_programada);
create index if not exists idx_adm_notif_caso on adm_notificaciones (recovery_case_id);

-- RLS
alter table adm_notificacion_destinatarios enable row level security;
alter table adm_notificaciones             enable row level security;

drop policy if exists adm_destinatarios_select on adm_notificacion_destinatarios;
create policy adm_destinatarios_select on adm_notificacion_destinatarios for select
  using ( adm_can_manage() or adm_rol_actual() = 'supervisor' );
drop policy if exists adm_destinatarios_write on adm_notificacion_destinatarios;
create policy adm_destinatarios_write on adm_notificacion_destinatarios for all
  using ( adm_can_manage() ) with check ( adm_can_manage() );

drop policy if exists adm_notificaciones_select on adm_notificaciones;
create policy adm_notificaciones_select on adm_notificaciones for select
  using ( adm_can_manage() or adm_rol_actual() = 'supervisor' );
drop policy if exists adm_notificaciones_write on adm_notificaciones;
create policy adm_notificaciones_write on adm_notificaciones for all
  using ( adm_can_manage() ) with check ( adm_can_manage() );
