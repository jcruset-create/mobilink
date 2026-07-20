import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';
import { logger } from '../utils/logger';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: SupabaseClient<any, any, any, any, any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getSupabase(): SupabaseClient<any, any, any, any, any> | null {
  if (client) return client;
  if (!config.supabase.url || !config.supabase.serviceRoleKey) {
    logger.warn('Supabase no configurado (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY); la persistencia está desactivada');
    return null;
  }
  client = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    db: { schema: config.supabase.schema },
    auth: { persistSession: false },
  });
  return client;
}
