-- ════════════════════════════════════════════════════════════════════════════
-- Informes técnicos de tacógrafo en PDF, adjuntos a su intervención
-- ════════════════════════════════════════════════════════════════════════════
--
-- Dos columnas. No hay tabla nueva, y es a propósito: el PDF se guarda en
-- `tc_vehiculo_documentos` y en el bucket privado `tc-documentos`, que es
-- donde ya viven las fichas técnicas, con su sha256 para duplicados, su URL
-- firmada, su tamaño y su `vehiculo_id` ANULABLE —que hace falta: la matrícula
-- del informe puede no casar con ningún vehículo de la empresa—.
--
-- Dos diferencias con la ficha técnica, también a propósito:
--
--   · `vigente` no se usa. La ficha técnica tiene una vigente y archiva la
--     anterior; los informes de tacógrafo son un histórico donde todos valen,
--     uno por intervención.
--   · `ocr_*` se queda a null. Leer este impreso es un parser determinista
--     sobre la capa de texto del PDF, no un reconocimiento con confianza y
--     margen de error. Decir «ocr_estado: ok» mentiría sobre cómo se obtuvo.
--
-- ── Por qué la clave ajena va en el documento ───────────────────────────────
--
-- Un informe pertenece a una intervención, no al contrario, y así caben dos
-- (el original y una copia corregida del centro) sin tocar el esquema.
--
-- `on delete set null` y NO cascade: deshacer un lote de importación borra
-- intervenciones, y el PDF que subió una persona no se puede ir con ellas. El
-- documento se queda huérfano y visible en la ficha del vehículo, que es
-- mucho mejor que desaparecer sin que nadie se entere. Y `deshacer.ts` se
-- niega a deshacer un lote con informes adjuntos, por lo mismo.
--
-- ── Por qué `creada_de_pdf` y no un `sistema_origen` propio ─────────────────
--
-- La identidad de una intervención es `(empresa_id, sistema_origen,
-- id_origen)`. Si una fila creada desde un PDF llevara un `sistema_origen`
-- distinto, el día que el Excel mensual del centro trajera ese mismo nº de
-- orden entraría como fila NUEVA: dos intervenciones idénticas en el
-- histórico, el contador del vehículo inflado y dos fechas para el mismo
-- vencimiento.
--
-- Así que lleva el mismo `informe_intervenciones` y la clave única hace su
-- trabajo. La procedencia se marca aquí, y sirve para algo más que para
-- informar: una fila creada del PDF está INCOMPLETA —el impreso no trae la
-- versión de software de las unidades VDO, por ejemplo—, y el importador del
-- Excel la completa en vez de saltársela por «ya importada».

alter table tc_vehiculo_documentos
  add column if not exists intervencion_id uuid
    references tc_tacografo_intervenciones(id) on delete set null;

comment on column tc_vehiculo_documentos.intervencion_id is
  'La intervención de tacógrafo que documenta este PDF, cuando lo es. Se pone a null si la intervención se borra: el PDF que subió una persona no se va con un lote deshecho.';

-- Los informes de una intervención se buscan por aquí, y son uno o dos: el
-- índice parcial cuesta nada y no lo paga la tabla entera de documentos.
create index if not exists idx_tc_veh_doc_intervencion
  on tc_vehiculo_documentos (intervencion_id) where intervencion_id is not null;

alter table tc_tacografo_intervenciones
  add column if not exists creada_de_pdf boolean not null default false;

comment on column tc_tacografo_intervenciones.creada_de_pdf is
  'La fila se creó leyendo un informe técnico en PDF, no el Excel del centro. Está incompleta a propósito: el importador del Excel la completa cuando llegue el mes, en vez de saltarla por duplicada.';

-- Las que se crearon desde un PDF y aún esperan su fila del Excel. Son pocas
-- y se consultan en cada importación: con el índice parcial, buscarlas no
-- recorre las 1.744 filas.
create index if not exists idx_tcg_interv_de_pdf
  on tc_tacografo_intervenciones (empresa_id) where creada_de_pdf;

-- Las políticas no cambian: `tc_vehiculo_documentos` ya tiene su política
-- ALL sobre `tc_puede_ver_empresa(empresa_id)` y las intervenciones las suyas
-- dos. Añadir una columna no abre nada que no estuviera abierto.


-- ════════════════════════════════════════════════════════════════════════════
-- El índice que habría dejado adjuntar UN solo informe por vehículo
-- ════════════════════════════════════════════════════════════════════════════
--
-- `tc_vehiculo_documentos` trae de la ficha técnica este índice:
--
--     create unique index idx_veh_doc_vigente
--       on tc_vehiculo_documentos (vehiculo_id, tipo) where vigente;
--
-- «Solo un documento vigente por vehículo y tipo», que para la ficha técnica
-- es exactamente la regla buena: hay una vigente y las anteriores se
-- archivan.
--
-- Para los informes de tacógrafo es justo lo contrario. Son un HISTÓRICO: un
-- autobús con revisión cada dos años acumula informes, y todos valen. Con el
-- índice tal cual, el primer informe entra y **el segundo del mismo vehículo
-- revienta** con un error de clave duplicada que no dice nada de lo que pasa
-- de verdad. Y no se vería hasta que alguien adjuntara el segundo, que puede
-- ser dentro de dos años.
--
-- Así que el índice pasa a ser el de los documentos que SÍ tienen una
-- versión vigente. Marcar los informes como `vigente = false` para colarlos
-- habría funcionado igual y habría dejado un «archivado» mintiendo en cada
-- fila.

drop index if exists idx_veh_doc_vigente;
create unique index if not exists idx_veh_doc_vigente
  on tc_vehiculo_documentos (vehiculo_id, tipo)
  where vigente and tipo <> 'informe_tacografo';

-- Nota sobre `vehiculo_id`: la migración de la ficha técnica lo creó NOT NULL
-- y en producción está como anulable. Esto no depende de ninguna de las dos
-- cosas: un informe se sube siempre desde la ficha de un vehículo concreto, y
-- si la matrícula del impreso no es la suya, el servidor NO graba —responde
-- con las dos matrículas y pregunta—. Un documento sin vehículo no se crea.
