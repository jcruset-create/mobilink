-- Recepciones · el albarán entra aunque su pedido no exista
--
-- Gemelo de `initRecepciones()` en server/recepciones/schema.ts, que ya lo
-- aplica solo al arrancar. Esto es para pegarlo en el SQL Editor de Supabase
-- si se quiere adelantar.
--
-- Un pedido DEDUCIDO no lo mandó el proveedor: se dedujo de su albarán porque
-- el correo del pedido no había llegado. Mientras la marca sea true, la
-- cantidad pedida de sus líneas es «lo expedido hasta ahora», no lo que se
-- encargó, y crece con cada albarán nuevo. Cuando llega el correo del pedido,
-- las cantidades pasan a ser las suyas y la marca se apaga.

ALTER TABLE rcp_pedidos ADD COLUMN IF NOT EXISTS derivado_de_albaran BOOLEAN NOT NULL DEFAULT FALSE;
