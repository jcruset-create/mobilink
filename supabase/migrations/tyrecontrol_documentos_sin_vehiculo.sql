-- ════════════════════════════════════════════════════════════════════════════
-- Un documento puede existir antes que su vehículo
-- ════════════════════════════════════════════════════════════════════════════
--
-- Al importar informes de tacógrafo en PDF desde el panel, el vehículo sale de
-- la matrícula del impreso. Cuando esa matrícula no está en TyreControl —un
-- autobús que todavía no se ha dado de alta— la intervención se crea igual,
-- sin vincular, porque es historia del centro técnico y el vehículo puede
-- aparecer mañana. Eso ya lo hacía el importador del Excel.
--
-- Lo que faltaba era poder guardar también el PDF. Tirarlo obligaba a que
-- alguien se acordara de volver a subirlo semanas después, y el papel que se
-- pierde es el que nadie echa de menos hasta que hace falta.
--
-- ── Esto no cambia NADA en producción ───────────────────────────────────────
--
-- `tc_vehiculo_documentos.vehiculo_id` ya está como anulable ahí: alguien lo
-- cambió a mano en su día y la migración de la ficha técnica, que lo creó
-- NOT NULL, nunca se enteró. Así que aplicar esto en producción es un no-op
-- —`drop not null` sobre una columna que ya lo admite no hace nada ni falla—.
--
-- Está aquí para que las migraciones digan la verdad. Una base nueva montada
-- desde los ficheros salía con la columna NOT NULL, o sea DISTINTA de
-- producción, y el día que alguien comparase los dos esquemas tendría que
-- averiguar cuál de los dos era el bueno. Ahora los dos dicen lo mismo.
--
-- ── Dónde se ve un documento sin vehículo ───────────────────────────────────
--
-- En la ficha del vehículo, en cuanto exista: los informes de una ficha se
-- buscan por las intervenciones de ese vehículo y no solo por `vehiculo_id`,
-- así que vincular la intervención al autobús —a mano o cuando llegue el
-- Excel del mes— hace aparecer su clip sin tener que tocar el documento.

alter table tc_vehiculo_documentos
  alter column vehiculo_id drop not null;

comment on column tc_vehiculo_documentos.vehiculo_id is
  'El vehículo al que pertenece el documento. Anulable: un informe de tacógrafo puede llegar antes que el alta del autobús, y el papel se guarda igual. Se encuentra por su intervención hasta que haya vehículo.';

-- El índice de «un solo documento vigente por vehículo y tipo» no estorba con
-- nulos: un índice único trata cada NULL como distinto, así que dos documentos
-- sin vehículo nunca chocan entre sí. Y los informes de tacógrafo ya estaban
-- fuera de ese índice, por ser un histórico.
