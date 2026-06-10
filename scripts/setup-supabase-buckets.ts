/**
 * Crea y configura los buckets de Supabase Storage necesarios.
 * Ejecutar una sola vez: npx tsx scripts/setup-supabase-buckets.ts
 */
import dotenv from "dotenv";
dotenv.config();

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("❌  Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

type BucketConfig = {
  name: string;
  isPublic: boolean;
  fileSizeLimit: number;
  allowedMimeTypes: string[];
};

const BUCKETS: BucketConfig[] = [
  {
    name: process.env.SUPABASE_STORAGE_BUCKET || "avatars",
    isPublic: true,
    fileSizeLimit: 5 * 1024 * 1024, // 5 MB
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  },
  {
    name: process.env.SUPABASE_ROADSIDE_BUCKET || "roadside",
    isPublic: true,
    fileSizeLimit: 10 * 1024 * 1024, // 10 MB
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  },
];

async function setupBucket(config: BucketConfig) {
  const { name, isPublic, fileSizeLimit, allowedMimeTypes } = config;

  // Comprobar si ya existe
  const { data: existing } = await supabase.storage.getBucket(name);

  if (existing) {
    console.log(`🔄  Bucket "${name}" ya existe — actualizando configuración...`);
    const { error } = await supabase.storage.updateBucket(name, {
      public: isPublic,
      fileSizeLimit,
      allowedMimeTypes,
    });
    if (error) {
      console.error(`❌  Error actualizando "${name}":`, error.message);
    } else {
      console.log(`✅  Bucket "${name}" actualizado — público: ${isPublic}`);
    }
    return;
  }

  // Crear bucket nuevo
  const { error } = await supabase.storage.createBucket(name, {
    public: isPublic,
    fileSizeLimit,
    allowedMimeTypes,
  });

  if (error) {
    console.error(`❌  Error creando "${name}":`, error.message);
  } else {
    console.log(`✅  Bucket "${name}" creado — público: ${isPublic}`);
  }
}

async function main() {
  console.log("🚀  Configurando buckets de Supabase Storage...\n");

  for (const bucket of BUCKETS) {
    await setupBucket(bucket);
  }

  console.log("\n✔   Proceso completado.");
  console.log("\nRecuerda añadir estas variables en tu .env si no están:");
  console.log("  SUPABASE_STORAGE_BUCKET=avatars");
  console.log("  SUPABASE_ROADSIDE_BUCKET=roadside");
}

void main();
