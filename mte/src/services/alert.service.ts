import { eventBus } from '../events/event-bus';
import { EventRepository } from '../repositories/event.repository';
import { NormalizedTelemetry, TelemetryEvent } from '../types/telemetry';

/**
 * Generación de alertas básicas a partir de la telemetría y cambios de estado.
 * Reglas iniciales: cambio de ignición, inicio/fin de movimiento y bajo voltaje.
 * Ampliable con reglas configurables en BD.
 */
export class AlertService {
  private readonly lastIgnition = new Map<string, boolean>();
  private readonly lastMovement = new Map<string, boolean>();
  private static readonly LOW_VOLTAGE_THRESHOLD = 11.5;

  constructor(private readonly events: EventRepository = new EventRepository()) {}

  async process(t: NormalizedTelemetry): Promise<void> {
    if (typeof t.engine.ignition === 'boolean') {
      const prev = this.lastIgnition.get(t.imei);
      if (prev !== undefined && prev !== t.engine.ignition) {
        await this.emit(t, t.engine.ignition ? 'ignition_on' : 'ignition_off', {});
      }
      this.lastIgnition.set(t.imei, t.engine.ignition);
    }

    if (typeof t.movement === 'boolean') {
      const prev = this.lastMovement.get(t.imei);
      if (prev !== undefined && prev !== t.movement) {
        await this.emit(t, t.movement ? 'movement_start' : 'movement_stop', {});
      }
      this.lastMovement.set(t.imei, t.movement);
    }

    if (
      typeof t.power.externalVoltage === 'number' &&
      t.power.externalVoltage > 0 &&
      t.power.externalVoltage < AlertService.LOW_VOLTAGE_THRESHOLD &&
      t.engine.ignition === false
    ) {
      await this.emit(t, 'alert', { alert: 'low_external_voltage', voltage: t.power.externalVoltage });
    }
  }

  private async emit(t: NormalizedTelemetry, type: TelemetryEvent['type'], data: Record<string, unknown>): Promise<void> {
    const event: TelemetryEvent = {
      type,
      imei: t.imei,
      vehicleId: t.vehicleId,
      timestamp: t.timestamp,
      data: { ...data, latitude: t.gps.latitude, longitude: t.gps.longitude },
    };
    await this.events.insert(event);
    eventBus.emitDomainEvent(event);
  }
}
