import { Socket } from 'net';

export interface DeviceSession {
  imei: string | null;
  deviceType: string | null;
  vehicleId: string | null;
  authorized: boolean;
  socket: Socket;
  remoteAddress: string;
  connectedAt: Date;
  lastActivityAt: Date;
  buffer: Buffer;
  packetsReceived: number;
  recordsReceived: number;
}

/**
 * Gestor de sesiones TCP activas, indexadas por socket y por IMEI.
 * Si un IMEI reconecta, la sesión antigua se cierra (los FMC reintentan
 * conexión y pueden dejar sockets zombis).
 */
export class TeltonikaSessionManager {
  private readonly bySocket = new Map<Socket, DeviceSession>();
  private readonly byImei = new Map<string, DeviceSession>();

  create(socket: Socket): DeviceSession {
    const session: DeviceSession = {
      imei: null,
      deviceType: null,
      vehicleId: null,
      authorized: false,
      socket,
      remoteAddress: socket.remoteAddress ?? 'unknown',
      connectedAt: new Date(),
      lastActivityAt: new Date(),
      buffer: Buffer.alloc(0),
      packetsReceived: 0,
      recordsReceived: 0,
    };
    this.bySocket.set(socket, session);
    return session;
  }

  identify(session: DeviceSession, imei: string): void {
    const existing = this.byImei.get(imei);
    if (existing && existing !== session) {
      existing.socket.destroy();
      this.bySocket.delete(existing.socket);
    }
    session.imei = imei;
    this.byImei.set(imei, session);
  }

  get(socket: Socket): DeviceSession | undefined {
    return this.bySocket.get(socket);
  }

  getByImei(imei: string): DeviceSession | undefined {
    return this.byImei.get(imei);
  }

  remove(socket: Socket): void {
    const session = this.bySocket.get(socket);
    if (!session) return;
    this.bySocket.delete(socket);
    if (session.imei && this.byImei.get(session.imei) === session) {
      this.byImei.delete(session.imei);
    }
  }

  get count(): number {
    return this.bySocket.size;
  }

  list(): DeviceSession[] {
    return [...this.bySocket.values()];
  }
}
