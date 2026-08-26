-- MC Central · Fase 8 — Notification Hub
--
-- NO es un tercer sistema de correo. El proyecto ya tiene el transporte SMTP en
-- server/mail.ts, compartido por el index y por el vigilante del buzon del
-- CheckPoint. Lo que faltaba no era otro nodemailer, sino saber a quien avisar
-- de que: destinatarios, una cola y un worker.
--
-- Equivalente en código: server/central/schema.ts.

create table if not exists central_notification_channels (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null,
  canal             text not null default 'EMAIL',
  destino           text not null,
  -- Mismo ambito que las reglas: el responsable de un taller quiere los avisos
  -- de SU taller. Un buzon con avisos ajenos se filtra a una carpeta y deja de
  -- leerse.
  ambito            text not null default 'EMPRESA',
  ambito_id         text,
  -- Vacio = todos los tipos. Es el caso normal al empezar, y obligar a
  -- enumerarlos solo conseguiria que alguien olvidara uno.
  tipos             text[] not null default '{}',
  activo            boolean not null default true,
  creado_en_ms      bigint not null,
  actualizado_en_ms bigint not null
);

create index if not exists central_channels_empresa_idx
  on central_notification_channels (empresa_id, activo);
create unique index if not exists central_channels_unico_idx
  on central_notification_channels (empresa_id, canal, lower(destino), ambito,
                                    coalesce(ambito_id, ''));

-- La cola de avisos. Mismo patron que las otras dos colas del proyecto, y por
-- la misma razon: un aviso que no se puede mandar no puede tumbar lo que lo
-- genero.
create table if not exists central_notifications (
  id                 bigserial primary key,
  empresa_id         uuid not null,
  incident_id        bigint not null,
  channel_id         uuid,
  canal              text not null default 'EMAIL',
  destino            text not null,
  asunto             text not null,
  cuerpo             text not null,
  estado             text not null default 'PENDIENTE'
                     check (estado in ('PENDIENTE','ENVIANDO','ENVIADO','ERROR','CANCELADO')),
  intentos           integer not null default 0,
  proximo_intento_ms bigint,
  last_error         text,
  creado_en_ms       bigint not null,
  enviado_en_ms      bigint
);

-- Un aviso por incidencia y destinatario. Las incidencias ya estan
-- deduplicadas por hecho, asi que esto es lo que impide que un problema que
-- dura tres dias mande tres correos iguales.
create unique index if not exists central_notif_unica_idx
  on central_notifications (incident_id, canal, lower(destino));

create index if not exists central_notif_pendientes_idx
  on central_notifications (estado, proximo_intento_ms)
  where estado in ('PENDIENTE','ERROR');
