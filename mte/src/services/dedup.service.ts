import { config } from '../config';

/**
 * Protección contra duplicados en memoria.
 * Los FMC reenvían paquetes si no reciben ACK; además la BD tiene una
 * restricción de unicidad (imei, ts, event_io_id) como segunda barrera.
 */
export class DedupService {
  private readonly seen = new Map<string, number>();

  private key(imei: string, timestamp: string, eventIoId: number): string {
    return `${imei}|${timestamp}|${eventIoId}`;
  }

  /** Devuelve true si el registro es nuevo (y lo marca como visto). */
  checkAndMark(imei: string, timestamp: string, eventIoId: number): boolean {
    this.gc();
    const k = this.key(imei, timestamp, eventIoId);
    if (this.seen.has(k)) return false;
    this.seen.set(k, Date.now());
    return true;
  }

  private lastGc = 0;
  private gc(): void {
    const now = Date.now();
    if (now - this.lastGc < 60_000) return;
    this.lastGc = now;
    const cutoff = now - config.dedup.windowSeconds * 1000;
    for (const [k, at] of this.seen) {
      if (at < cutoff) this.seen.delete(k);
    }
  }
}
