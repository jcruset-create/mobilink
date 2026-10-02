-- =============================================================================
-- Mobilink Self Storage · 0001 · Enums y funciones auxiliares
-- =============================================================================
--
-- Fuente ÚNICA del esquema del módulo. El servidor aplica estos ficheros en
-- orden al arrancar (`server/self-storage/schema.ts`, vía `prepararEsquema`),
-- y son los mismos que se pegan en el SQL Editor de Supabase si hace falta
-- aplicarlos a mano. Por eso todo es idempotente: se ejecutan en cada arranque.
--
-- Fase 1: centros, zonas, tipos de trastero, trasteros, plano, clientes,
-- personas autorizadas, reservas y contratos (sólo el modelo: la lógica de
-- contratos llega en la fase 2), importación, configuración y auditoría.
--
-- Añadir un valor a un enum:  ALTER TYPE x ADD VALUE IF NOT EXISTS 'nuevo';
-- en un fichero nuevo (0005_…), nunca editando el CREATE de aquí.
-- =============================================================================

-- gen_random_uuid() es nativo desde PostgreSQL 13: no hace falta pgcrypto (y
-- crear una extensión pide permisos que el usuario del servidor puede no tener).

DO $$ BEGIN
  CREATE TYPE self_storage_record_status AS ENUM ('active','inactive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE self_storage_unit_status AS ENUM ('available','reserved','occupied','maintenance','blocked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE self_storage_customer_type AS ENUM ('individual','company');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE self_storage_customer_status AS ENUM ('active','blocked','inactive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE self_storage_reservation_status AS ENUM ('active','converted','expired','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE self_storage_contract_status AS ENUM
    ('draft','pending_signature','pending_payment','active','suspended','terminated','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE self_storage_member_status AS ENUM ('active','suspended','revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE self_storage_block_reason AS ENUM ('non_payment','security','incident','contract_ended','manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE self_storage_actor_type AS ENUM ('staff','customer','member','guest','system','stripe','device');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE self_storage_import_status AS ENUM ('validated','applied','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- updated_at automático
CREATE OR REPLACE FUNCTION self_storage_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Tablas de sólo inserción (auditoría; más adelante eventos de acceso y de
-- Stripe). Como `assistance_events` y `rcp_eventos`: lo impone la base, no el
-- servidor, porque el servidor entra como propietario y RLS no le aplica.
CREATE OR REPLACE FUNCTION self_storage_forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% es de sólo inserción', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END $$;
