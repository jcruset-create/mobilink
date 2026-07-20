import { AvlPacket } from '../types/avl';
import { DeviceSession } from '../receivers/teltonika/teltonika-session.manager';
import { normalizeTelemetry } from '../normalizers/telemetry.normalizer';
import { DedupService } from './dedup.service';
import { PositionRepository } from '../repositories/position.repository';
import { TripService } from './trip.service';
import { GeofenceService } from './geofence.service';
import { AlertService } from './alert.service';
import { eventBus } from '../events/event-bus';
import { NormalizedTelemetry } from '../types/telemetry';
import { logger } from '../utils/logger';

/**
 * Pipeline de ingesta: paquete AVL decodificado -> normalización ->
 * deduplicación -> persistencia -> servicios de dominio -> publicación.
 */
export class IngestService {
  constructor(
    private readonly dedup = new DedupService(),
    private readonly positions = new PositionRepository(),
    private readonly trips = new TripService(),
    private readonly geofences = new GeofenceService(),
    private readonly alerts = new AlertService(),
  ) {}

  async ingest(session: DeviceSession, packet: AvlPacket): Promise<void> {
    if (!session.imei) throw new Error('Sesión sin IMEI');

    const fresh: NormalizedTelemetry[] = [];
    for (const record of packet.records) {
      const t = normalizeTelemetry(session.imei, session.deviceType, session.vehicleId, record);
      if (!this.dedup.checkAndMark(t.imei, t.timestamp, t.eventIoId)) {
        logger.debug({ imei: t.imei, ts: t.timestamp }, 'Registro duplicado descartado');
        continue;
      }
      fresh.push(t);
    }
    if (fresh.length === 0) return;

    // Los registros llegan ordenados; el último es la posición más reciente
    fresh.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    await this.positions.insertHistory(fresh);
    await this.positions.upsertCurrent(fresh[fresh.length - 1]);

    for (const t of fresh) {
      await this.trips.process(t);
      await this.geofences.process(t);
      await this.alerts.process(t);
      eventBus.emitTelemetry(t);
    }
  }
}
