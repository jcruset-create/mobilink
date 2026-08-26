-- MC Central · Fase 2 — cola de eventos de dominio
--
-- Hermana de `cash_erp_outbox`, y tabla aparte a propósito: aquélla lleva
-- `connector_key` y una clave ajena a `cash_operations`, y está en producción.
-- Mezclar dos dominios en una cola viva es riesgo gratuito.
--
-- Lo que manda sobre todo el diseño: esta fila se escribe DENTRO de la
-- transacción que mueve el dinero. Si su INSERT fallara, se desharía un cobro
-- que ya ocurrió físicamente. Por eso NO hay clave ajena, ni CHECK sobre el
-- tipo, ni ninguna restricción que dependa de los datos: lo único que puede
-- rechazar esta fila es que la base esté caída, y entonces el cobro tampoco se
-- habría guardado.
--
-- Equivalente en código: server/cash/schema.ts (bloque «Cola de eventos»).

create table if not exists cash_event_outbox (
  id                bigserial primary key,
  -- Clave de deduplicación en destino; viaja como Idempotency-Key.
  event_id          uuid not null default gen_random_uuid() unique,
  empresa_id        uuid not null,
  -- El taller se copia aunque se pueda deducir de la caja: el evento cuenta lo
  -- que pasó ENTONCES, y eso incluye dónde pasó. La caja pudo reasignarse.
  centro_id         uuid,
  register_id       integer,
  session_id        integer,
  aggregate_type    text,
  aggregate_id      bigint,
  aggregate_version bigint,
  tipo              text not null,
  -- Cuándo OCURRIÓ, que no es cuándo se envía ni cuándo se tecleó.
  ocurrido_en_ms    bigint not null,
  actor_user_id     uuid,
  datos             jsonb not null default '{}'::jsonb,
  estado            text not null default 'PENDING'
                    check (estado in ('PENDING','SENDING','SENT','ERROR','RETRY_PENDING','CANCELLED')),
  intentos          integer not null default 0,
  proximo_intento_ms bigint,
  last_error        text,
  created_at_ms     bigint not null,
  processed_at_ms   bigint
);

create index if not exists cash_events_pendientes_idx
  on cash_event_outbox (estado, proximo_intento_ms)
  where estado in ('PENDING','RETRY_PENDING');

create index if not exists cash_events_empresa_idx
  on cash_event_outbox (empresa_id, created_at_ms desc);

-- Orden de reconstrucción para Central: por agregado y versión.
create index if not exists cash_events_agregado_idx
  on cash_event_outbox (aggregate_type, aggregate_id, aggregate_version);

-- Versión del agregado: deja ver un hueco o un evento que llega tarde sin
-- fiarse del reloj. Sube dentro de bloqueos que YA existen —la jornada en
-- `bloquearSesion`, la caja en los ingresos bancarios—, así que no añade
-- contención: el incremento va donde ya había un FOR UPDATE.
--
-- `not null default 0` no reescribe las filas existentes (PostgreSQL guarda el
-- valor por defecto en el catálogo desde la 11), así que es seguro con datos.
alter table cash_sessions  add column if not exists version bigint not null default 0;
alter table cash_registers add column if not exists version bigint not null default 0;
