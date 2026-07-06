import { createClient } from "@supabase/supabase-js";

// Mismo proyecto Supabase que el resto de módulos (SSO compartido).
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl) throw new Error("Falta VITE_SUPABASE_URL");
if (!supabaseAnonKey) throw new Error("Falta VITE_SUPABASE_ANON_KEY");

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
