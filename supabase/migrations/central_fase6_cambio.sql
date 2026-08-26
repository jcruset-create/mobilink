-- MC Central · Fase 6 — vista consolidada de cambio y arqueos
--
-- El motor de denominaciones, cartuchos, bolsas y arqueo ya estaba entregado en
-- el modulo de caja. Lo que faltaba era verlo de toda la red a la vez, y para
-- eso Central necesita el detalle POR PIEZA, que hasta ahora no recibia: los
-- eventos de arqueo solo llevaban totales.
--
-- La foto sale del ultimo arqueo y no del stock teorico. El teorico es correcto
-- por construccion, pero el arqueo es lo que alguien ha contado con la mano, y
-- para decidir si un taller se esta quedando sin calderilla la foto buena es la
-- contada.
--
-- Equivalente en código: server/central/schema.ts.

create table if not exists central_denomination_stock (
  register_id       integer not null,
  valor_centimos    integer not null,
  empresa_id        uuid not null,
  centro_id         uuid,
  cantidad          integer not null default 0,
  -- Diferencia del ultimo arqueo en esa pieza. Un descuadre de un billete y
  -- otro de veinte monedas de cinco centimos no son el mismo problema.
  diferencia        integer not null default 0,
  session_id        integer,
  contado_en_ms     bigint,
  actualizado_en_ms bigint not null,
  primary key (register_id, valor_centimos)
);

create index if not exists central_denom_empresa_idx
  on central_denomination_stock (empresa_id, valor_centimos);
