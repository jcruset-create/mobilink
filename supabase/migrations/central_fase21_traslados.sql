-- MC Central · Fase 21 — traslados de efectivo entre cajas
--
-- La fase 19 sabia PROPONERLOS pero no podia ejecutarlos, por un motivo
-- concreto: en medio del viaje el dinero no esta en ninguna de las dos cajas, y
-- sin un documento que lo represente se contaria dos veces o ninguna, que es el
-- doble conteo que cerro la fase 4.
--
-- La regla que lo sostiene es la que ya rige los pedidos al banco y las
-- entregas: los asientos se hacen cuando el dinero se mueve, no cuando se
-- planea. Al crear el traslado sale del cajon de origen; al recibirlo entra en
-- el de destino; en medio, ninguna de las dos lo tiene.
--
-- Equivalente en código: server/cash/schema.ts.

create table if not exists cash_transfers (
  id                   serial primary key,
  empresa_id           uuid not null,
  numero               text not null,
  origen_register_id   integer not null references cash_registers(id) on delete restrict,
  destino_register_id  integer not null references cash_registers(id) on delete restrict,
  -- Una caja no se manda dinero a si misma: seria un asiento de ida y otro de
  -- vuelta por el mismo importe, o sea, ruido en el libro mayor.
  constraint cash_transfers_distintas check (origen_register_id <> destino_register_id),

  estado               text not null default 'EN_TRANSITO'
                       check (estado in ('EN_TRANSITO','RECIBIDO','CANCELADO')),
  importe_centimos     bigint not null check (importe_centimos > 0),
  -- Lo que de verdad llego, que puede no ser lo que salio.
  recibido_centimos    bigint,
  diferencia_motivo    text,

  -- Quien lleva la bolsa. Es lo que se pregunta cuando no aparece.
  portador             text,
  notas                text,

  session_id_salida    integer references cash_sessions(id) on delete restrict,
  operation_salida_id  integer references cash_operations(id) on delete restrict,
  session_id_entrada   integer references cash_sessions(id) on delete restrict,
  operation_entrada_id integer references cash_operations(id) on delete restrict,

  creado_por           uuid,
  creado_at_ms         bigint not null,
  cerrado_por          uuid,
  cerrado_at_ms        bigint
);

create index if not exists cash_transfers_empresa_idx on cash_transfers (empresa_id, estado);
create index if not exists cash_transfers_destino_idx on cash_transfers (destino_register_id, estado);

create table if not exists cash_transfer_lines (
  transfer_id    integer not null references cash_transfers(id) on delete cascade,
  -- ENVIADO o RECIBIDO: se guardan las dos, porque comparar lo que salio con lo
  -- que llego es justo lo que hay que poder hacer.
  rol            text not null check (rol in ('ENVIADO','RECIBIDO')),
  valor_centimos integer not null,
  cantidad       integer not null,
  primary key (transfer_id, rol, valor_centimos)
);
