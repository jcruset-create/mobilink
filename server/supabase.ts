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

// Cliente solo-auth para iniciar sesiones en nombre de las APKs (login de
// operarios): usa la clave anónima y no persiste estado entre peticiones.
export const supabaseAnonAuth = createClient(
  supabaseUrl,
  process.env.VITE_SUPABASE_ANON_KEY || serviceRoleKey,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export const SUPABASE_STORAGE_BUCKET =
  process.env.SUPABASE_STORAGE_BUCKET || "avatars";

export const SUPABASE_ROADSIDE_BUCKET =
  process.env.SUPABASE_ROADSIDE_BUCKET || "roadside";
/**
 * Documentos de vehículo: fichas técnicas e informes de tacógrafo.
 *
 * PRIVADO, a diferencia de los demás: una ficha técnica lleva VIN y titular,
 * y un informe de tacógrafo lleva matrícula, bastidor y el nombre y la
 * tarjeta profesional del técnico. Se sirve con URL firmada desde el backend.
 *
 * Está aquí y no en cada módulo porque lo usan dos sitios —la ficha técnica
 * en `index.ts` y los informes de tacógrafo— y dos literales iguales es un
 * literal que algún día dejará de serlo.
 */
export const SUPABASE_DOCS_BUCKET =
  process.env.SUPABASE_DOCS_BUCKET || "tc-documentos";
