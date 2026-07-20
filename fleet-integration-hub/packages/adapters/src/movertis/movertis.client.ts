import { ProviderCredentials, ProviderError } from '@fih/domain';
import { providerFetch } from '../base.adapter';

/**
 * Cliente HTTP de la API de Movertis.
 * La API real de Movertis es REST con autenticación por token; la URL base y
 * los endpoints exactos se ajustan al contrato del partner. Este cliente
 * concentra TODO el conocimiento HTTP del proveedor para que el adaptador
 * trabaje solo con estructuras tipadas.
 */

export interface MovertisVehicle {
  id: string;
  registration?: string; // matrícula
  vin?: string;
  alias?: string;
  brand?: string;
  model?: string;
  type?: string;
  active?: boolean;
  odometer_km?: number;
  engine_hours?: number;
}

export interface MovertisPosition {
  vehicle_id: string;
  timestamp: string;
  lat: number;
  lon: number;
  speed_kmh?: number;
  heading?: number;
  ignition?: boolean;
}

export interface MovertisDriver {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
  vehicle_id?: string;
}

export class MovertisClient {
  constructor(private readonly credentials: ProviderCredentials) {}

  private get baseUrl(): string {
    return this.credentials.extra?.baseUrl ?? 'https://api.movertis.com/v1';
  }

  private headers(): Record<string, string> {
    const token = this.credentials.accessToken ?? this.credentials.apiKey;
    if (!token) throw new ProviderError('auth', 'Movertis: falta accessToken o apiKey');
    return { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  }

  private async get<T>(path: string, params: Record<string, string | undefined> = {}): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
    const res = await providerFetch(url.toString(), { headers: this.headers() });
    return (await res.json()) as T;
  }

  async ping(): Promise<void> {
    await this.get('/vehicles', { limit: '1' });
  }

  async vehicles(cursor?: string): Promise<{ data: MovertisVehicle[]; next?: string }> {
    return this.get('/vehicles', { cursor, limit: '100' });
  }

  async positions(since?: string, cursor?: string): Promise<{ data: MovertisPosition[]; next?: string }> {
    return this.get('/positions', { since, cursor, limit: '500' });
  }

  async drivers(cursor?: string): Promise<{ data: MovertisDriver[]; next?: string }> {
    return this.get('/drivers', { cursor, limit: '100' });
  }
}
