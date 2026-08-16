-- ============================================================
-- Mobilink Cash — Fase 5: justificantes escaneados
--
--   El PDF que saca el escáner del mostrador, colgado del cobro o del pago que
--   respalda. El informe de cierre los lleva todos dentro, de modo que el
--   papeleo del día queda en un único fichero.
--
--   El fichero NO va aquí: vive en un bucket privado del almacenamiento y de
--   él solo se guarda la ruta. La URL tampoco se guarda, se firma al pedirla y
--   caduca — son facturas de clientes y de proveedores, no logotipos, y un
--   enlace permanente reenviado por ahí abriría la facturación del día a
--   cualquiera.
--
--   Un justificante no se borra: se anula. Un escaneo movido deja de salir en
--   el informe pero consta que existió y quién lo quitó, como todo lo demás
--   del módulo.
--
-- NOTA: esta migración también se aplica sola al arrancar el servidor
-- (server/cash/schema.ts). Se conserva aquí para pegar en el SQL Editor de
-- Supabase y para entornos sin ese arranque. Idempotente.
-- ============================================================

create table if not exists cash_operation_documents (
  id             serial primary key,
  empresa_id     uuid not null,
  operation_id   integer not null references cash_operations(id) on delete restrict,
  -- Repetida a propósito: el informe pide todos los documentos de una jornada,
  -- y sin esta columna habría que pasar por las operaciones cada vez.
  session_id     integer not null references cash_sessions(id) on delete restrict,

  nombre         text not null,
  mime           text not null,
  tamano_bytes   integer not null,
  ruta           text not null,

  anulado        boolean not null default false,
  anulado_por    uuid,
  anulado_at_ms  bigint,
  anulado_motivo text,

  subido_por     uuid,
  subido_at_ms   bigint not null
);

create index if not exists cash_op_docs_operacion_idx
  on cash_operation_documents (operation_id) where not anulado;

create index if not exists cash_op_docs_sesion_idx
  on cash_operation_documents (session_id) where not anulado;

-- ── Bucket ──────────────────────────────────────────────────────────────────
-- El servidor crea `cash-documents` como bucket PRIVADO la primera vez que se
-- adjunta algo, así que normalmente no hay que hacer nada. Si se prefiere
-- crearlo a mano, tiene que ser privado: con un bucket público, cualquiera con
-- la URL vería las facturas sin sesión.
