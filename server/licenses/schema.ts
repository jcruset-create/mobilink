/**
 * Mobilink Assist — módulo de licencias: esquema de base de datos.
 *
 * Migraciones idempotentes (CREATE TABLE IF NOT EXISTS), sin alterar datos
 * existentes, siguiendo el mismo patrón que initDb() y el Integration Hub.
 */

import db from "../db.ts";

export async function initLicenses(): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS licenses (
      id SERIAL PRIMARY KEY,
      uuid TEXT NOT NULL UNIQUE,
      "customerName" TEXT NOT NULL,
      "companyName" TEXT NOT NULL DEFAULT '',
      plan TEXT NOT NULL DEFAULT 'standard',
      status TEXT NOT NULL DEFAULT 'pending',
      "activatedAtMs" BIGINT,
      "expiresAtMs" BIGINT,
      "graceDays" INTEGER NOT NULL DEFAULT 30,
      "maxUsers" INTEGER NOT NULL DEFAULT 5,
      "maxDevices" INTEGER NOT NULL DEFAULT 5,
      "aiMonthlyLimit" INTEGER NOT NULL DEFAULT 1000,
      modules TEXT NOT NULL DEFAULT '[]',
      "activationKey" TEXT NOT NULL,
      notes TEXT,
      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS license_renewals (
      id SERIAL PRIMARY KEY,
      "licenseId" INTEGER NOT NULL REFERENCES licenses(id),
      "renewedAtMs" BIGINT NOT NULL,
      "previousExpiresAtMs" BIGINT,
      "newExpiresAtMs" BIGINT NOT NULL,
      "renewedBy" TEXT,
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS license_history (
      id SERIAL PRIMARY KEY,
      "licenseId" INTEGER NOT NULL REFERENCES licenses(id),
      action TEXT NOT NULL,
      detail TEXT,
      "performedBy" TEXT,
      "createdAtMs" BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS license_notifications (
      id SERIAL PRIMARY KEY,
      "licenseId" INTEGER NOT NULL REFERENCES licenses(id),
      "daysBefore" INTEGER NOT NULL,
      "expiresAtMs" BIGINT NOT NULL,
      "sentAtMs" BIGINT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'log',
      UNIQUE ("licenseId", "daysBefore", "expiresAtMs")
    );

    CREATE TABLE IF NOT EXISTS license_usage (
      id SERIAL PRIMARY KEY,
      "licenseId" INTEGER NOT NULL REFERENCES licenses(id),
      "periodYm" TEXT NOT NULL,
      "aiCalls" INTEGER NOT NULL DEFAULT 0,
      "activeUsers" INTEGER NOT NULL DEFAULT 0,
      "activeDevices" INTEGER NOT NULL DEFAULT 0,
      "updatedAtMs" BIGINT NOT NULL,
      UNIQUE ("licenseId", "periodYm")
    );

    CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status);
    CREATE INDEX IF NOT EXISTS idx_licenses_expires ON licenses("expiresAtMs");
    CREATE INDEX IF NOT EXISTS idx_license_history_license ON license_history("licenseId");
  `);
  console.log("Licencias: esquema inicializado");
}
