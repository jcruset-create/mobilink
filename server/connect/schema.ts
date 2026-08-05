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
import { seedNetworkWorkshops } from "./seedWorkshops.ts";

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

    -- Catálogo configurable de tipos de vehículo/activo
    CREATE TABLE IF NOT EXISTS connect_vehicle_types (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
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

    -- Fase 2 S2: clientes del centro de control y tarifas por autorización
    CREATE TABLE IF NOT EXISTS connect_clients (
      id SERIAL PRIMARY KEY,
      "controlCenterId" INTEGER REFERENCES connect_control_centers(id),
      name TEXT NOT NULL,
      "taxId" TEXT,
      "contactEmail" TEXT,
      "contactPhone" TEXT,
      "defaultSlaMinutes" INTEGER,
      "defaultPriority" TEXT NOT NULL DEFAULT 'normal',
      notes TEXT,
      active BOOLEAN NOT NULL DEFAULT true,
      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL
    );

    -- Tarifario por relación comercial (autorización) y tipo de servicio
    CREATE TABLE IF NOT EXISTS connect_tariff_lines (
      id SERIAL PRIMARY KEY,
      "authorizationId" INTEGER NOT NULL REFERENCES connect_provider_authorizations(id) ON DELETE CASCADE,
      "serviceTypeCode" TEXT NOT NULL,
      "baseAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "perKmAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'EUR',
      active BOOLEAN NOT NULL DEFAULT true,
      "updatedAtMs" BIGINT NOT NULL,
      UNIQUE ("authorizationId", "serviceTypeCode")
    );

    -- Centro de Inteligencia Operacional: definiciones y valores de KPI
    CREATE TABLE IF NOT EXISTS connect_kpi_definitions (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'operational',
      unit TEXT NOT NULL DEFAULT '',
      direction TEXT NOT NULL DEFAULT 'lower_better', -- lower_better | higher_better
      "targetValue" DOUBLE PRECISION,
      "warningThreshold" DOUBLE PRECISION,
      "criticalThreshold" DOUBLE PRECISION,
      active BOOLEAN NOT NULL DEFAULT true,
      "sortOrder" INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS connect_kpi_values (
      id SERIAL PRIMARY KEY,
      "kpiCode" TEXT NOT NULL,
      "periodDate" TEXT NOT NULL,          -- YYYY-MM-DD del día cerrado
      value DOUBLE PRECISION,
      "sampleSize" INTEGER,
      "calculatedAtMs" BIGINT NOT NULL,
      UNIQUE ("kpiCode", "periodDate")
    );

    -- Predicciones (demanda por hora; extensible a otros tipos)
    CREATE TABLE IF NOT EXISTS connect_predictions (
      id SERIAL PRIMARY KEY,
      "predictionType" TEXT NOT NULL,      -- demand_hourly
      "targetKey" TEXT NOT NULL,           -- p.ej. 2026-07-26T18 (hora local)
      "predictedValue" DOUBLE PRECISION NOT NULL,
      "confidenceMin" DOUBLE PRECISION,
      "confidenceMax" DOUBLE PRECISION,
      "sampleSize" INTEGER,
      "modelVersion" TEXT NOT NULL DEFAULT 'v1-hourly-profile',
      "actualValue" DOUBLE PRECISION,
      "errorValue" DOUBLE PRECISION,
      "createdAtMs" BIGINT NOT NULL,
      UNIQUE ("predictionType", "targetKey")
    );

    -- Recomendaciones de IA (accionables, explicables, con feedback)
    CREATE TABLE IF NOT EXISTS connect_recommendations (
      id SERIAL PRIMARY KEY,
      "recommendationType" TEXT NOT NULL,
      -- demand_peak | sla_risk_bulk | provider_degradation | coverage_gap
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'medium', -- low | medium | high
      explanation TEXT,                    -- datos y factores utilizados
      "proposedAction" TEXT,
      "expectedImpact" TEXT,
      "entityType" TEXT,
      "entityId" TEXT,
      status TEXT NOT NULL DEFAULT 'open', -- open | accepted | rejected | expired
      "resolvedByUserId" INTEGER,
      "resolvedByName" TEXT,
      "resolvedAtMs" BIGINT,
      "rejectionReason" TEXT,
      "expiresAtMs" BIGINT,
      "createdAtMs" BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_connect_recommendations_status
      ON connect_recommendations (status, id DESC);

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

    -- ============================================================
    -- Jerarquía Empresa → Taller → Unidades y Operarios
    -- ============================================================

    -- Ficha completa de la empresa (datos fiscales y de facturación)
    ALTER TABLE connect_provider_companies ADD COLUMN IF NOT EXISTS "legalName" TEXT;
    ALTER TABLE connect_provider_companies ADD COLUMN IF NOT EXISTS "taxId" TEXT;
    ALTER TABLE connect_provider_companies ADD COLUMN IF NOT EXISTS address TEXT;
    ALTER TABLE connect_provider_companies ADD COLUMN IF NOT EXISTS city TEXT;
    ALTER TABLE connect_provider_companies ADD COLUMN IF NOT EXISTS "postalCode" TEXT;
    ALTER TABLE connect_provider_companies ADD COLUMN IF NOT EXISTS province TEXT;
    ALTER TABLE connect_provider_companies ADD COLUMN IF NOT EXISTS web TEXT;
    ALTER TABLE connect_provider_companies ADD COLUMN IF NOT EXISTS "billingEmail" TEXT;

    -- Las unidades cuelgan del taller, no solo de la empresa
    ALTER TABLE connect_mobile_units ADD COLUMN IF NOT EXISTS "workshopId" INTEGER;

    -- Trazabilidad del servicio: quién lo hizo y con qué. Se copian aquí (no
    -- se dejan solo en el core) para que el historial y el informe sigan
    -- diciendo la verdad aunque después cambie el vehículo o el técnico.
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "assignedTechName" TEXT;
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "assignedVehicleName" TEXT;
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "assignedVehiclePlate" TEXT;
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "reportUrl" TEXT;
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "reportAtMs" BIGINT;

    -- Contactos manuales del taller (imprescindible en talleres EXTERNAL,
    -- útil en todos: encargado, centralita, guardia…)
    CREATE TABLE IF NOT EXISTS connect_workshop_contacts (
      id SERIAL PRIMARY KEY,
      "workshopId" INTEGER NOT NULL REFERENCES connect_workshops(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      phone TEXT,
      role TEXT,
      notes TEXT,
      active BOOLEAN NOT NULL DEFAULT true,
      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_connect_ws_contacts ON connect_workshop_contacts ("workshopId");

    -- Back office de la asistencia (mismos bloques que el de Mobilink Assist).
    -- Solo se usa para asistencias SIN fila en el core: las que sí la tienen
    -- comparten roadside_backoffice con Assist, para no tener dos verdades.
    CREATE TABLE IF NOT EXISTS connect_assistance_backoffice (
      id SERIAL PRIMARY KEY,
      "assistanceId" INTEGER NOT NULL UNIQUE REFERENCES connect_assistances(id) ON DELETE CASCADE,

      -- Contactos
      "solicitanteNombre" TEXT, "solicitanteTelefono" TEXT, "solicitanteWhatsapp" TEXT,
      "solicitanteEmail" TEXT, "conductorTelefono" TEXT,
      "responsableNombre" TEXT, "responsableTelefono" TEXT, "responsableCargo" TEXT,
      "autorizadorNombre" TEXT, "autorizadorTelefono" TEXT, "autorizadorCargo" TEXT,

      -- Empresas
      "empresaSolicitanteNombre" TEXT, "empresaSolicitanteTelefono" TEXT, "empresaSolicitanteEmail" TEXT,
      "empresaServicioNombre" TEXT, "empresaServicioCif" TEXT, "empresaServicioTelefono" TEXT,
      "empresaFacturacionNombre" TEXT, "empresaFacturacionCif" TEXT, "empresaFacturacionEmail" TEXT,
      "expedienteExterno" TEXT, "referenciaCliente" TEXT, "referenciaAutorizacion" TEXT,

      -- Operativa
      "tiposAsistencia" TEXT, "tipoVehiculo" TEXT, "estadoVehiculo" TEXT, "ubicacionIncidencia" TEXT,

      -- Vehículo
      marca TEXT, modelo TEXT, color TEXT, vin TEXT, kilometraje INTEGER,
      "medidaNeumatico" TEXT, "ejeAfectado" TEXT, "posicionRueda" TEXT,
      "vehiculoCargado" BOOLEAN, mercancia TEXT, adr BOOLEAN,

      -- Facturación
      facturable BOOLEAN DEFAULT true, "pendienteAutorizacion" BOOLEAN DEFAULT false,
      garantia BOOLEAN DEFAULT false, interna BOOLEAN DEFAULT false,
      "importeAcordado" NUMERIC(10,2), "observacionesFacturacion" TEXT,

      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL
    );

    -- Contadores correlativos (nº de expediente por año, etc.)
    CREATE TABLE IF NOT EXISTS connect_counters (
      scope TEXT PRIMARY KEY,
      value INTEGER NOT NULL DEFAULT 0
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
    -- Las asistencias creadas desde el centro de control no tienen partner
    -- (el partner es el cliente B2B que las crea por API). Todo el código ya
    -- lo trataba como opcional; era el esquema el que iba por detrás.
    ALTER TABLE connect_assistances ALTER COLUMN "partnerId" DROP NOT NULL;
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

    -- Integración Assist ↔ Central Pro: adhesión a la red, tipo de taller y unidades compartidas
    ALTER TABLE connect_workshops ADD COLUMN IF NOT EXISTS "networkParticipation" BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE connect_workshops ADD COLUMN IF NOT EXISTS "networkChangedBy" TEXT;
    ALTER TABLE connect_workshops ADD COLUMN IF NOT EXISTS "networkChangedAtMs" BIGINT;
    ALTER TABLE connect_workshops ADD COLUMN IF NOT EXISTS "integrationType" TEXT NOT NULL DEFAULT 'assist';
    -- assist (integrado: la asistencia se inyecta en Mobilink Assist)
    -- external (taller sin Assist: gestión y estados manuales desde Central)
    ALTER TABLE connect_mobile_units ADD COLUMN IF NOT EXISTS "sharedWithCentral" BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE connect_mobile_units ADD COLUMN IF NOT EXISTS "sharedChangedBy" TEXT;
    ALTER TABLE connect_mobile_units ADD COLUMN IF NOT EXISTS "sharedChangedAtMs" BIGINT;

    -- Sprint 6: avisos de SLA (webhooks sla_risk / sla_breached una sola vez)
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "slaRiskNotifiedAtMs" BIGINT;
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "slaBreachNotifiedAtMs" BIGINT;

    -- Fase 2 S2: cliente y costes de la asistencia
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "clientId" INTEGER;
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "estimatedCost" DOUBLE PRECISION;
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "finalCost" DOUBLE PRECISION;
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "costCurrency" TEXT NOT NULL DEFAULT 'EUR';
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "costDetail" TEXT;

    -- Fase 2 S3: marca de facturación (cierre contable de la línea)
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "invoicedAtMs" BIGINT;

    -- Fase 3: unidades móviles — vínculo con el core y estado manual del operador
    ALTER TABLE connect_mobile_units ADD COLUMN IF NOT EXISTS "coreVehicleId" INTEGER;
    ALTER TABLE connect_mobile_units ADD COLUMN IF NOT EXISTS "webfleetVehicleId" TEXT;
    ALTER TABLE connect_mobile_units ADD COLUMN IF NOT EXISTS "manualStatus" TEXT;
    ALTER TABLE connect_mobile_units ADD COLUMN IF NOT EXISTS "manualReason" TEXT;
    ALTER TABLE connect_mobile_units ADD COLUMN IF NOT EXISTS "manualByName" TEXT;
    ALTER TABLE connect_mobile_units ADD COLUMN IF NOT EXISTS "speedKmh" DOUBLE PRECISION;
    ALTER TABLE connect_mobile_units ADD COLUMN IF NOT EXISTS "positionText" TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_connect_mobile_units_core
      ON connect_mobile_units ("coreVehicleId") WHERE "coreVehicleId" IS NOT NULL;

    -- ============================================================
    -- Mobilink Assist Lite — talleres colaboradores sin Assist completo
    -- ============================================================

    -- integrationType pasa a tener tres valores (producto contratado):
    --   assist   → FULL     (Mobilink Assist completo, inyección al core)
    --   lite     → LITE     (APK Mobilink Assist Lite contra Central Pro)
    --   external → EXTERNAL (sin digitalizar, estados manuales)
    ALTER TABLE connect_workshops ADD COLUMN IF NOT EXISTS features TEXT NOT NULL DEFAULT '{}';
    -- Código corto que el taller teclea en la APK (además de su id)
    ALTER TABLE connect_workshops ADD COLUMN IF NOT EXISTS "liteCode" TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_connect_workshops_lite_code
      ON connect_workshops ("liteCode") WHERE "liteCode" IS NOT NULL;
    ALTER TABLE connect_workshops ADD COLUMN IF NOT EXISTS "liteSettings" TEXT NOT NULL DEFAULT '{}';
    -- {arrivalRadiusUrbanM, arrivalRadiusRuralM, workshopRadiusM, trackWhileWorking, finishRules:{...}}

    -- Ficha postal del taller. Hasta ahora solo se guardaban las coordenadas,
    -- pero la central necesita la dirección escrita para llamar, facturar y
    -- decirle al cliente dónde va (los talleres de red no son SEA Tarragona).
    ALTER TABLE connect_workshops ADD COLUMN IF NOT EXISTS address TEXT;
    ALTER TABLE connect_workshops ADD COLUMN IF NOT EXISTS "postalCode" TEXT;
    ALTER TABLE connect_workshops ADD COLUMN IF NOT EXISTS city TEXT;
    ALTER TABLE connect_workshops ADD COLUMN IF NOT EXISTS province TEXT;
    ALTER TABLE connect_workshops ADD COLUMN IF NOT EXISTS email TEXT;
    -- Red comercial o franquicia a la que pertenece (Confortauto, Euromaster…).
    -- No confundir con "networkParticipation", que es la adhesión a la red Mobilink.
    ALTER TABLE connect_workshops ADD COLUMN IF NOT EXISTS "commercialNetwork" TEXT;
    -- Horario de apertura tal cual lo declara el taller, en texto libre
    -- ("L-V 08:30-13:30|15:00-18:30; Sáb 09:00-13:00").
    ALTER TABLE connect_workshops ADD COLUMN IF NOT EXISTS "openingHours" TEXT;
    -- Observaciones internas del taller. Recoge además lo que la importación
    -- por WhatsApp lee de Google y Central no guarda en columna propia
    -- (valoración, reseñas, web, URL de Maps, categorías…).
    ALTER TABLE connect_workshops ADD COLUMN IF NOT EXISTS notes TEXT;

    -- Resultado y datos de cierre reportados por el taller (Lite o externo)
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "resultCode" TEXT;
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "resolutionNotes" TEXT;
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "odometerKm" INTEGER;
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "workedMinutes" INTEGER;
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "acceptedAtMs" BIGINT;
    -- Operario Lite responsable y última posición conocida de su dispositivo
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "liteUserId" INTEGER;
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "liteUserName" TEXT;
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "operatorLat" DOUBLE PRECISION;
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "operatorLng" DOUBLE PRECISION;
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "operatorAccuracyM" DOUBLE PRECISION;
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "operatorSpeedKmh" DOUBLE PRECISION;
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "operatorLocationAtMs" BIGINT;

    -- Usuarios operativos del taller Lite (no son usuarios de Central Pro:
    -- son el equivalente a techs del core, con PIN y sesión de dispositivo)
    CREATE TABLE IF NOT EXISTS connect_lite_users (
      id SERIAL PRIMARY KEY,
      uuid TEXT NOT NULL UNIQUE,
      "workshopId" INTEGER NOT NULL REFERENCES connect_workshops(id),
      "providerCompanyId" INTEGER,
      name TEXT NOT NULL,
      username TEXT NOT NULL,              -- código corto de acceso, único por taller
      email TEXT,
      phone TEXT,
      "pinHash" TEXT NOT NULL,             -- sha256(pin + salt); nunca el PIN
      "pinSalt" TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'operator', -- workshop_admin | operator
      active BOOLEAN NOT NULL DEFAULT true,
      "lastLoginAtMs" BIGINT,
      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL,
      UNIQUE ("workshopId", username)
    );

    -- Dispositivos y sesiones (token opaco; solo se guarda su hash)
    CREATE TABLE IF NOT EXISTS connect_lite_devices (
      id SERIAL PRIMARY KEY,
      "userId" INTEGER NOT NULL REFERENCES connect_lite_users(id) ON DELETE CASCADE,
      "workshopId" INTEGER NOT NULL,
      "deviceId" TEXT NOT NULL,
      "tokenHash" TEXT NOT NULL UNIQUE,
      platform TEXT,
      "osVersion" TEXT,
      "appVersion" TEXT,
      "fcmToken" TEXT,
      "gpsPermission" TEXT,
      "cameraPermission" TEXT,
      "notifPermission" TEXT,
      "lastSeenAtMs" BIGINT,
      "revokedAtMs" BIGINT,
      "createdAtMs" BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_connect_lite_devices_user ON connect_lite_devices ("userId");
    CREATE INDEX IF NOT EXISTS idx_connect_lite_devices_ws ON connect_lite_devices ("workshopId");

    -- Rastro GPS del operario durante la asistencia (solo servicios activos)
    CREATE TABLE IF NOT EXISTS connect_assistance_tracks (
      id SERIAL PRIMARY KEY,
      "assistanceId" INTEGER NOT NULL REFERENCES connect_assistances(id) ON DELETE CASCADE,
      "liteUserId" INTEGER,
      "deviceId" INTEGER,
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      "accuracyM" DOUBLE PRECISION,
      "speedKmh" DOUBLE PRECISION,
      "headingDeg" DOUBLE PRECISION,
      status TEXT,
      "deviceTsMs" BIGINT NOT NULL,
      "serverTsMs" BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_connect_tracks_assistance
      ON connect_assistance_tracks ("assistanceId", "deviceTsMs");
    CREATE UNIQUE INDEX IF NOT EXISTS idx_connect_tracks_dedupe
      ON connect_assistance_tracks ("assistanceId", "deviceTsMs", lat, lng);

    -- Evidencias (fotografías y documentos) subidas desde la APK
    CREATE TABLE IF NOT EXISTS connect_assistance_files (
      id SERIAL PRIMARY KEY,
      "assistanceId" INTEGER NOT NULL REFERENCES connect_assistances(id) ON DELETE CASCADE,
      "workshopId" INTEGER,
      "liteUserId" INTEGER,
      category TEXT NOT NULL DEFAULT 'other',
      url TEXT NOT NULL,
      "storagePath" TEXT,
      "fileName" TEXT,
      "mimeType" TEXT,
      "sizeBytes" INTEGER,
      sha256 TEXT,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      "deviceTsMs" BIGINT,
      "deletedAtMs" BIGINT,
      "createdAtMs" BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_connect_files_assistance ON connect_assistance_files ("assistanceId");

    -- Firma del cliente (una vigente por asistencia; el histórico se conserva)
    CREATE TABLE IF NOT EXISTS connect_assistance_signatures (
      id SERIAL PRIMARY KEY,
      "assistanceId" INTEGER NOT NULL REFERENCES connect_assistances(id) ON DELETE CASCADE,
      "workshopId" INTEGER,
      "liteUserId" INTEGER,
      "signerName" TEXT NOT NULL,
      "signerDocument" TEXT,
      "consentText" TEXT,
      "consentAccepted" BOOLEAN NOT NULL DEFAULT true,
      url TEXT NOT NULL,
      "storagePath" TEXT,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      "signedAtMs" BIGINT NOT NULL,
      "createdAtMs" BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_connect_signatures_assistance
      ON connect_assistance_signatures ("assistanceId");

    -- Idempotencia de operaciones enviadas desde la APK (cola offline)
    CREATE TABLE IF NOT EXISTS connect_lite_actions (
      "clientActionId" TEXT PRIMARY KEY,
      "liteUserId" INTEGER,
      "assistanceId" INTEGER,
      kind TEXT NOT NULL,
      result TEXT,
      "createdAtMs" BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_connect_lite_actions_created
      ON connect_lite_actions ("createdAtMs");
  `);

  // Backfills idempotentes de la jerarquía (solo actúan sobre filas sin dato)
  await db.query(`
    -- Unidad → taller, vínculo EXACTO: el vehículo del core dice a qué taller
    -- pertenece (roadside_vehicles."workshopId" ↔ connect_workshops."coreWorkshopId")
    UPDATE connect_mobile_units mu
       SET "workshopId" = w.id
      FROM roadside_vehicles rv, connect_workshops w
     WHERE mu."workshopId" IS NULL
       AND rv.id = mu."coreVehicleId"
       AND rv."workshopId" IS NOT NULL
       AND w."coreWorkshopId" = rv."workshopId";
  `);
  await db.query(`
    -- Fallback: si la empresa de la unidad tiene UN solo taller, asignarlo
    UPDATE connect_mobile_units mu
       SET "workshopId" = w.id
      FROM connect_workshops w
     WHERE mu."workshopId" IS NULL
       AND w."providerCompanyId" = mu."providerCompanyId"
       AND (SELECT COUNT(*) FROM connect_workshops w2
             WHERE w2."providerCompanyId" = mu."providerCompanyId") = 1;
  `);
  await db.query(`
    -- Operarios del core → taller: si solo hay un taller integrado (caso SEA)
    ALTER TABLE techs ADD COLUMN IF NOT EXISTS "workshopId" TEXT;
    UPDATE techs
       SET "workshopId" = (SELECT w."coreWorkshopId" FROM connect_workshops w
                            WHERE w."integrationType" = 'assist' AND w."coreWorkshopId" IS NOT NULL
                            LIMIT 1)
     WHERE "workshopId" IS NULL
       AND (SELECT COUNT(DISTINCT w."coreWorkshopId") FROM connect_workshops w
             WHERE w."integrationType" = 'assist' AND w."coreWorkshopId" IS NOT NULL) = 1;
  `);

  await seedConnectDefaults();
  await seedNetworkWorkshops();
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

  const vehicleTypes: Array<[string, string]> = [
    ["car", "Turismo"], ["van", "Furgoneta"], ["truck", "Camión"], ["bus", "Autobús"],
    ["motorcycle", "Motocicleta"], ["agricultural", "Agrícola"], ["machinery", "Maquinaria"],
    ["trailer", "Remolque"], ["other", "Otro"],
  ];
  for (let i = 0; i < vehicleTypes.length; i++) {
    await db.query(
      `INSERT INTO connect_vehicle_types (code, name, "sortOrder")
       VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING`,
      [vehicleTypes[i][0], vehicleTypes[i][1], i],
    );
  }

  // KPIs del Centro de Inteligencia Operacional (código, nombre, categoría,
  // unidad, dirección, objetivo, aviso, crítico)
  const kpis: Array<[string, string, string, string, string, number | null, number | null, number | null]> = [
    ["created_today", "Servicios recibidos", "operational", "", "higher_better", null, null, null],
    ["pending_assign", "Pendientes de asignación", "operational", "", "lower_better", 0, 3, 6],
    ["active_now", "Servicios activos", "operational", "", "higher_better", null, null, null],
    ["delayed_now", "Servicios con retraso (SLA)", "operational", "", "lower_better", 0, 1, 3],
    ["avg_assign_min", "Tiempo medio de asignación", "time", "min", "lower_better", 10, 20, 40],
    ["avg_arrival_min", "Tiempo medio de llegada", "time", "min", "lower_better", 45, 60, 90],
    ["avg_resolution_min", "Tiempo medio de resolución", "time", "min", "lower_better", 90, 150, 240],
    ["sla_pct", "Cumplimiento de SLA", "quality", "%", "higher_better", 90, 85, 75],
    ["acceptance_pct", "Tasa de aceptación de ofertas", "providers", "%", "higher_better", 85, 75, 60],
    ["cancel_pct", "Tasa de cancelación", "quality", "%", "lower_better", 5, 10, 20],
    ["eta_accuracy_min", "Precisión del ETA (desvío medio)", "quality", "min", "lower_better", 10, 15, 25],
    ["avg_cost", "Coste medio por servicio", "economic", "€", "lower_better", null, null, null],
    ["billing_today", "Facturación estimada del día", "economic", "€", "higher_better", null, null, null],
  ];
  for (let i = 0; i < kpis.length; i++) {
    const [code, name, category, unit, direction, target, warn, crit] = kpis[i];
    await db.query(
      `INSERT INTO connect_kpi_definitions
         (code, name, category, unit, direction, "targetValue", "warningThreshold", "criticalThreshold", "sortOrder")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (code) DO NOTHING`,
      [code, name, category, unit, direction, target, warn, crit, i],
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
