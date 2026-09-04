/**
 * Satisfaction: esquema.
 *
 * ── La relación con la asistencia es LÓGICA, no una clave ajena ─────────────
 *
 * Se usa la terna `("sourceSystem", "tenantId", "assistanceId")` con
 * «assistanceId» en TEXT, igual que «assistance_events», «assistance_documents»
 * y «assistance_messages». Un «REFERENCES roadside_assistances(id)» sería más
 * estricto y ataría el módulo a Assist para siempre: la asistencia de Central
 * es otra fila en otro sitio y numera por su cuenta. El precedente del repo ya
 * resolvió esto y no se estrena otra forma.
 *
 * ── La idempotencia vive en la base ─────────────────────────────────────────
 *
 * Cada garantía de «esto no puede ocurrir dos veces» es un índice único, no una
 * consulta previa. Dos workers a la vez pasarían los dos por un «¿ya existe?»,
 * y el resultado son dos encuestas al mismo conductor o dos expedientes del
 * mismo servicio. Con el índice, el segundo INSERT falla y el código lo trata.
 */

import db from "../db.ts";

export async function initSatisfaction(): Promise<void> {
  /* ── Plantillas ───────────────────────────────────────────────────────── */
  await db.query(`
    CREATE TABLE IF NOT EXISTS survey_templates (
      id BIGSERIAL PRIMARY KEY,
      code TEXT NOT NULL,
      version INTEGER NOT NULL,
      "recipientRole" TEXT NOT NULL,
      /*
       * Las preguntas, en JSON y versionadas. En una tabla de preguntas y otra
       * de opciones habría que hacer tres JOIN para pintar un formulario que
       * nunca se consulta por partes. Lo que sí se consulta por partes son las
       * RESPUESTAS, y ésas sí van desglosadas («survey_answers»).
       */
      "questionsJson" TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL,

      -- Una versión no se reescribe: se publica otra. Es lo que impide que
      -- editar la plantilla cambie el significado de lo ya contestado.
      UNIQUE (code, version)
    );

    CREATE INDEX IF NOT EXISTS idx_survey_templates_rol
      ON survey_templates ("recipientRole", active);
  `);

  /* ── Instancias ───────────────────────────────────────────────────────── */
  await db.query(`
    CREATE TABLE IF NOT EXISTS survey_instances (
      id BIGSERIAL PRIMARY KEY,

      "sourceSystem" TEXT NOT NULL,
      "tenantId" TEXT,
      "assistanceId" TEXT NOT NULL,

      "recipientRole" TEXT NOT NULL,
      "templateId" BIGINT NOT NULL REFERENCES survey_templates(id),
      /*
       * La versión se copia aquí además de estar en la plantilla. Redundante a
       * propósito: es lo que permite leer con qué formulario se contestó sin
       * depender de que la fila de la plantilla siga existiendo.
       */
      "templateVersion" INTEGER NOT NULL,

      status TEXT NOT NULL DEFAULT 'CREATED',

      /*
       * El token NUNCA en claro: solo su sha256. Quien pueda leer la base no
       * puede entrar a responder encuestas ajenas, y una copia de seguridad
       * filtrada no reparte accesos.
       */
      "tokenHash" TEXT NOT NULL,
      "expiresAtMs" BIGINT NOT NULL,

      "createdAtMs" BIGINT NOT NULL,
      "queuedAtMs" BIGINT,
      "sentAtMs" BIGINT,
      "deliveredAtMs" BIGINT,
      "startedAtMs" BIGINT,
      "completedAtMs" BIGINT,
      "cancelledAtMs" BIGINT,
      "failedAtMs" BIGINT,

      /*
       * Una encuesta por asistencia y destinatario.
       *
       * «tenantId» NO entra en la clave, y es deliberado: «assistanceId» ya es
       * único dentro de su «sourceSystem» —en Assist es el SERIAL de
       * «roadside_assistances»— y meterlo permitiría dos encuestas de la misma
       * asistencia si alguien la reasigna de taller, que es justo el duplicado
       * que se quiere impedir. El tenant se comprueba al leer, no al insertar.
       */
      UNIQUE ("sourceSystem", "assistanceId", "recipientRole")
    );

    -- Por aquí entra la ficha: todas las encuestas de una asistencia.
    CREATE INDEX IF NOT EXISTS idx_survey_instances_asistencia
      ON survey_instances ("tenantId", "sourceSystem", "assistanceId");
    -- Por aquí entrará el worker de 1C: lo que toca mandar.
    CREATE INDEX IF NOT EXISTS idx_survey_instances_estado
      ON survey_instances (status, "createdAtMs");
    -- Y por aquí el que caduca: solo lo que sigue vivo.
    CREATE INDEX IF NOT EXISTS idx_survey_instances_caducidad
      ON survey_instances ("expiresAtMs")
      WHERE status NOT IN ('COMPLETED','EXPIRED','CANCELLED');
    -- La miniweb de 1D busca EXACTAMENTE por aquí, y tiene que ser único: dos
    -- instancias con el mismo hash harían ambigua la resolución del token.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_survey_instances_token
      ON survey_instances ("tokenHash");
  `);

  /* ── Respuestas ───────────────────────────────────────────────────────── */
  await db.query(`
    CREATE TABLE IF NOT EXISTS survey_responses (
      id BIGSERIAL PRIMARY KEY,
      "surveyInstanceId" BIGINT NOT NULL REFERENCES survey_instances(id) ON DELETE CASCADE,
      "templateVersion" INTEGER NOT NULL,
      "completedAtMs" BIGINT NOT NULL,
      "createdAtMs" BIGINT NOT NULL,

      -- Una respuesta por encuesta. Es la barrera contra el doble envío del
      -- formulario, y contra dos peticiones simultáneas que pasen las dos la
      -- comprobación de estado.
      UNIQUE ("surveyInstanceId")
    );
  `);

  /* ── Respuestas por pregunta ──────────────────────────────────────────── */
  await db.query(`
    CREATE TABLE IF NOT EXISTS survey_answers (
      id BIGSERIAL PRIMARY KEY,
      "surveyResponseId" BIGINT NOT NULL REFERENCES survey_responses(id) ON DELETE CASCADE,
      "questionCode" TEXT NOT NULL,

      /*
       * Dos columnas para el valor, y el motivo es que se consultan de formas
       * distintas:
       *
       *   · «value» guarda la representación textual de cualquier tipo —texto,
       *     enum, y la selección múltiple como JSON.
       *   · «scaleValue» guarda SOLO los ratings, como entero.
       *
       * Sin «scaleValue», calcular la media de «overall_rating» obligaría a un
       * cast de texto a número en cada fila, que no puede usar índice. Con él,
       * «AVG(scaleValue)» sobre el índice parcial es directo. Es la razón de
       * que las respuestas no vayan en un JSON único.
       */
      value TEXT,
      "scaleValue" INTEGER,

      "createdAtMs" BIGINT NOT NULL,

      -- Una fila por pregunta y respuesta.
      UNIQUE ("surveyResponseId", "questionCode")
    );

    /*
     * El índice de las métricas de §17: media por pregunta. Parcial, porque
     * solo los ratings tienen «scaleValue» y los comentarios no pintan nada en
     * un índice de agregación.
     */
    CREATE INDEX IF NOT EXISTS idx_survey_answers_metricas
      ON survey_answers ("questionCode", "scaleValue")
      WHERE "scaleValue" IS NOT NULL;
  `);

  /* ── Casos de calidad ─────────────────────────────────────────────────── */
  await db.query(`
    CREATE TABLE IF NOT EXISTS quality_cases (
      id BIGSERIAL PRIMARY KEY,

      "sourceSystem" TEXT NOT NULL,
      "tenantId" TEXT,
      "assistanceId" TEXT NOT NULL,

      -- De dónde salió. NULL cuando lo abra una persona a mano, que llegará.
      "surveyInstanceId" BIGINT REFERENCES survey_instances(id),
      "surveyResponseId" BIGINT REFERENCES survey_responses(id),
      "originRecipientRole" TEXT,

      reason TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'NORMAL',
      status TEXT NOT NULL DEFAULT 'NEW',

      "assigneeUserId" TEXT,
      resolution TEXT,
      "actionTaken" TEXT,

      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL,
      "resolvedAtMs" BIGINT,
      "closedAtMs" BIGINT
    );

    /*
     * Un caso automático por respuesta. Índice ÚNICO PARCIAL, no una
     * restricción de tabla: los casos abiertos a mano no tienen respuesta de
     * origen, y un UNIQUE normal sobre una columna con NULL no los limitaría
     * —en PostgreSQL dos NULL no son iguales— pero tampoco documentaría la
     * intención. Parcial dice exactamente lo que se quiere: lo automático es
     * único, lo manual no.
     */
    CREATE UNIQUE INDEX IF NOT EXISTS idx_quality_cases_origen
      ON quality_cases ("surveyResponseId")
      WHERE "surveyResponseId" IS NOT NULL;

    -- La bandeja de 1E: los casos de un tenant por estado y por prioridad.
    CREATE INDEX IF NOT EXISTS idx_quality_cases_bandeja
      ON quality_cases ("tenantId", status, "createdAtMs" DESC);
    CREATE INDEX IF NOT EXISTS idx_quality_cases_prioridad
      ON quality_cases ("tenantId", priority, "createdAtMs" DESC);
    -- El caso de una asistencia concreta, para la ficha.
    CREATE INDEX IF NOT EXISTS idx_quality_cases_asistencia
      ON quality_cases ("tenantId", "sourceSystem", "assistanceId");
    -- «Lo mío»: parcial, porque la mayoría de casos no tienen responsable.
    CREATE INDEX IF NOT EXISTS idx_quality_cases_responsable
      ON quality_cases ("assigneeUserId", status)
      WHERE "assigneeUserId" IS NOT NULL;
  `);

  /* ── Cronología del caso ──────────────────────────────────────────────── */
  await db.query(`
    CREATE TABLE IF NOT EXISTS quality_case_events (
      id BIGSERIAL PRIMARY KEY,
      "qualityCaseId" BIGINT NOT NULL REFERENCES quality_cases(id) ON DELETE CASCADE,
      "eventType" TEXT NOT NULL,        -- CREATED | STATUS_CHANGED | ASSIGNED | NOTE | RESOLVED | CLOSED
      "actorType" TEXT NOT NULL DEFAULT 'system',
      "actorId" TEXT,
      "actorName" TEXT,
      "fromValue" TEXT,
      "toValue" TEXT,
      note TEXT,
      "occurredAtMs" BIGINT NOT NULL,
      "createdAtMs" BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_quality_case_events_caso
      ON quality_case_events ("qualityCaseId", "occurredAtMs");
  `);

  /* ── Entregas ─────────────────────────────────────────────────────────── */
  await db.query(`
    CREATE TABLE IF NOT EXISTS survey_deliveries (
      id BIGSERIAL PRIMARY KEY,
      "surveyInstanceId" BIGINT NOT NULL REFERENCES survey_instances(id) ON DELETE CASCADE,

      channel TEXT NOT NULL,             -- WHATSAPP | SMS | EMAIL
      recipient TEXT,                    -- NULL: no se supo a quién mandarlo
      "messageType" TEXT NOT NULL,       -- INVITATION | REMINDER
      attempt INTEGER NOT NULL DEFAULT 1,

      "providerMessageId" TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      "errorCode" TEXT,
      "errorMessage" TEXT,

      "createdAtMs" BIGINT NOT NULL,
      "sentAtMs" BIGINT,
      "deliveredAtMs" BIGINT,
      "failedAtMs" BIGINT,

      /*
       * El intento identifica la fila. Sin esto, un reintento tras un fallo de
       * red podría anotar dos veces el mismo envío y las métricas de entrega
       * contarían de más; con esto, reintentar el intento 1 choca y hay que
       * decidir a propósito si es el 2.
       */
      UNIQUE ("surveyInstanceId", "messageType", attempt)
    );

    CREATE INDEX IF NOT EXISTS idx_survey_deliveries_instancia
      ON survey_deliveries ("surveyInstanceId", "createdAtMs");
    CREATE INDEX IF NOT EXISTS idx_survey_deliveries_estado
      ON survey_deliveries (status, "createdAtMs");
  `);

  await sembrarPlantillas();
}

/**
 * Deja las plantillas V1 en la base, sin pisar lo que ya hubiera.
 *
 * «ON CONFLICT DO NOTHING» sobre `(code, version)`: si una versión ya está
 * publicada no se toca, porque puede tener respuestas colgando. Publicar un
 * cambio es insertar la versión siguiente, nunca reescribir ésta.
 */
async function sembrarPlantillas(): Promise<void> {
  const { PLANTILLAS_V1 } = await import("./dominio.ts");
  const ahora = Date.now();
  for (const p of PLANTILLAS_V1) {
    await db.query(
      `INSERT INTO survey_templates
         (code, version, "recipientRole", "questionsJson", active, "createdAtMs", "updatedAtMs")
       VALUES ($1, $2, $3, $4, true, $5, $5)
       ON CONFLICT (code, version) DO NOTHING`,
      [p.code, p.version, p.recipientRole, JSON.stringify(p.preguntas), ahora],
    );
  }
}
