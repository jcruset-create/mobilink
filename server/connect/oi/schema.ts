/**
 * Centro de Inteligencia Operacional (OI) — esquema de base de datos.
 *
 * Migraciones idempotentes (CREATE TABLE IF NOT EXISTS), mismo patrón que
 * server/connect/schema.ts. NO se duplica información operacional: todas las
 * tablas de aquí son analíticas (definiciones, resultados calculados,
 * predicciones, recomendaciones, alertas y feedback). Los datos de negocio
 * siguen viviendo en connect_assistances, connect_assignments,
 * connect_workshops, connect_mobile_units, connect_incidents, etc.
 *
 * "tenant" en el diseño funcional = centro de control de Connect Pro
 * (connect_control_centers), por lo que la columna se llama "controlCenterId"
 * para ser coherente con el resto del módulo.
 */

import db from "../../db.ts";
import { KPI_CATALOG } from "./catalog.ts";

export async function initOperationalIntelligence(): Promise<void> {
  await db.query(`
    -- Definición de KPIs disponibles (catálogo configurable por centro)
    CREATE TABLE IF NOT EXISTS operational_kpi_definition (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL,          -- operational | provider | fleet | driver | economic | quality
      formula TEXT NOT NULL DEFAULT '',-- descripción legible del cálculo
      unit TEXT NOT NULL DEFAULT '',   -- min | % | € | servicios | km
      direction TEXT NOT NULL DEFAULT 'up_good', -- up_good | down_good
      "targetValue" DOUBLE PRECISION,
      "warningThreshold" DOUBLE PRECISION,
      "criticalThreshold" DOUBLE PRECISION,
      "controlCenterId" INTEGER,       -- NULL = definición global de la red
      active BOOLEAN NOT NULL DEFAULT true,
      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_oi_kpi_def_code_global
      ON operational_kpi_definition (code) WHERE "controlCenterId" IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_oi_kpi_def_code_center
      ON operational_kpi_definition (code, "controlCenterId") WHERE "controlCenterId" IS NOT NULL;

    -- Resultados calculados (serie temporal de cada KPI)
    CREATE TABLE IF NOT EXISTS operational_kpi_value (
      id SERIAL PRIMARY KEY,
      "kpiCode" TEXT NOT NULL,
      "controlCenterId" INTEGER,
      "entityType" TEXT NOT NULL DEFAULT 'global', -- global | workshop | provider | client | service_type
      "entityId" TEXT,
      "periodStart" BIGINT NOT NULL,
      "periodEnd" BIGINT NOT NULL,
      granularity TEXT NOT NULL DEFAULT 'day',     -- hour | day | week | month
      value DOUBLE PRECISION,
      "targetValue" DOUBLE PRECISION,
      "sampleSize" INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'grey',         -- green | amber | red | grey
      "calculatedAtMs" BIGINT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_oi_kpi_value_slot
      ON operational_kpi_value ("kpiCode", "entityType", COALESCE("entityId", ''), "periodStart", granularity);
    CREATE INDEX IF NOT EXISTS idx_oi_kpi_value_time
      ON operational_kpi_value ("kpiCode", "periodStart" DESC);

    -- Predicciones (demanda, ETA, riesgo de retraso) con su resultado real
    CREATE TABLE IF NOT EXISTS ai_prediction (
      id SERIAL PRIMARY KEY,
      "controlCenterId" INTEGER,
      "predictionType" TEXT NOT NULL,   -- demand | eta | delay_risk
      "entityType" TEXT NOT NULL,       -- zone | assistance | service_type
      "entityId" TEXT,
      "predictedValue" DOUBLE PRECISION NOT NULL,
      "confidenceMin" DOUBLE PRECISION,
      "confidenceMax" DOUBLE PRECISION,
      "confidenceScore" DOUBLE PRECISION, -- 0..1
      "predictionAtMs" BIGINT NOT NULL,   -- cuándo se emitió
      "targetAtMs" BIGINT NOT NULL,       -- a qué momento se refiere
      "modelVersion" TEXT NOT NULL DEFAULT 'v1',
      "inputReference" TEXT,              -- JSON con las variables usadas (explicabilidad)
      "actualValue" DOUBLE PRECISION,     -- se rellena a posteriori (aprendizaje continuo)
      "errorValue" DOUBLE PRECISION,
      "evaluatedAtMs" BIGINT,
      "createdAtMs" BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_oi_prediction_type_target
      ON ai_prediction ("predictionType", "targetAtMs" DESC);
    CREATE INDEX IF NOT EXISTS idx_oi_prediction_entity
      ON ai_prediction ("predictionType", "entityType", "entityId", id DESC);
    CREATE INDEX IF NOT EXISTS idx_oi_prediction_pending_eval
      ON ai_prediction ("predictionType", "evaluatedAtMs") WHERE "evaluatedAtMs" IS NULL;

    -- Recomendaciones generadas por el motor (siempre explicables)
    CREATE TABLE IF NOT EXISTS ai_recommendation (
      id SERIAL PRIMARY KEY,
      "controlCenterId" INTEGER,
      "recommendationType" TEXT NOT NULL,
      "dedupKey" TEXT,                  -- evita repetir la misma recomendación viva
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'medium', -- low | medium | high | critical
      "affectedEntityType" TEXT,
      "affectedEntityId" TEXT,
      "expectedImpact" TEXT,            -- texto legible del impacto estimado
      "impactValue" DOUBLE PRECISION,   -- magnitud numérica (min, €, servicios)
      "impactUnit" TEXT,
      "proposedAction" TEXT NOT NULL DEFAULT '{}', -- JSON {type, params, link}
      explanation TEXT NOT NULL DEFAULT '{}',      -- JSON {detected, dataUsed[], factors[], confidence, alternatives[]}
      status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | rejected | expired | superseded
      "acceptedBy" TEXT,
      "acceptedAtMs" BIGINT,
      "rejectedBy" TEXT,
      "rejectedAtMs" BIGINT,
      "rejectionReason" TEXT,
      "expiresAtMs" BIGINT,
      "actualImpact" DOUBLE PRECISION,  -- impacto real medido (mejora continua)
      "createdAtMs" BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_oi_reco_status
      ON ai_recommendation (status, priority, id DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_oi_reco_dedup_open
      ON ai_recommendation ("dedupKey") WHERE status = 'pending';

    -- Alertas inteligentes del centro de inteligencia (ciclo de vida completo)
    CREATE TABLE IF NOT EXISTS operational_alert (
      id SERIAL PRIMARY KEY,
      "controlCenterId" INTEGER,
      "alertType" TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'operational', -- operational | quality | economic
      severity TEXT NOT NULL DEFAULT 'medium',      -- low | medium | high | critical
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      "entityType" TEXT,
      "entityId" TEXT,
      "dedupKey" TEXT,
      "assignedUserId" INTEGER,
      status TEXT NOT NULL DEFAULT 'open', -- open | acknowledged | resolved | expired
      "detectedAtMs" BIGINT NOT NULL,
      "dueAtMs" BIGINT,
      "acknowledgedAtMs" BIGINT,
      "acknowledgedBy" TEXT,
      "resolvedAtMs" BIGINT,
      "resolvedBy" TEXT,
      resolution TEXT,
      "escalationLevel" INTEGER NOT NULL DEFAULT 0,
      "escalatedAtMs" BIGINT,
      "notifiedChannels" TEXT NOT NULL DEFAULT '[]',
      comments TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_oi_alert_status
      ON operational_alert (status, severity, id DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_oi_alert_dedup_open
      ON operational_alert ("dedupKey") WHERE status IN ('open', 'acknowledged');

    -- Registro de modelos y su precisión (gobierno de la IA)
    CREATE TABLE IF NOT EXISTS ai_model_registry (
      id SERIAL PRIMARY KEY,
      "modelName" TEXT NOT NULL,
      "modelType" TEXT NOT NULL,      -- demand | eta | delay_risk | anomaly | assistant
      version TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', -- active | shadow | retired
      "trainingPeriodStartMs" BIGINT,
      "trainingPeriodEndMs" BIGINT,
      "accuracyMetrics" TEXT NOT NULL DEFAULT '{}', -- JSON {mae, mape, samples, ...}
      "deploymentAtMs" BIGINT,
      "lastEvaluatedAtMs" BIGINT,
      configuration TEXT NOT NULL DEFAULT '{}',
      "controlCenterId" INTEGER,
      UNIQUE ("modelType", version, "controlCenterId")
    );

    -- Feedback humano sobre predicciones y recomendaciones
    CREATE TABLE IF NOT EXISTS ai_feedback (
      id SERIAL PRIMARY KEY,
      "recommendationId" INTEGER REFERENCES ai_recommendation(id) ON DELETE CASCADE,
      "predictionId" INTEGER REFERENCES ai_prediction(id) ON DELETE CASCADE,
      "userId" INTEGER,
      "userName" TEXT,
      "feedbackType" TEXT NOT NULL DEFAULT 'decision', -- decision | quality | correction
      accepted BOOLEAN,
      comment TEXT,
      "actualResult" TEXT,
      "createdAtMs" BIGINT NOT NULL
    );

    -- Consultas al asistente conversacional (trazabilidad y RGPD)
    CREATE TABLE IF NOT EXISTS ai_assistant_query (
      id SERIAL PRIMARY KEY,
      "controlCenterId" INTEGER,
      "userId" INTEGER,
      "userName" TEXT,
      "userRole" TEXT,
      question TEXT NOT NULL,
      intent TEXT,
      answer TEXT NOT NULL DEFAULT '',
      "dataScope" TEXT NOT NULL DEFAULT '{}', -- ámbito de datos aplicado
      "durationMs" INTEGER,
      "createdAtMs" BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_oi_assistant_query_time
      ON ai_assistant_query ("createdAtMs" DESC);

    -- Programación de informes automáticos
    CREATE TABLE IF NOT EXISTS operational_report_schedule (
      id SERIAL PRIMARY KEY,
      "controlCenterId" INTEGER,
      "reportKind" TEXT NOT NULL,
      name TEXT NOT NULL,
      frequency TEXT NOT NULL DEFAULT 'daily', -- daily | weekly | monthly
      "hourUtc" INTEGER NOT NULL DEFAULT 6,
      recipients TEXT NOT NULL DEFAULT '[]',   -- JSON array de emails
      format TEXT NOT NULL DEFAULT 'csv',      -- csv | json
      filters TEXT NOT NULL DEFAULT '{}',
      active BOOLEAN NOT NULL DEFAULT true,
      "lastRunAtMs" BIGINT,
      "lastResult" TEXT,
      "nextRunAtMs" BIGINT,
      "createdByUserId" INTEGER,
      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL
    );
  `);

  await seedKpiDefinitions();
  await seedModelRegistry();
}

