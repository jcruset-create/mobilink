import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL no está configurada");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rules (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quick_templates (
      id SERIAL PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      area TEXT NOT NULL,
      mode TEXT NOT NULL,
      "allowedTechs" TEXT,
      "priorityOrder" TEXT,
      "standardMinutes" INTEGER
    );

    CREATE TABLE IF NOT EXISTS techs (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      blocked BOOLEAN NOT NULL DEFAULT false,
      "currentJobId" INTEGER,
      competencies TEXT NOT NULL DEFAULT '{}',
      priorities TEXT NOT NULL DEFAULT '{}',
      avatar TEXT,
      "roadsideOperatorCode" TEXT,
      "statusChangedAtMs" BIGINT,
      "statusTotals" TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id SERIAL PRIMARY KEY,
      area TEXT NOT NULL,
      plate TEXT NOT NULL,
      urgent BOOLEAN NOT NULL DEFAULT false,
      status TEXT NOT NULL,
      "assignedNames" TEXT NOT NULL DEFAULT '[]',
      reason TEXT NOT NULL,
      "customerName" TEXT NOT NULL DEFAULT '',
      "customerPhone" TEXT NOT NULL DEFAULT '',
      "createdAtMs" BIGINT NOT NULL,
      "startedAtMs" BIGINT,
      "closedAtMs" BIGINT,
      template TEXT,
      "quickEntryLabel" TEXT,
      "quickEntryMode" TEXT,
      "actualMinutes" INTEGER,
      "workedAccumulatedMinutes" INTEGER DEFAULT 0,
      "pausedAccumulatedMinutes" INTEGER DEFAULT 0,
      "pausedAtMs" BIGINT,
      "finishedWhatsappSentAtMs" BIGINT,
      "finishedWhatsappSid" TEXT
    );

    CREATE TABLE IF NOT EXISTS job_assignments (
      id SERIAL PRIMARY KEY,
      "jobId" INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      "techName" TEXT NOT NULL,
      role TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS logs (
      id DOUBLE PRECISION PRIMARY KEY,
      time TEXT NOT NULL,
      text TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id BIGINT PRIMARY KEY,
      data JSONB NOT NULL,
      "updatedAtMs" BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS roadside_assistances (
      id SERIAL PRIMARY KEY,
      "workshopId" TEXT,
      status TEXT NOT NULL DEFAULT 'pendiente',
      priority TEXT NOT NULL DEFAULT 'normal',
      "customerName" TEXT NOT NULL DEFAULT '',
      "customerPhone" TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      "googleMapsUrl" TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      plate TEXT NOT NULL DEFAULT '',
      "vehicleDescription" TEXT,
      "webfleetVehicleId" TEXT,
      "assignedTechName" TEXT,
      "assignedVehicleName" TEXT,
      "trackingToken" TEXT NOT NULL UNIQUE,
      "trackingWhatsappSentAtMs" BIGINT,
      "trackingWhatsappSid" TEXT,
      notes TEXT,
      "createdAtMs" BIGINT NOT NULL,
      "assignedAtMs" BIGINT,
      "departedAtMs" BIGINT,
      "arrivedAtPointMs" BIGINT,
      "finishedAtMs" BIGINT,
      "arrivedAtWorkshopMs" BIGINT,
      "cancelledAtMs" BIGINT,
      "updatedAtMs" BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS roadside_assistance_events (
      id SERIAL PRIMARY KEY,
      "assistanceId" INTEGER NOT NULL REFERENCES roadside_assistances(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      note TEXT,
      "createdBy" TEXT,
      "createdAtMs" BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS roadside_assistance_files (
      id SERIAL PRIMARY KEY,
      "assistanceId" INTEGER NOT NULL REFERENCES roadside_assistances(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      url TEXT NOT NULL,
      "fileName" TEXT,
      "createdAtMs" BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS roadside_vehicles (
      id SERIAL PRIMARY KEY,
      "workshopId" TEXT,
      name TEXT NOT NULL,
      plate TEXT,
      "webfleetVehicleId" TEXT,
      notes TEXT,
      active BOOLEAN NOT NULL DEFAULT true,
      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL
    );
  `);

  await pool.query(`
    ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS "customerName" TEXT NOT NULL DEFAULT '';

    ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS "customerPhone" TEXT NOT NULL DEFAULT '';

    ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS "finishedWhatsappSentAtMs" BIGINT;

    ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS "finishedWhatsappSid" TEXT;
  `);

  await pool.query(`
    ALTER TABLE quick_templates
    ADD COLUMN IF NOT EXISTS "standardMinutes" INTEGER;
  `);

  await pool.query(`
    ALTER TABLE techs
    ADD COLUMN IF NOT EXISTS "statusChangedAtMs" BIGINT;
  `);

  await pool.query(`
    ALTER TABLE techs
    ADD COLUMN IF NOT EXISTS "roadsideOperatorCode" TEXT;
  `);

  await pool.query(`
    ALTER TABLE techs
    ADD COLUMN IF NOT EXISTS "statusTotals" TEXT NOT NULL DEFAULT '{}';
  `);

  await pool.query(`
    ALTER TABLE techs
    ADD COLUMN IF NOT EXISTS "roadsideCapable" BOOLEAN NOT NULL DEFAULT false;
  `);

  await pool.query(`
    ALTER TABLE techs
    ADD COLUMN IF NOT EXISTS "currentRoadsideAssistanceId" INTEGER;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id BIGINT PRIMARY KEY,
      data JSONB NOT NULL,
      "updatedAtMs" BIGINT NOT NULL
    );
  `);

  await pool.query(`
    ALTER TABLE roadside_assistances
    ADD COLUMN IF NOT EXISTS "workshopId" TEXT;

    ALTER TABLE roadside_assistances
    ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal';

    ALTER TABLE roadside_assistances
    ADD COLUMN IF NOT EXISTS "vehicleDescription" TEXT;

    ALTER TABLE roadside_assistances
    ADD COLUMN IF NOT EXISTS "webfleetVehicleId" TEXT;

    ALTER TABLE roadside_assistances
    ADD COLUMN IF NOT EXISTS "assignedVehicleName" TEXT;

    ALTER TABLE roadside_assistances
    ADD COLUMN IF NOT EXISTS "trackingWhatsappSentAtMs" BIGINT;

    ALTER TABLE roadside_assistances
    ADD COLUMN IF NOT EXISTS "trackingWhatsappSid" TEXT;

    ALTER TABLE roadside_assistances
    ADD COLUMN IF NOT EXISTS notes TEXT;

    ALTER TABLE roadside_assistances
    ADD COLUMN IF NOT EXISTS "operatorLat" DOUBLE PRECISION;

    ALTER TABLE roadside_assistances
    ADD COLUMN IF NOT EXISTS "operatorLng" DOUBLE PRECISION;

    ALTER TABLE roadside_assistances
    ADD COLUMN IF NOT EXISTS "operatorLocationAtMs" BIGINT;

    ALTER TABLE roadside_assistances
    ADD COLUMN IF NOT EXISTS "plateMismatch" BOOLEAN NOT NULL DEFAULT false;

    ALTER TABLE roadside_assistance_files
    ADD COLUMN IF NOT EXISTS "detectedPlate" TEXT;

    CREATE INDEX IF NOT EXISTS roadside_assistances_status_idx
      ON roadside_assistances(status);

    CREATE INDEX IF NOT EXISTS roadside_assistances_workshop_idx
      ON roadside_assistances("workshopId");

    CREATE INDEX IF NOT EXISTS roadside_assistance_events_assistance_idx
      ON roadside_assistance_events("assistanceId");

    CREATE TABLE IF NOT EXISTS roadside_vehicles (
      id SERIAL PRIMARY KEY,
      "workshopId" TEXT,
      name TEXT NOT NULL,
      plate TEXT,
      "webfleetVehicleId" TEXT,
      notes TEXT,
      active BOOLEAN NOT NULL DEFAULT true,
      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL
    );

    ALTER TABLE roadside_vehicles
    ADD COLUMN IF NOT EXISTS "workshopId" TEXT;

    ALTER TABLE roadside_vehicles
    ADD COLUMN IF NOT EXISTS plate TEXT;

    ALTER TABLE roadside_vehicles
    ADD COLUMN IF NOT EXISTS "webfleetVehicleId" TEXT;

    ALTER TABLE roadside_vehicles
    ADD COLUMN IF NOT EXISTS notes TEXT;

    ALTER TABLE roadside_vehicles
    ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

    CREATE INDEX IF NOT EXISTS roadside_vehicles_workshop_idx
      ON roadside_vehicles("workshopId");

    CREATE INDEX IF NOT EXISTS roadside_vehicles_active_idx
      ON roadside_vehicles(active);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tech_breaks (
      id SERIAL PRIMARY KEY,
      "techName" TEXT NOT NULL,
      "breakType" TEXT NOT NULL,
      "startedAtMs" BIGINT NOT NULL,
      "endedAtMs" BIGINT DEFAULT NULL,
      "jobId" INT DEFAULT NULL
    );

    ALTER TABLE techs ADD COLUMN IF NOT EXISTS "workshopPin" TEXT DEFAULT NULL;
    ALTER TABLE techs ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT NULL;
  `);

  await pool.query(`
    ALTER TABLE roadside_assistances
    ADD COLUMN IF NOT EXISTS "whatsappEnCaminoEnviado" BOOLEAN NOT NULL DEFAULT false;

    ALTER TABLE roadside_assistances
    ADD COLUMN IF NOT EXISTS "whatsappEnCaminoAt" BIGINT;

    ALTER TABLE roadside_assistances
    ADD COLUMN IF NOT EXISTS "reportToken" TEXT;

    ALTER TABLE roadside_assistances
    ADD COLUMN IF NOT EXISTS "whatsappAsignadaSentAtMs" BIGINT;

    ALTER TABLE roadside_assistances
    ADD COLUMN IF NOT EXISTS "whatsappFinalizadaSentAtMs" BIGINT;
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS roadside_assistances_report_token_idx
      ON roadside_assistances("reportToken")
      WHERE "reportToken" IS NOT NULL;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS companies (
      id SERIAL PRIMARY KEY,
      "workshopId" TEXT,
      nombre TEXT NOT NULL,
      nif TEXT,
      telefono TEXT,
      email TEXT,
      tipo TEXT NOT NULL DEFAULT 'otro',
      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS companies_nombre_idx ON companies(nombre);
    CREATE INDEX IF NOT EXISTS companies_workshop_idx ON companies("workshopId");

    CREATE TABLE IF NOT EXISTS roadside_backoffice (
      id SERIAL PRIMARY KEY,
      "assistanceId" INTEGER NOT NULL UNIQUE REFERENCES roadside_assistances(id) ON DELETE CASCADE,

      -- Bloque 1: Contactos
      "solicitanteNombre" TEXT,
      "solicitanteTelefono" TEXT,
      "solicitanteWhatsapp" TEXT,
      "solicitanteEmail" TEXT,
      "conductorTelefono" TEXT,
      "responsableNombre" TEXT,
      "responsableTelefono" TEXT,
      "responsableCargo" TEXT,
      "autorizadorNombre" TEXT,
      "autorizadorTelefono" TEXT,
      "autorizadorCargo" TEXT,

      -- Bloque 2: Empresas
      "empresaSolicitanteNombre" TEXT,
      "empresaSolicitanteTelefono" TEXT,
      "empresaSolicitanteEmail" TEXT,
      "empresaServicioNombre" TEXT,
      "empresaServicioCif" TEXT,
      "empresaServicioTelefono" TEXT,
      "empresaFacturacionNombre" TEXT,
      "empresaFacturacionCif" TEXT,
      "empresaFacturacionEmail" TEXT,
      "expedienteExterno" TEXT,
      "referenciaCliente" TEXT,
      "referenciaAutorizacion" TEXT,

      -- Bloque 3: Operativa
      "tiposAsistencia" TEXT,
      "tipoVehiculo" TEXT,
      "estadoVehiculo" TEXT,
      "ubicacionIncidencia" TEXT,

      -- Bloque 4: Vehículo
      marca TEXT,
      modelo TEXT,
      color TEXT,
      vin TEXT,
      kilometraje INTEGER,
      "medidaNeumatico" TEXT,
      "ejeAfectado" TEXT,
      "posicionRueda" TEXT,
      "vehiculoCargado" BOOLEAN,
      mercancia TEXT,
      adr BOOLEAN,

      -- Bloque 5: Facturación
      facturable BOOLEAN DEFAULT true,
      "pendienteAutorizacion" BOOLEAN DEFAULT false,
      garantia BOOLEAN DEFAULT false,
      interna BOOLEAN DEFAULT false,
      "importeAcordado" NUMERIC(10,2),
      "observacionesFacturacion" TEXT,

      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS roadside_backoffice_assistance_idx ON roadside_backoffice("assistanceId");
    CREATE INDEX IF NOT EXISTS roadside_backoffice_expediente_idx ON roadside_backoffice("expedienteExterno");
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_messages (
      id SERIAL PRIMARY KEY,
      message_sid TEXT NOT NULL UNIQUE,
      from_phone TEXT NOT NULL,
      profile_name TEXT,
      body TEXT,
      num_media INTEGER NOT NULL DEFAULT 0,
      media_urls TEXT,
      raw_payload TEXT,
      processed BOOLEAN NOT NULL DEFAULT false,
      assistance_draft_id INTEGER,
      created_at BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS whatsapp_messages_sid_idx ON whatsapp_messages(message_sid);
    CREATE INDEX IF NOT EXISTS whatsapp_messages_created_idx ON whatsapp_messages(created_at DESC);

    CREATE TABLE IF NOT EXISTS assistance_drafts (
      id SERIAL PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'whatsapp',
      source_message_id INTEGER,
      extracted_json TEXT,
      confidence TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS assistance_drafts_status_idx ON assistance_drafts(status);
    CREATE INDEX IF NOT EXISTS assistance_drafts_created_idx ON assistance_drafts(created_at DESC);
  `);

  console.log("PostgreSQL/Supabase inicializado correctamente");
}

export default pool;
