-- ============================================================
-- Módulo Tacógrafos — Fase 2 (esqueleto y datos)
--
-- Documentación de la sustitución de tacógrafos digitales: certificados de
-- transferibilidad e intransferibilidad y los documentos que los envuelven
-- (autorización del cliente, acuse de recibo y comunicación a la
-- administración).
--
-- ALCANCE: el informe/certificado oficial del anexo II del RD 125/2017 lo
-- emite la extranet de VDO, así que aquí NO se guardan sus 27 campos ni la
-- trazabilidad de equipos y precintos, que viven en el informe técnico de esa
-- misma extranet. Lo que sí es obligación del centro —y por tanto vive aquí—
-- es la custodia de los archivos transferidos y la documentación de su
-- destrucción al año (nota F del anexo II y apartado 8.5.1 de la UNE
-- 66102:2025).
--
-- Prefijo tac_ para no colisionar con otros módulos.
--
-- NOTA: esta migración también se aplica sola al arrancar el servidor
-- (server/tacografos/schema.ts), así que normalmente no hace falta ejecutarla
-- a mano. Se conserva aquí como referencia y para entornos sin ese arranque.
--
-- Pegar en Supabase (SQL Editor). Idempotente.
-- ============================================================

-- ── Centro técnico ──────────────────────────────────────────
-- Una fila por empresa. Es la hoja CONFIGURACIÓN del libro: los documentos
-- leen de aquí en vez de llevar el nombre del centro incrustado en el texto.
CREATE TABLE IF NOT EXISTS tac_centros (
  id SERIAL PRIMARY KEY,
  empresa_id UUID NOT NULL UNIQUE,
  nombre TEXT NOT NULL DEFAULT '',
  centro_tecnico TEXT NOT NULL DEFAULT 'Centro técnico de Tacógrafos',
  -- Contraseña identificativa asignada al centro (p. ej. E943009).
  num_centro TEXT NOT NULL DEFAULT '',
  direccion1 TEXT NOT NULL DEFAULT '',
  direccion2 TEXT NOT NULL DEFAULT '',
  ciudad TEXT NOT NULL DEFAULT '',
  -- Ciudad de la línea de firma ("En Tarragona, a ..."), sin código postal.
  ciudad_firma TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  destinatario_admin TEXT NOT NULL DEFAULT '',
  responsable_tecnico TEXT NOT NULL DEFAULT '',
  url_tramite TEXT NOT NULL DEFAULT '',
  url_tramite_ovt TEXT NOT NULL DEFAULT '',
  created_at_ms BIGINT NOT NULL,
  updated_at_ms BIGINT NOT NULL
);

-- ── Expedientes ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tac_expedientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,

  -- Número que asigna la extranet al emitir el anexo II: aquí se copia, no se
  -- genera. Dos numeraciones para el mismo certificado sería justo lo que un
  -- inspector no debe encontrarse.
  num_informe TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('transferencia','intransferibilidad')),
  estado TEXT NOT NULL DEFAULT 'borrador'
    CHECK (estado IN ('borrador','emitido','entregado','comunicado','anulado')),

  empresa_cliente TEXT NOT NULL DEFAULT '',
  autoriza_nombre TEXT NOT NULL DEFAULT '',
  autoriza_nif TEXT NOT NULL DEFAULT '',
  -- Nota D del anexo II: el centro verifica y archiva el documento que avala
  -- la titularidad de los datos.
  doc_titularidad BOOLEAN NOT NULL DEFAULT false,

  matricula TEXT NOT NULL DEFAULT '',
  -- Lo exige el documento de destrucción (8.5.1).
  bastidor TEXT NOT NULL DEFAULT '',

  tac_marca TEXT NOT NULL DEFAULT '',
  tac_modelo TEXT NOT NULL DEFAULT '',
  tac_serie TEXT NOT NULL DEFAULT '',

  fecha_informe DATE,
  fecha_entrega DATE,
  fecha_transferencia DATE,
  fecha_envio DATE,
  tecnico TEXT NOT NULL DEFAULT '',
  modalidad_entrega TEXT
    CHECK (modalidad_entrega IS NULL OR modalidad_entrega IN
      ('en_mano','email','mensajeria','correo_certificado')),

  -- Quien recibe el certificado, distinto de quien autoriza la descarga: en el
  -- libro original también eran dos personas.
  receptor_nombre TEXT NOT NULL DEFAULT '',
  receptor_dni TEXT NOT NULL DEFAULT '',

  -- true = se entrega el aparato averiado al cliente; false = se achatarra.
  -- Una sola columna porque son excluyentes: con dos se podría guardar un
  -- expediente que afirmara las dos cosas.
  entrega_aparato BOOLEAN NOT NULL DEFAULT false,

  destruccion_fecha DATE,
  destruccion_metodo TEXT NOT NULL DEFAULT '',
  destruccion_persona TEXT NOT NULL DEFAULT '',
  destruccion_hash TEXT NOT NULL DEFAULT '',

  -- Enlace opcional con la intervención de taller, cuando la hay. Un centro
  -- que compre sólo este módulo no tiene tc_intervenciones.
  intervencion_id UUID,

  created_at_ms BIGINT NOT NULL,
  updated_at_ms BIGINT NOT NULL,
  created_by UUID,
  UNIQUE (empresa_id, num_informe)
);

CREATE INDEX IF NOT EXISTS tac_exp_empresa_idx
  ON tac_expedientes(empresa_id, fecha_informe DESC);
CREATE INDEX IF NOT EXISTS tac_exp_matricula_idx
  ON tac_expedientes(empresa_id, matricula);
-- Para la cola de "pendientes de destruir" de la fase 5.
CREATE INDEX IF NOT EXISTS tac_exp_custodia_idx
  ON tac_expedientes(empresa_id, fecha_transferencia)
  WHERE destruccion_fecha IS NULL;
