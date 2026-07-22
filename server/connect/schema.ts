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

import crypto from "node:crypto";
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

    -- ============================================================
    -- Fase 1 (Sprint 1): backoffice del centro de control
    -- ============================================================

    -- Centros de control (call centers que operan Connect Pro)
    CREATE TABLE IF NOT EXISTS connect_control_centers (
      id SERIAL PRIMARY KEY,
      uuid TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', -- active | suspended
      settings TEXT NOT NULL DEFAULT '{}',
      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL,
      "deletedAtMs" BIGINT
    );

    -- Usuarios de Connect Pro (vinculados a la sesión unificada Supabase)
    CREATE TABLE IF NOT EXISTS connect_users (
      id SERIAL PRIMARY KEY,
      "controlCenterId" INTEGER REFERENCES connect_control_centers(id),
      "supabaseUserId" TEXT,
      email TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'operator',
      -- superadmin | cc_admin | supervisor | operator | analyst | provider_user
      "providerCompanyId" INTEGER, -- solo para provider_user
      active BOOLEAN NOT NULL DEFAULT true,
      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL,
      UNIQUE (email)
    );

    -- Empresas proveedoras de asistencia (clientes del ecosistema Mobilink Assist)
    CREATE TABLE IF NOT EXISTS connect_provider_companies (
      id SERIAL PRIMARY KEY,
      uuid TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      "licenseUuid" TEXT,                 -- vínculo con el módulo de licencias
      "coreInstance" TEXT NOT NULL DEFAULT 'local', -- local | external
      "contactEmail" TEXT,
      "contactPhone" TEXT,
      status TEXT NOT NULL DEFAULT 'active', -- active | suspended
      notes TEXT,
      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL,
      "deletedAtMs" BIGINT
    );

    -- Delegaciones / bases operativas de una empresa proveedora
    CREATE TABLE IF NOT EXISTS connect_branches (
      id SERIAL PRIMARY KEY,
      "providerCompanyId" INTEGER NOT NULL REFERENCES connect_provider_companies(id),
      name TEXT NOT NULL,
      address TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      phone TEXT,
      schedule TEXT NOT NULL DEFAULT '{}',
      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL,
      "deletedAtMs" BIGINT
    );

    -- Autorización centro de control ↔ empresa proveedora (relación M:N con condiciones)
    CREATE TABLE IF NOT EXISTS connect_provider_authorizations (
      id SERIAL PRIMARY KEY,
      "controlCenterId" INTEGER NOT NULL REFERENCES connect_control_centers(id),
      "providerCompanyId" INTEGER NOT NULL REFERENCES connect_provider_companies(id),
      "branchId" INTEGER REFERENCES connect_branches(id),
      status TEXT NOT NULL DEFAULT 'active', -- active | suspended
      "serviceTypes" TEXT NOT NULL DEFAULT '[]', -- [] = todos
      preferred BOOLEAN NOT NULL DEFAULT false,
      excluded BOOLEAN NOT NULL DEFAULT false,
      "slaAcceptMin" INTEGER,
      "slaArrivalMin" INTEGER,
      "maxConcurrent" INTEGER,
      "validFromMs" BIGINT,
      "validToMs" BIGINT,
      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL,
      UNIQUE ("controlCenterId", "providerCompanyId", "branchId")
    );

    -- Catálogo configurable de tipos de asistencia
    CREATE TABLE IF NOT EXISTS connect_service_types (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      "parentId" INTEGER REFERENCES connect_service_types(id),
      active BOOLEAN NOT NULL DEFAULT true,
      "sortOrder" INTEGER NOT NULL DEFAULT 0
    );

    -- Motivos de rechazo configurables
    CREATE TABLE IF NOT EXISTS connect_rejection_reasons (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      "affectsScoreDefault" BOOLEAN NOT NULL DEFAULT true,
      active BOOLEAN NOT NULL DEFAULT true,
      "sortOrder" INTEGER NOT NULL DEFAULT 0
    );

    -- Auditoría de Connect Pro (append-only)
    CREATE TABLE IF NOT EXISTS connect_audit_logs (
      id SERIAL PRIMARY KEY,
      "controlCenterId" INTEGER,
      "actorType" TEXT NOT NULL, -- user | api | system
      "actorId" TEXT,
      "actorName" TEXT,
      action TEXT NOT NULL,
      "resourceType" TEXT,
      "resourceId" TEXT,
      detail TEXT,
      ip TEXT,
      "createdAtMs" BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_connect_audit_center_time
      ON connect_audit_logs ("controlCenterId", "createdAtMs" DESC);

    -- Sprint 3: histórico de asignaciones (ofertas) y rechazos
    CREATE TABLE IF NOT EXISTS connect_assignments (
      id SERIAL PRIMARY KEY,
      "assistanceId" INTEGER NOT NULL REFERENCES connect_assistances(id) ON DELETE CASCADE,
      "workshopId" INTEGER NOT NULL REFERENCES connect_workshops(id),
      "providerCompanyId" INTEGER,
      rank INTEGER,
      score DOUBLE PRECISION,
      "scoreBreakdown" TEXT,
      explanation TEXT,
      mode TEXT NOT NULL DEFAULT 'direct', -- direct (inyección inmediata) | offer (requiere aceptación)
      status TEXT NOT NULL DEFAULT 'sent', -- sent | accepted | rejected | expired | withdrawn
      "sentAtMs" BIGINT NOT NULL,
      "respondedAtMs" BIGINT,
      "respondedBy" TEXT,                 -- nombre/actor que respondió
      "acceptDeadlineMs" BIGINT,          -- vencimiento de la oferta
      "createdByUserId" INTEGER,
      "createdAtMs" BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_connect_assignments_assistance
      ON connect_assignments ("assistanceId", status);
    CREATE INDEX IF NOT EXISTS idx_connect_assignments_pending
      ON connect_assignments (status, "acceptDeadlineMs");

    CREATE TABLE IF NOT EXISTS connect_rejections (
      id SERIAL PRIMARY KEY,
      "assignmentId" INTEGER NOT NULL REFERENCES connect_assignments(id) ON DELETE CASCADE,
      "assistanceId" INTEGER NOT NULL,
      "workshopId" INTEGER NOT NULL,
      "providerCompanyId" INTEGER,
      "reasonCode" TEXT NOT NULL,
      comment TEXT,
      "responseMs" BIGINT,                -- tiempo empleado en responder
      "affectsScore" BOOLEAN NOT NULL DEFAULT true,
      "rejectedBy" TEXT,
      "createdAtMs" BIGINT NOT NULL
    );

    -- Sprint 5: incidencias y comunicaciones
    CREATE TABLE IF NOT EXISTS connect_incidents (
      id SERIAL PRIMARY KEY,
      "controlCenterId" INTEGER,
      "assistanceId" INTEGER REFERENCES connect_assistances(id) ON DELETE SET NULL,
      "providerCompanyId" INTEGER REFERENCES connect_provider_companies(id),
      "workshopId" INTEGER,
      type TEXT NOT NULL,
      -- delay | no_response | rejection | wrong_data | customer_not_found | tech_not_found
      -- | unit_breakdown | access_problem | not_feasible | incomplete_service | incomplete_docs
      -- | insufficient_photos | complaint | damages | tariff_conflict | duplicate
      -- | integration_error | other
      severity TEXT NOT NULL DEFAULT 'medium', -- low | medium | high | critical
      status TEXT NOT NULL DEFAULT 'open',
      -- open | investigating | pending_provider | pending_client | escalated | resolved | closed
      "ownerUserId" INTEGER,
      description TEXT NOT NULL,
      resolution TEXT,
      "dueAtMs" BIGINT,
      "slaImpact" BOOLEAN NOT NULL DEFAULT false,
      "scoreImpact" BOOLEAN NOT NULL DEFAULT false,
      "createdByUserId" INTEGER,
      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL,
      "resolvedAtMs" BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_connect_incidents_status
      ON connect_incidents (status, severity, "dueAtMs");

    CREATE TABLE IF NOT EXISTS connect_incident_events (
      id SERIAL PRIMARY KEY,
      "incidentId" INTEGER NOT NULL REFERENCES connect_incidents(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      note TEXT,
      "byUserId" INTEGER,
      "byName" TEXT,
      "createdAtMs" BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS connect_communications (
      id SERIAL PRIMARY KEY,
      "assistanceId" INTEGER NOT NULL REFERENCES connect_assistances(id) ON DELETE CASCADE,
      channel TEXT NOT NULL DEFAULT 'note', -- note | call | whatsapp | email
      direction TEXT NOT NULL DEFAULT 'internal', -- internal | outbound | inbound
      "toRef" TEXT,                        -- teléfono/email/destinatario si aplica
      body TEXT NOT NULL,
      "byUserId" INTEGER,
      "byName" TEXT,
      "createdAtMs" BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_connect_communications_assistance
      ON connect_communications ("assistanceId", id DESC);

    -- Sprint 6: histórico del score del taller/proveedor
    CREATE TABLE IF NOT EXISTS connect_workshop_scores (
      id SERIAL PRIMARY KEY,
      "workshopId" INTEGER NOT NULL REFERENCES connect_workshops(id) ON DELETE CASCADE,
      "computedAtMs" BIGINT NOT NULL,
      score DOUBLE PRECISION NOT NULL,
      tier TEXT NOT NULL,
      components TEXT NOT NULL,          -- desglose JSON de cada factor
      confidence DOUBLE PRECISION NOT NULL, -- 0..1 según muestra
      "sampleSize" INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_connect_workshop_scores_ws
      ON connect_workshop_scores ("workshopId", id DESC);

    -- Fase 2: alertas internas del centro de control
    CREATE TABLE IF NOT EXISTS connect_alerts (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      -- assignment_failed | no_coverage | offer_expired | sla_risk | sla_breached
      -- | incident_critical | webhook_dead | provider_rejections | other
      severity TEXT NOT NULL DEFAULT 'warning', -- info | warning | critical
      title TEXT NOT NULL,
      body TEXT,
      "assistanceId" INTEGER,
      "workshopId" INTEGER,
      "incidentId" INTEGER,
      status TEXT NOT NULL DEFAULT 'unread', -- unread | read
      "createdAtMs" BIGINT NOT NULL,
      "readAtMs" BIGINT,
      "readByUserId" INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_connect_alerts_status
      ON connect_alerts (status, id DESC);

    -- Fase 3 (solo DDL, sin lógica): unidades móviles
    CREATE TABLE IF NOT EXISTS connect_mobile_units (
      id SERIAL PRIMARY KEY,
      "providerCompanyId" INTEGER NOT NULL REFERENCES connect_provider_companies(id),
      "branchId" INTEGER REFERENCES connect_branches(id),
      name TEXT NOT NULL,
      plate TEXT,
      capabilities TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'unknown',
      "statusReason" TEXT,
      "technicianRef" TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      "batteryPct" INTEGER,
      "connectionStatus" TEXT,
      "activeAssistanceId" INTEGER,
      "etaAvailableMin" INTEGER,
      "lastReportAtMs" BIGINT,
      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS connect_mobile_unit_events (
      id SERIAL PRIMARY KEY,
      "unitId" INTEGER NOT NULL REFERENCES connect_mobile_units(id) ON DELETE CASCADE,
      "fromStatus" TEXT,
      "toStatus" TEXT NOT NULL,
      reason TEXT,
      payload TEXT,
      "createdAtMs" BIGINT NOT NULL
    );
  `);

  // Ampliaciones idempotentes de tablas v0
  await db.query(`
    ALTER TABLE connect_workshops ADD COLUMN IF NOT EXISTS "providerCompanyId" INTEGER;
    ALTER TABLE connect_workshops ADD COLUMN IF NOT EXISTS "branchId" INTEGER;
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "controlCenterId" INTEGER;
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'api';
    -- manual | api | partner | import | reopen | derived | core

    -- Sprint 2: creación manual con borradores y ficha completa
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "expedientNumber" TEXT;
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "clientName" TEXT;
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS requester TEXT NOT NULL DEFAULT '{}';
    -- {name, phone, email, language, notes} — puede diferir del cliente final
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "locationDetails" TEXT NOT NULL DEFAULT '{}';
    -- {road, km, direction, placeRef, serviceArea, confirmed}
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "slaMinutes" INTEGER;
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "slaDeadlineAtMs" BIGINT;
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "createdByUserId" INTEGER;

    -- Sprint 3: la autorización decide si las asistencias requieren aceptación explícita
    ALTER TABLE connect_provider_authorizations ADD COLUMN IF NOT EXISTS "requiresAcceptance" BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE connect_provider_authorizations ADD COLUMN IF NOT EXISTS "acceptTimeoutMin" INTEGER NOT NULL DEFAULT 10;

    -- Sprint 6: avisos de SLA (webhooks sla_risk / sla_breached una sola vez)
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "slaRiskNotifiedAtMs" BIGINT;
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "slaBreachNotifiedAtMs" BIGINT;
  `);

  await seedConnectDefaults();
}

/**
 * Seed idempotente: centro de control por defecto, SEA como empresa proveedora
 * (enlazando los talleres v0 existentes), autorización M:N y catálogos base.
 */
async function seedConnectDefaults(): Promise<void> {
  const now = Date.now();

  const cc = await db.query(`SELECT id FROM connect_control_centers LIMIT 1`);
  let ccId: number;
  if (cc.rows[0]) {
    ccId = cc.rows[0].id;
  } else {
    const r = await db.query(
      `INSERT INTO connect_control_centers (uuid, name, "createdAtMs", "updatedAtMs")
       VALUES ($1, 'Centro de Control SEA', $2, $2) RETURNING id`,
      [crypto.randomUUID(), now],
    );
    ccId = r.rows[0].id;
  }

  const pc = await db.query(`SELECT id FROM connect_provider_companies LIMIT 1`);
  let pcId: number;
  if (pc.rows[0]) {
    pcId = pc.rows[0].id;
  } else {
    const r = await db.query(
      `INSERT INTO connect_provider_companies (uuid, name, "coreInstance", "createdAtMs", "updatedAtMs")
       VALUES ($1, 'SEA Tarragona', 'local', $2, $2) RETURNING id`,
      [crypto.randomUUID(), now],
    );
    pcId = r.rows[0].id;
  }

  await db.query(
    `UPDATE connect_workshops SET "providerCompanyId" = $1 WHERE "providerCompanyId" IS NULL`,
    [pcId],
  );

  await db.query(
    `INSERT INTO connect_provider_authorizations
       ("controlCenterId", "providerCompanyId", "createdAtMs", "updatedAtMs")
     SELECT $1, $2, $3, $3
      WHERE NOT EXISTS (
        SELECT 1 FROM connect_provider_authorizations
         WHERE "controlCenterId" = $1 AND "providerCompanyId" = $2 AND "branchId" IS NULL)`,
    [ccId, pcId, now],
  );

  const serviceTypes: Array<[string, string]> = [
    ["tow_truck", "Grúa / remolque"], ["mechanical", "Mecánica en carretera"],
    ["tyres", "Neumáticos"], ["battery", "Batería / arranque"],
    ["fuel", "Combustible"], ["lockout", "Apertura de vehículo"],
    ["electric_vehicle", "Vehículo eléctrico"], ["heavy_vehicle", "Vehículo industrial"],
    ["machinery", "Maquinaria"], ["other", "Otros"],
  ];
  for (let i = 0; i < serviceTypes.length; i++) {
    await db.query(
      `INSERT INTO connect_service_types (code, name, "sortOrder")
       VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING`,
      [serviceTypes[i][0], serviceTypes[i][1], i],
    );
  }

  const reasons: Array<[string, string, boolean]> = [
    ["no_capacity", "Sin disponibilidad", true],
    ["out_of_zone", "Fuera de cobertura", false],
    ["service_unsupported", "Tipo de asistencia no soportado", false],
    ["unit_unsuitable", "Unidad no adecuada", false],
    ["no_technician", "Sin técnico disponible", true],
    ["eta_too_long", "Tiempo de llegada excesivo", false],
    ["schedule", "Fuera de horario", false],
    ["insufficient_data", "Datos insuficientes", false],
    ["operational_risk", "Riesgo operativo", false],
    ["price_rejected", "Precio no aceptado", false],
    ["commercial_conflict", "Conflicto comercial", false],
    ["breakdown", "Avería propia", true],
    ["other", "Otro motivo", true],
  ];
  for (let i = 0; i < reasons.length; i++) {
    await db.query(
      `INSERT INTO connect_rejection_reasons (code, label, "affectsScoreDefault", "sortOrder")
       VALUES ($1, $2, $3, $4) ON CONFLICT (code) DO NOTHING`,
      [reasons[i][0], reasons[i][1], reasons[i][2], i],
    );
  }
}
