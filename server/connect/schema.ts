/**
 * Mobilink Assist Connect Pro — esquema de base de datos.
 *
 * Migraciones idempotentes (CREATE TABLE IF NOT EXISTS), sin alterar datos
 * existentes, siguiendo el mismo patrón que initDb(), Integration Hub y Licencias.
 *
 * Diseño según Mobilink_Connect_Pro_Docs cap. 4, adaptado al monolito:
 * misma base de datos que el core, por lo que la "inyección" en el core es un
 * INSERT en roadside_assistances y la sincronización un polling ligero.
 */

import db from "../db.ts";

export async function initConnect(): Promise<void> {
  await db.query(`
    -- Empresas cliente (partners externos: aseguradoras, renting, grúas...)
    CREATE TABLE IF NOT EXISTS connect_partners (
      id SERIAL PRIMARY KEY,
      uuid TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      "legalName" TEXT,
      "taxId" TEXT,
      "contactEmail" TEXT,
      "contactPhone" TEXT,
      locale TEXT NOT NULL DEFAULT 'es',
      status TEXT NOT NULL DEFAULT 'active', -- active | suspended
      "assignmentMode" TEXT NOT NULL DEFAULT 'auto', -- auto | manual
      settings TEXT NOT NULL DEFAULT '{}',
      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL
    );

    -- API keys de partners (hash SHA-256, nunca la clave en claro)
    CREATE TABLE IF NOT EXISTS connect_api_keys (
      id SERIAL PRIMARY KEY,
      "partnerId" INTEGER NOT NULL REFERENCES connect_partners(id),
      name TEXT NOT NULL DEFAULT '',
      "keyPrefix" TEXT NOT NULL,          -- p.ej. mkc_live_ab12 (visible)
      "keyHash" TEXT NOT NULL UNIQUE,     -- sha256 de la clave completa
      scopes TEXT NOT NULL DEFAULT '["assistances:read","assistances:write","workshops:read","webhooks:manage"]',
      environment TEXT NOT NULL DEFAULT 'live', -- live | test
      "lastUsedAtMs" BIGINT,
      "revokedAtMs" BIGINT,
      "createdAtMs" BIGINT NOT NULL
    );

    -- Perfil Connect de los talleres de la red (SEA Tarragona es el primero)
    CREATE TABLE IF NOT EXISTS connect_workshops (
      id SERIAL PRIMARY KEY,
      "coreWorkshopId" TEXT,              -- workshopId del core (roadside_assistances)
      name TEXT NOT NULL,
      phone TEXT,
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      "radiusKm" DOUBLE PRECISION NOT NULL DEFAULT 60,
      services TEXT NOT NULL DEFAULT '["tow_truck","mechanical","tyres","battery","fuel","lockout","other"]',
      "connectStatus" TEXT NOT NULL DEFAULT 'active', -- active | observation | blocked
      "currentScore" DOUBLE PRECISION NOT NULL DEFAULT 75,
      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL
    );

    -- Asistencias Connect (capa partner; enlaza con la asistencia nativa del core)
    CREATE TABLE IF NOT EXISTS connect_assistances (
      id SERIAL PRIMARY KEY,
      uuid TEXT NOT NULL UNIQUE,
      "partnerId" INTEGER NOT NULL REFERENCES connect_partners(id),
      "externalReference" TEXT,
      "idempotencyKey" TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      -- pending | searching | assigned | technician_assigned | en_route | arrived
      -- | in_progress | finished | cancelled | no_coverage | assignment_failed
      priority TEXT NOT NULL DEFAULT 'normal', -- normal | urgente
      "serviceType" TEXT NOT NULL DEFAULT 'other',
      description TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      address TEXT NOT NULL DEFAULT '',
      "customerName" TEXT NOT NULL DEFAULT '',
      "customerPhone" TEXT NOT NULL DEFAULT '',
      vehicle TEXT NOT NULL DEFAULT '{}',       -- {make,model,plate,vin,type}
      "externalMetadata" TEXT NOT NULL DEFAULT '{}', -- datos internos del partner, NO se inyectan al core
      "workshopId" INTEGER REFERENCES connect_workshops(id),
      "coreAssistanceId" INTEGER,               -- roadside_assistances.id tras inyección
      "assignmentExplanation" TEXT,
      "cancelReason" TEXT,
      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL,
      UNIQUE ("partnerId", "idempotencyKey")
    );

    CREATE INDEX IF NOT EXISTS idx_connect_assistances_partner_status
      ON connect_assistances ("partnerId", status);
    CREATE INDEX IF NOT EXISTS idx_connect_assistances_core
      ON connect_assistances ("coreAssistanceId");

    -- Historial de estados (append-only; base de tiempos y auditoría)
    CREATE TABLE IF NOT EXISTS connect_status_history (
      id SERIAL PRIMARY KEY,
      "assistanceId" INTEGER NOT NULL REFERENCES connect_assistances(id) ON DELETE CASCADE,
      "fromStatus" TEXT,
      "toStatus" TEXT NOT NULL,
      "actorType" TEXT NOT NULL DEFAULT 'system', -- system | api | core | user
      reason TEXT,
      "occurredAtMs" BIGINT NOT NULL
    );

    -- Endpoints de webhooks del partner
    CREATE TABLE IF NOT EXISTS connect_webhook_endpoints (
      id SERIAL PRIMARY KEY,
      "partnerId" INTEGER NOT NULL REFERENCES connect_partners(id),
      url TEXT NOT NULL,
      secret TEXT NOT NULL,               -- para firma HMAC-SHA256
      "eventTypes" TEXT NOT NULL DEFAULT '["*"]',
      status TEXT NOT NULL DEFAULT 'active', -- active | disabled
      "createdAtMs" BIGINT NOT NULL
    );

    -- Cola de entregas de webhooks con reintentos
    CREATE TABLE IF NOT EXISTS connect_webhook_deliveries (
      id SERIAL PRIMARY KEY,
      "endpointId" INTEGER NOT NULL REFERENCES connect_webhook_endpoints(id) ON DELETE CASCADE,
      "eventType" TEXT NOT NULL,
      payload TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending', -- pending | delivered | dead
      "responseCode" INTEGER,
      "lastError" TEXT,
      "nextRetryAtMs" BIGINT NOT NULL,
      "deliveredAtMs" BIGINT,
      "createdAtMs" BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_connect_webhook_deliveries_pending
      ON connect_webhook_deliveries (status, "nextRetryAtMs");
  `);
}
