/**
 * Esquema del módulo Tacógrafos.
 *
 * DDL idempotente que se ejecuta al arrancar, como `initDb()`, `initCash()` y
 * `initLicenses()`. El equivalente para pegar en el SQL Editor de Supabase está
 * en `supabase/migrations/tacografos_fase2.sql`.
 *
 * Alcance del módulo, que explica lo que NO hay aquí: el informe/certificado
 * oficial del anexo II del RD 125/2017 lo emite la extranet de VDO, así que no
 * se guardan ni sus 27 campos ni la trazabilidad de equipos y precintos, que
 * viven en el informe técnico de esa misma extranet. Lo que sí es obligación
 * del centro —y por tanto vive aquí— es la custodia de los archivos
 * transferidos y la documentación de su destrucción al año.
 *
 * Dos decisiones que conviene no perder de vista:
 *
 * · El expediente NO depende de que exista una intervención de taller.
 *   `intervencion_id` es opcional: un centro que compre sólo este módulo no
 *   tiene `tc_intervenciones`.
 *
 * · «Se achatarrará» no es una columna. Es lo contrario de `entrega_aparato`,
 *   igual que en el libro original, donde un único SI/NO decidía las dos
 *   frases del acuse. Guardarlo por separado permitiría escribir en la base un
 *   expediente que dijera que el tacógrafo se entrega Y se achatarra.
 */

import pool from "../db.ts";

export async function initTacografos(): Promise<void> {
  // ── Centro técnico ────────────────────────────────────────────────────────
  // Una fila por empresa: es la hoja CONFIGURACIÓN del libro. Los documentos
  // leen de aquí en vez de llevar el nombre del centro incrustado en el texto.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tac_centros (
      id SERIAL PRIMARY KEY,
      empresa_id UUID NOT NULL UNIQUE,
      nombre TEXT NOT NULL DEFAULT '',
      centro_tecnico TEXT NOT NULL DEFAULT 'Centro técnico de Tacógrafos',
      -- Contraseña identificativa asignada al centro (E943009 en el caso de
      -- COMERCIAL SEA). Va en los tres documentos.
      num_centro TEXT NOT NULL DEFAULT '',
      direccion1 TEXT NOT NULL DEFAULT '',
      direccion2 TEXT NOT NULL DEFAULT '',
      ciudad TEXT NOT NULL DEFAULT '',
      -- Ciudad que aparece en la línea de firma ("En Tarragona, a ..."). Se
      -- separa de la anterior porque aquélla lleva el código postal.
      ciudad_firma TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      destinatario_admin TEXT NOT NULL DEFAULT '',
      responsable_tecnico TEXT NOT NULL DEFAULT '',
      url_tramite TEXT NOT NULL DEFAULT '',
      url_tramite_ovt TEXT NOT NULL DEFAULT '',
      created_at_ms BIGINT NOT NULL,
      updated_at_ms BIGINT NOT NULL
    );
  `);

  // ── Expedientes ───────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tac_expedientes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL,

      -- Número que asigna la extranet al emitir el anexo II. Aquí se copia, no
      -- se genera: dos numeraciones distintas para el mismo certificado sería
      -- justo lo que un inspector no debe encontrarse.
      num_informe TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK (tipo IN ('transferencia','intransferibilidad')),
      estado TEXT NOT NULL DEFAULT 'borrador'
        CHECK (estado IN ('borrador','emitido','entregado','comunicado','anulado')),

      -- Cliente
      empresa_cliente TEXT NOT NULL DEFAULT '',
      autoriza_nombre TEXT NOT NULL DEFAULT '',
      autoriza_nif TEXT NOT NULL DEFAULT '',
      -- Nota D del anexo II: el centro debe verificar y archivar el documento
      -- que avala la titularidad de los datos.
      doc_titularidad BOOLEAN NOT NULL DEFAULT false,

      -- Vehículo
      matricula TEXT NOT NULL DEFAULT '',
      -- Lo pide el documento de destrucción del apartado 8.5.1 de la norma.
      bastidor TEXT NOT NULL DEFAULT '',

      -- Unidad intravehicular sustituida
      tac_marca TEXT NOT NULL DEFAULT '',
      tac_modelo TEXT NOT NULL DEFAULT '',
      tac_serie TEXT NOT NULL DEFAULT '',

      -- Intervención
      fecha_informe DATE,
      fecha_entrega DATE,
      fecha_transferencia DATE,
      fecha_envio DATE,
      tecnico TEXT NOT NULL DEFAULT '',
      modalidad_entrega TEXT
        CHECK (modalidad_entrega IS NULL OR modalidad_entrega IN
          ('en_mano','email','mensajeria','correo_certificado')),

      -- Persona que recibe el certificado de intransferibilidad. Distinta de
      -- quien autoriza la descarga: en el libro original también lo eran.
      receptor_nombre TEXT NOT NULL DEFAULT '',
      receptor_dni TEXT NOT NULL DEFAULT '',

      -- true = se entrega el aparato averiado al cliente; false = se achatarra.
      -- Excluyentes por construcción, de ahí que sea una sola columna.
      entrega_aparato BOOLEAN NOT NULL DEFAULT false,

      -- Custodia de los archivos transferidos (nota F del anexo II y 8.5.1).
      destruccion_fecha DATE,
      destruccion_metodo TEXT NOT NULL DEFAULT '',
      destruccion_persona TEXT NOT NULL DEFAULT '',
      destruccion_hash TEXT NOT NULL DEFAULT '',

      -- Enlace opcional con la intervención de taller, cuando la hay.
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
    -- Para la cola de "pendientes de destruir" de la fase 5: se busca por fecha
    -- de transferencia entre los que aún no tienen destrucción registrada.
    CREATE INDEX IF NOT EXISTS tac_exp_custodia_idx
      ON tac_expedientes(empresa_id, fecha_transferencia)
      WHERE destruccion_fecha IS NULL;
  `);
}
