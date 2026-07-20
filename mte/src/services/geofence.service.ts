import { getSupabase } from '../repositories/supabase.client';
import { eventBus } from '../events/event-bus';
import { NormalizedTelemetry, TelemetryEvent } from '../types/telemetry';
import { EventRepository } from '../repositories/event.repository';
import { haversineMeters } from '../utils/geo';
import { logger } from '../utils/logger';

export interface Geofence {
  id: string;
  name: string;
  kind: 'generic' | 'assistance' | 'customer' | 'workshop';
  latitude: number;
  longitude: number;
  radius_m: number;
  active: boolean;
}

/**
 * Detección de entradas/salidas de geocercas circulares y llegadas a
 * asistencias, clientes y taller. Mantiene el estado dentro/fuera por
 * (imei, geocerca) en memoria y registra tiempos de permanencia.
 */
export class GeofenceService {
  private geofences: Geofence[] = [];
  private lastRefresh = 0;
  private readonly refreshMs = 60_000;
  /** Estado por imei -> set de geocercas en las que está dentro, con hora de entrada. */
  private readonly inside = new Map<string, Map<string, Date>>();

  constructor(private readonly events: EventRepository = new EventRepository()) {}

  private async refresh(): Promise<void> {
    if (Date.now() - this.lastRefresh < this.refreshMs) return;
    this.lastRefresh = Date.now();
    const sb = getSupabase();
    if (!sb) return;
    const { data, error } = await sb.from('mte_geofences').select('*').eq('active', true);
    if (error) {
      logger.error({ error }, 'Error cargando geocercas');
      return;
    }
    this.geofences = (data ?? []) as Geofence[];
  }

  async process(t: NormalizedTelemetry): Promise<void> {
    if (!t.gps.valid) return;
    await this.refresh();
    if (this.geofences.length === 0) return;

    let state = this.inside.get(t.imei);
    if (!state) {
      state = new Map();
      this.inside.set(t.imei, state);
    }

    for (const g of this.geofences) {
      const dist = haversineMeters(t.gps.latitude, t.gps.longitude, g.latitude, g.longitude);
      const isInside = dist <= g.radius_m;
      const wasInside = state.has(g.id);

      if (isInside && !wasInside) {
        state.set(g.id, new Date(t.timestamp));
        await this.emitEvent(t, g, 'enter', null);
      } else if (!isInside && wasInside) {
        const enteredAt = state.get(g.id)!;
        state.delete(g.id);
        const dwellSeconds = Math.round((new Date(t.timestamp).getTime() - enteredAt.getTime()) / 1000);
        await this.emitEvent(t, g, 'exit', dwellSeconds);
      }
    }
  }

  private async emitEvent(t: NormalizedTelemetry, g: Geofence, dir: 'enter' | 'exit', dwellSeconds: number | null): Promise<void> {
    const typeByKind: Record<Geofence['kind'], TelemetryEvent['type'] | null> = {
      generic: null,
      assistance: 'arrival_assistance',
      customer: 'arrival_customer',
      workshop: 'arrival_workshop',
    };

    const base: TelemetryEvent = {
      type: dir === 'enter' ? 'geofence_enter' : 'geofence_exit',
      imei: t.imei,
      vehicleId: t.vehicleId,
      timestamp: t.timestamp,
      data: { geofenceId: g.id, geofenceName: g.name, kind: g.kind, dwellSeconds },
    };
    await this.events.insert(base);
    eventBus.emitDomainEvent(base);

    // Llegada semántica (asistencia / cliente / taller) solo al entrar
    const semantic = typeByKind[g.kind];
    if (dir === 'enter' && semantic) {
      const arrival: TelemetryEvent = { ...base, type: semantic };
      await this.events.insert(arrival);
      eventBus.emitDomainEvent(arrival);
    }
  }
}
