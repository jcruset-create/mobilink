-- ============================================================
-- Mobilink Core — la versión limpia del DNI y del carnet
--
-- La foto que hace el operario sale como sale: torcida, con la mesa
-- de fondo y 2,5 MB de cámara. Al subirla, el servidor le pide a la
-- IA dónde está el documento dentro de la foto y recorta, endereza y
-- mejora con `sharp`.
--
-- La original NO se borra ni se sustituye: es la prueba de lo que el
-- trabajador mandó y firmó. Aquí solo se guarda la ruta de la copia
-- limpia, que es la que se enseña en la ficha.
--
-- Pegar en Supabase (SQL Editor). Idempotente.
-- ============================================================

alter table sea_employee_documents
  add column if not exists recorte_path text,
  add column if not exists recorte_at   timestamptz,
  add column if not exists recorte_meta jsonb;

comment on column sea_employee_documents.recorte_path is
  'Copia recortada y mejorada. NULL = no se pudo, y entonces se enseña la original.';
comment on column sea_employee_documents.recorte_meta is
  'Lo que dijo el modelo: recuadro, giro y por que, para poder revisar un recorte malo.';
