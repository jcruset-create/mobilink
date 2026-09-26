-- MC Central · Fase 22 — las reposiciones del fondo, para que la posición cuadre
--
-- EL PROBLEMA
--
-- Cuando una caja se queda sin cambio, se repone el fondo con billetes del
-- montón que iba a ir al banco. Ese dinero VUELVE al cajón. La caja lo
-- descuenta —`cash_float_topups`, vivo mientras `bank_deposit_id IS NULL`— y
-- por eso su pantalla de ingresos enseña el neto.
--
-- Central no se enteraba: la reposición se asienta como un `MANUAL_IN`
-- cualquiera, así que llegaba como movimiento de efectivo y subía el cajón,
-- pero el cierre que apartó ese dinero seguía sin conciliar y también contaba
-- como «esperando al banco». Los mismos billetes, contados dos veces, en
-- contra de la regla que gobierna esa consulta.
--
-- Caso real (Tarragona · Caja Mostrador, 05/09/2026): la caja decía 105,76 €
-- pendientes y Central 136,43 €. La diferencia, 30,67 €, eran dos reposiciones.
--
-- LO QUE HACE ESTE FICHERO
--
-- Crear la proyección que faltaba. Es ADITIVO: no toca ni una fila de caja.
-- Nace vacía y se rellena con los eventos `FLOAT_TOPUP_REGISTERED`, que la
-- caja emite desde ahora y que el botón «Resincronizar con la caja» de
-- Central → Ingresos reemite para las reposiciones que ya existían.
--
-- IDEMPOTENTE: se puede ejecutar más de una vez sin romper nada.

create table if not exists central_float_topups (
  topup_id         integer primary key,
  empresa_id       uuid not null,
  centro_id        uuid,
  register_id      integer,
  importe_centimos bigint not null default 0,
  fecha            date,
  -- NULL = todavia resta del monton. Con id = ya se lo llevo ese ingreso.
  deposit_id       integer,
  creado_en_ms     bigint,
  actualizado_en_ms bigint not null
);

-- El indice que de verdad se usa: la suma de lo que todavia resta, por empresa.
create index if not exists central_topups_pendientes_idx
  on central_float_topups (empresa_id) where deposit_id is null;

create index if not exists central_topups_caja_idx
  on central_float_topups (register_id);