/** Alta idempotente del catálogo base de KPIs (definiciones globales). */
async function seedKpiDefinitions(): Promise<void> {
  const now = Date.now();
  for (const k of KPI_CATALOG) {
    await db.query(
      `INSERT INTO operational_kpi_definition
         (code, name, description, category, formula, unit, direction,
          "targetValue", "warningThreshold", "criticalThreshold", "createdAtMs", "updatedAtMs")
       SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11
        WHERE NOT EXISTS (
          SELECT 1 FROM operational_kpi_definition WHERE code = $1 AND "controlCenterId" IS NULL)`,
      [
        k.code, k.name, k.description, k.category, k.formula, k.unit, k.direction,
        k.targetValue ?? null, k.warningThreshold ?? null, k.criticalThreshold ?? null, now,
      ],
    );
  }
}

/** Registro inicial de los modelos v1 (heurísticos, explicables y auditables). */
async function seedModelRegistry(): Promise<void> {
  const now = Date.now();
  const models: Array<[string, string, string, string]> = [
    ["demand-seasonal-naive", "demand", "v1", "Media estacional por zona y franja horaria con intervalo de confianza (±1,28σ, 80 %)"],
    ["eta-historical-blend", "eta", "v1", "Distancia haversine + factor de vía y hora + histórico de llegada del taller"],
    ["delay-risk-rules", "delay_risk", "v1", "Puntuación 0..1 por tiempo restante de SLA, posición/GPS de la unidad y rendimiento histórico"],
    ["anomaly-zscore", "anomaly", "v1", "Desviación robusta frente a la media móvil de 30 días"],
    ["assistant-intent", "assistant", "v1", "Clasificación de intención sobre consultas predefinidas y seguras (sin SQL libre)"],
  ];
  for (const [name, type, version, description] of models) {
    await db.query(
      // NULL en "controlCenterId" no colisiona en un UNIQUE, así que la
      // idempotencia del modelo global se resuelve con NOT EXISTS.
      `INSERT INTO ai_model_registry
         ("modelName", "modelType", version, status, "deploymentAtMs", configuration)
       SELECT $1,$2,$3,'active',$4,$5
        WHERE NOT EXISTS (
          SELECT 1 FROM ai_model_registry
           WHERE "modelType" = $2 AND version = $3 AND "controlCenterId" IS NULL)`,
      [name, type, version, now, JSON.stringify({ description })],
    );
  }
}
