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
       *
       * Y es NULL hasta que se emite. Crear la encuesta y emitir su token son
       * dos momentos distintos: la encuesta nace al cerrar la asistencia, el
       * token se emite justo antes de mandar el mensaje. Guardar solo el hash
       * significa que el valor en claro existe una vez y se pierde; si se
       * generara al crear, media hora después —cuando toca enviar— ya no
       * habría enlace que poner en el WhatsApp.
       */
      "tokenHash" TEXT,
      "tokenIssuedAtMs" BIGINT,
      "expiresAtMs" BIGINT NOT NULL,

      /*
       * A partir de cuándo se puede mandar. Se calcula y se GUARDA al crear,
       * no se deriva de la configuración en el momento de enviar: si mañana
       * alguien cambia el retraso global, una encuesta creada hoy no puede
       * moverse de hora por eso.
       */
      "sendAfterMs" BIGINT NOT NULL DEFAULT 0,

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
  `);

  /*
   * Para las bases que ya tenían la tabla de la fase 1B: el token pasa a ser
   * opcional y aparecen las dos columnas nuevas. `IF NOT EXISTS` y `DROP NOT
   * NULL` son idempotentes, así que esto se puede ejecutar en cada arranque.
   *
   * Va ANTES de los índices y no después, que es donde estaba. Sobre una base
   * que ya tenía la tabla, el `CREATE TABLE IF NOT EXISTS` de arriba no hace
   * nada, así que la columna «sendAfterMs» todavía no existe cuando se intenta
   * indexar: el arranque moría con «column "sendAfterMs" does not exist» y se
   * llevaba por delante todo el `initDb`. En una base recién creada no se
   * notaba —la tabla nacía con la columna—, que es justo por qué la CI no lo
   * vio.
   */
  await db.query(`
    ALTER TABLE survey_instances ALTER COLUMN "tokenHash" DROP NOT NULL;
    ALTER TABLE survey_instances ADD COLUMN IF NOT EXISTS "tokenIssuedAtMs" BIGINT;
    ALTER TABLE survey_instances ADD COLUMN IF NOT EXISTS "sendAfterMs" BIGINT NOT NULL DEFAULT 0;
  `);

  await db.query(`
    -- Por aquí entra la ficha: todas las encuestas de una asistencia.
    CREATE INDEX IF NOT EXISTS idx_survey_instances_asistencia
      ON survey_instances ("tenantId", "sourceSystem", "assistanceId");
    -- Por aquí entra el worker: lo que ya ha cumplido su espera. Parcial,
    -- porque solo se busca entre las que todavía no se han encolado.
    CREATE INDEX IF NOT EXISTS idx_survey_instances_maduras
      ON survey_instances ("sendAfterMs")
      WHERE status = 'CREATED';
    -- Y por aquí el que caduca: solo lo que sigue vivo.
    CREATE INDEX IF NOT EXISTS idx_survey_instances_caducidad
      ON survey_instances ("expiresAtMs")
      WHERE status NOT IN ('COMPLETED','EXPIRED','CANCELLED');
    /*
     * La miniweb de 1D busca EXACTAMENTE por aquí, y tiene que ser único: dos
     * instancias con el mismo hash harían ambigua la resolución del token.
     *
     * Parcial, porque una encuesta sin emitir no tiene hash y no debe ocupar
     * sitio en el índice ni chocar con las demás sin emitir.
     */
    CREATE UNIQUE INDEX IF NOT EXISTS idx_survey_instances_token
      ON survey_instances ("tokenHash") WHERE "tokenHash" IS NOT NULL;
  `);

  /*
   * ── 1G · El token se guarda también en claro ──────────────────────────
   *
   * En 1B solo se guardaba el sha256 y el valor en claro se devolvía una vez.
   * Con el envío diferido, el reintento y el recordatorio eso deja de
   * sostenerse: si el proceso muere entre emitir el token y hablar con Twilio,
   * en la base solo queda un hash y NO HAY FORMA de reconstruir el enlace; y un
   * recordatorio 24 h después tiene que volver a escribir exactamente la misma
   * URL. Un hash irreversible no permite ninguna de las dos cosas.
   *
   * De las alternativas —cifrado reversible, rotar en cada intento, varios
   * hashes por encuesta— se elige guardarlo en claro:
   *
   *  · el repositorio NO tiene infraestructura de cifrado reversible ni gestión
   *    de claves, y montar una a medida para esto sería inventarse criptografía;
   *  · rotar por intento produce enlaces muertos justo en el caso ambiguo, que
   *    es el que hay que proteger;
   *  · varios hashes exige una tabla de tokens y más piezas para el mismo fin.
   *
   * Y hay precedente en la propia casa: «trackingToken» y «reportToken» viven
   * en claro en «roadside_assistances», y el informe que abren enseña bastante
   * más que una encuesta —nombre, matrícula, dirección, importes—. Quien pueda
   * leer esta tabla ya tiene delante las respuestas de satisfacción.
   *
   * Son 256 bits de «randomBytes», no derivables de ningún id. El «tokenHash»
   * se mantiene: es por donde entra la miniweb y quien sostiene el índice único.
   */
  await db.query(`
    ALTER TABLE survey_instances ADD COLUMN IF NOT EXISTS token TEXT;

    /*
     * El destinatario, CONGELADO al crear la encuesta.
     *
     * Sin esto, una encuesta creada para un número se mandaría mañana a otro
     * porque alguien editó la ficha del cliente. La encuesta pertenece a quien
     * se resolvió cuando se creó; cambiar de número es una decisión explícita.
     */
    ALTER TABLE survey_instances ADD COLUMN IF NOT EXISTS "recipientPhone" TEXT;

    /*
     * El lease del envío. Un worker reclama la fila poniendo su marca; otro que
     * la vea reclamada y reciente no la toca. Si el primero muere, la marca
     * caduca y la encuesta se recupera en vez de quedarse bloqueada para
     * siempre.
     */
    ALTER TABLE survey_instances ADD COLUMN IF NOT EXISTS "sendClaimedAtMs" BIGINT;
    ALTER TABLE survey_instances ADD COLUMN IF NOT EXISTS "sendAttempts" INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE survey_instances ADD COLUMN IF NOT EXISTS "nextAttemptAtMs" BIGINT;

    /*
     * Cuándo aceptó Twilio el envío inicial y cuándo toca el recordatorio.
     *
     * El momento del recordatorio se CONGELA aquí al aceptarse el inicial: si
     * mañana se cambia «reminderDelayHours», las encuestas ya mandadas no se
     * mueven de hora.
     */
    ALTER TABLE survey_instances ADD COLUMN IF NOT EXISTS "initialSentAtMs" BIGINT;
    ALTER TABLE survey_instances ADD COLUMN IF NOT EXISTS "reminderAfterMs" BIGINT;
    ALTER TABLE survey_instances ADD COLUMN IF NOT EXISTS "reminderSentAtMs" BIGINT;

    /*
     * Por qué está parada sin ser un fallo: falta la plantilla, falta la URL
     * pública, faltan credenciales. Se guarda UNA vez y se actualiza, en vez de
     * crear una fila de «delivery» SKIPPED cada cinco minutos hasta llenar la
     * tabla.
     */
    ALTER TABLE survey_instances ADD COLUMN IF NOT EXISTS "blockedReason" TEXT;
    ALTER TABLE survey_instances ADD COLUMN IF NOT EXISTS "blockedAtMs" BIGINT;
  `);

  await db.query(`
    /* La miniweb resuelve por hash; el envío necesita el valor. Único igual. */
    CREATE UNIQUE INDEX IF NOT EXISTS idx_survey_instances_token_claro
      ON survey_instances (token) WHERE token IS NOT NULL;

    /*
     * Por aquí entra el worker de envío: lo encolado que ya puede intentarse.
     * Parcial sobre QUEUED, que es el único estado desde el que se manda.
     */
    CREATE INDEX IF NOT EXISTS idx_survey_instances_por_enviar
      ON survey_instances ("nextAttemptAtMs", "sendClaimedAtMs")
      WHERE status = 'QUEUED';

    /* Y por aquí el del recordatorio: lo ya enviado que aún no lo ha recibido. */
    CREATE INDEX IF NOT EXISTS idx_survey_instances_recordatorio
      ON survey_instances ("reminderAfterMs")
      WHERE "reminderAfterMs" IS NOT NULL AND "reminderSentAtMs" IS NULL;
  `);
  await db.query(`
    DROP INDEX IF EXISTS idx_survey_instances_token;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_survey_instances_token
      ON survey_instances ("tokenHash") WHERE "tokenHash" IS NOT NULL;
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

    /*
     * El cuadro de mando de 1F filtra SIEMPRE por «completedAtMs» —interesa
     * cuándo contestó alguien, no cuándo se creó la encuesta— y ese rango es
     * lo primero que se evalúa en todas sus consultas. Sin este índice, cada
     * carga de la pantalla recorre la tabla entera de respuestas.
     */
    CREATE INDEX IF NOT EXISTS idx_survey_responses_periodo
      ON survey_responses ("completedAtMs");
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
    /*
     * El periodo del cuadro de mando: rango sobre «createdAtMs» SIN estado.
     * El índice de la bandeja no sirve aquí porque lleva «status» delante y
     * las métricas no lo filtran.
     */
    CREATE INDEX IF NOT EXISTS idx_quality_cases_periodo
      ON quality_cases ("tenantId", "createdAtMs");
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
      "messageType" TEXT NOT NULL,       -- INITIAL | REMINDER
      attempt INTEGER NOT NULL DEFAULT 1,

      "providerMessageId" TEXT,
      -- PENDING | SENDING | SENT | DELIVERED | READ | FAILED | SKIPPED | UNKNOWN
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

  /*
   * ── 1G ────────────────────────────────────────────────────────────────
   *
   * «messageType» pasa a ser INITIAL | REMINDER. En 1B decía INVITATION, que
   * no llegó a escribirse nunca porque no había envío: se renombra el
   * comentario y se admiten los dos por si alguna base lo tuviera.
   */
  await db.query(`
    /* Cuándo se dio por perdido el intento ambiguo, para poder reconciliar. */
    ALTER TABLE survey_deliveries ADD COLUMN IF NOT EXISTS "unknownAtMs" BIGINT;

    /*
     * El callback de Twilio entra por aquí y por nada más. Único y parcial: dos
     * entregas no pueden compartir SID, y las que aún no lo tienen no ocupan.
     */
    CREATE UNIQUE INDEX IF NOT EXISTS idx_survey_deliveries_sid
      ON survey_deliveries ("providerMessageId") WHERE "providerMessageId" IS NOT NULL;

    /*
     * ── LA barrera contra el mensaje duplicado ─────────────────────────
     *
     * Un solo mensaje de cada tipo «en vuelo o ya salido» por encuesta.
     *
     * El índice de arriba —(encuesta, tipo, intento)— NO basta, y esto costó
     * verlo: dos workers que corren a la vez pueden leer el contador de
     * intentos antes de que ninguno lo haya subido, o leerlo uno después del
     * otro. En el segundo caso calculan números distintos, las dos filas caben
     * en el índice y salen DOS WhatsApp. El número de intento sirve para
     * contar, no para excluir.
     *
     * Éste sí excluye, porque la clave es (encuesta, tipo) sin el intento, y el
     * predicado dice qué cuenta como «no se puede mandar otro»:
     *
     *  · SENDING   — hay uno hablando con Twilio ahora mismo;
     *  · SENT/DELIVERED/READ — ya salió;
     *  · UNKNOWN   — no se sabe si salió, y ante la duda no se manda otro.
     *
     * Quedan fuera FAILED y SKIPPED: de un fallo confirmado sí se puede
     * reintentar, que es justo lo que se quiere.
     */
    CREATE UNIQUE INDEX IF NOT EXISTS idx_survey_deliveries_en_vuelo
      ON survey_deliveries ("surveyInstanceId", "messageType")
      WHERE status IN ('SENDING','SENT','DELIVERED','READ','UNKNOWN');
  `);

  const { initSatisfactionConfig } = await import("./config.ts");
  await initSatisfactionConfig();

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
