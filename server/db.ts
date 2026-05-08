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
      "createdAtMs" BIGINT NOT NULL,
      "startedAtMs" BIGINT,
      "closedAtMs" BIGINT,
      template TEXT,
      "quickEntryLabel" TEXT,
      "quickEntryMode" TEXT,
      "actualMinutes" INTEGER,
      "workedAccumulatedMinutes" INTEGER DEFAULT 0,
      "pausedAccumulatedMinutes" INTEGER DEFAULT 0,
      "pausedAtMs" BIGINT
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
    ADD COLUMN IF NOT EXISTS "statusTotals" TEXT NOT NULL DEFAULT '{}';
  `);

  console.log("PostgreSQL/Supabase inicializado correctamente");
}

export default pool;