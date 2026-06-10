import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error("SUPABASE_URL no está configurada");
}

if (!serviceRoleKey) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY no está configurada");
}

export const supabase = createClient(supabaseUrl, serviceRoleKey);

export const SUPABASE_STORAGE_BUCKET =
  process.env.SUPABASE_STORAGE_BUCKET || "avatars";

export const SUPABASE_ROADSIDE_BUCKET =
  process.env.SUPABASE_ROADSIDE_BUCKET || "roadside";