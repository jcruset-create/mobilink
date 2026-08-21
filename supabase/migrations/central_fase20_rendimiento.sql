-- MC Central · Fase 20 — rendimiento de las consultas de consumo
--
-- La prediccion (fase 17) y el reparto (fase 19) preguntan lo mismo por cada
-- caja: que piezas han salido dando cambio. Sin este indice, PostgreSQL recorre
-- LA TABLA ENTERA de movimientos para contestarlo, asi que el coste crece con
-- el libro mayor de toda la empresa en vez de con la historia de esa caja. Y el
-- libro mayor no mengua nunca.
--
-- Medido sobre 365.000 movimientos (5 cajas, dos anos de jornadas diarias):
--   · consulta suelta:            52 ms -> 30 ms, y deja de ser un Seq Scan
--   · llamada de la pantalla:    230 ms -> 140 ms
--
-- INCLUDE en vez de mas columnas de clave: no se busca por importe ni por
-- cantidad, solo se leen, asi que el indice ocupa menos y no se reordena por
-- ellas.
--
-- Equivalente en código: server/cash/schema.ts.
--
-- Se puede crear con CONCURRENTLY si la tabla es grande y no se quiere bloquear
-- la caja mientras tanto; en ese caso hay que lanzarlo FUERA de una transaccion.
create index if not exists cash_denmov_consumo_idx
  on cash_denomination_movements (session_id, motivo, direccion)
  include (valor_unitario_centimos, cantidad);
