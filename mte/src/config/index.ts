import dotenv from 'dotenv';

dotenv.config();

function int(name: string, def: number): number {
  const v = process.env[name];
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : def;
}

function str(name: string, def: string): string {
  return process.env[name] ?? def;
}

export const config = {
  env: str('NODE_ENV', 'development'),
  logLevel: str('LOG_LEVEL', 'info'),

  tcp: {
    port: int('TCP_PORT', 5027),
    host: str('TCP_HOST', '0.0.0.0'),
    idleTimeoutMs: int('TCP_IDLE_TIMEOUT_MS', 600_000),
    maxConnections: int('TCP_MAX_CONNECTIONS', 5000),
  },

  http: {
    port: int('HTTP_PORT', 8080),
    apiKey: str('API_KEY', ''),
  },

  supabase: {
    url: str('SUPABASE_URL', ''),
    serviceRoleKey: str('SUPABASE_SERVICE_ROLE_KEY', ''),
    schema: str('SUPABASE_SCHEMA', 'public'),
  },

  devices: {
    authMode: str('DEVICE_AUTH_MODE', 'strict') as 'strict' | 'permissive' | 'open',
  },

  dedup: {
    windowSeconds: int('DEDUP_WINDOW_SECONDS', 86_400),
  },

  geofence: {
    arrivalRadiusMeters: int('ARRIVAL_RADIUS_METERS', 150),
  },
} as const;

export type Config = typeof config;
