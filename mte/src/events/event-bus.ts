import { EventEmitter } from 'events';
import { NormalizedTelemetry, TelemetryEvent } from '../types/telemetry';

/**
 * Bus de eventos interno del MTE.
 * Los módulos Mobilink (WebSocket, alertas, enlaces con Assist/OTF, ...) se
 * suscriben aquí sin acoplarse al pipeline de ingesta.
 */
class MteEventBus extends EventEmitter {
  emitTelemetry(t: NormalizedTelemetry): void {
    this.emit('telemetry', t);
  }
  onTelemetry(fn: (t: NormalizedTelemetry) => void): void {
    this.on('telemetry', fn);
  }

  emitDomainEvent(e: TelemetryEvent): void {
    this.emit('domain-event', e);
  }
  onDomainEvent(fn: (e: TelemetryEvent) => void): void {
    this.on('domain-event', fn);
  }
}

export const eventBus = new MteEventBus();
eventBus.setMaxListeners(50);
