-- MC Central · Fase 9 — integridad y version de las evidencias
--
-- El bucket privado y la URL firmada de 15 minutos ya existian. Lo que faltaba
-- era poder demostrar que el fichero que hay hoy es el que se adjunto, y poder
-- sustituir un escaneo torcido sin perder el anterior.
--
-- · sha256 es la huella del fichero tal y como se subio. Una factura que
--   respalda una salida de caja no puede cambiar sin que se note.
-- · version y reemplaza_a porque un justificante SE SUSTITUYE, no se corrige.
--   El anterior se marca sustituido y se queda: aqui no se borra nada, y menos
--   lo que respalda un movimiento de dinero.
--
-- Nullable a proposito: los documentos anteriores a esta fase no tienen huella,
-- y eso es un dato -no se puede verificar lo que se subio antes de empezar a
-- medirlo- no algo que haya que inventar.
--
-- Equivalente en código: server/cash/schema.ts.

alter table cash_operation_documents
  add column if not exists sha256      text,
  add column if not exists version     integer not null default 1,
  add column if not exists reemplaza_a integer,
  add column if not exists sustituido  boolean not null default false;

create index if not exists cash_docs_sha_idx
  on cash_operation_documents (empresa_id, sha256) where sha256 is not null;
