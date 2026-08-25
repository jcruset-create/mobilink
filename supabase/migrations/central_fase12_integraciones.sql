-- MC Central · Fase 12 — API canonica, acceso maquina-a-maquina y webhooks
--
-- Hasta aqui no existia ninguna forma de que un PROGRAMA hablara con Mobilink:
-- toda la API exige el Bearer de una sesion de Supabase, o sea, un usuario con
-- su contrasena. Un proceso desatendido tenia que usar la cuenta de una
-- persona, que hereda todos sus permisos y deja de funcionar el dia que esa
-- persona se va. Era el riesgo R8.
--
-- De los secretos solo se guarda la huella -ni el del cliente ni el testigo-,
-- asi que una copia de esta base no da acceso a nada. El secreto se ensena una
-- sola vez al crearlo; si se pierde, se genera otro.
--
-- Equivalente en código: server/central/schema.ts.

create table if not exists central_api_clients (
  client_id      text primary key,
  empresa_id     uuid not null,
  nombre         text not null,
  secreto_huella text not null,
  alcances       text[] not null default '{}',
  activo         boolean not null default true,
  creado_en_ms   bigint not null,
  ultimo_uso_ms  bigint
);

create index if not exists central_api_clients_empresa_idx
  on central_api_clients (empresa_id, activo);

create table if not exists central_api_tokens (
  token_huella text primary key,
  client_id    text not null,
  empresa_id   uuid not null,
  alcances     text[] not null default '{}',
  expira_ms    bigint not null
);

create index if not exists central_api_tokens_cliente_idx on central_api_tokens (client_id);
create index if not exists central_api_tokens_expira_idx  on central_api_tokens (expira_ms);

-- Webhooks de salida. Misma cola y mismos reintentos que los avisos por correo,
-- porque el problema es el mismo: un destino caido no puede tumbar lo que
-- genero el evento. Lo que cambia es la firma HMAC de cada envio, que es lo que
-- permite al receptor saber que viene de aqui y no de cualquiera que conozca
-- la URL.
create table if not exists central_webhooks (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null,
  url          text not null,
  secreto      text not null,
  eventos      text[] not null default '{}',
  activo       boolean not null default true,
  creado_en_ms bigint not null
);

create index if not exists central_webhooks_empresa_idx on central_webhooks (empresa_id, activo);

create table if not exists central_webhook_deliveries (
  id                 bigserial primary key,
  webhook_id         uuid not null,
  empresa_id         uuid not null,
  evento             text not null,
  idempotency_key    text not null,
  cuerpo             jsonb not null,
  estado             text not null default 'PENDIENTE'
                     check (estado in ('PENDIENTE','ENVIANDO','ENVIADO','ERROR','CANCELADO')),
  intentos           integer not null default 0,
  proximo_intento_ms bigint,
  last_error         text,
  codigo_http        integer,
  creado_en_ms       bigint not null,
  enviado_en_ms      bigint
);

create unique index if not exists central_webhook_unico_idx
  on central_webhook_deliveries (webhook_id, idempotency_key);
create index if not exists central_webhook_pendientes_idx
  on central_webhook_deliveries (estado, proximo_intento_ms)
  where estado in ('PENDIENTE','ERROR');
