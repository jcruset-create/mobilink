import net, { Socket } from 'net';
import { config } from '../../config';
import { childLogger, logger } from '../../utils/logger';
import { TeltonikaParser } from './teltonika-parser.service';
import { TeltonikaHandshakeService } from './teltonika-handshake.service';
import { TeltonikaAckService } from './teltonika-ack.service';
import { DeviceSession, TeltonikaSessionManager } from './teltonika-session.manager';
import { Codec8Decoder } from '../../decoders/teltonika/codec8.decoder';
import { DeviceService } from '../../services/device.service';
import { IngestService } from '../../services/ingest.service';

/**
 * Servidor TCP para dispositivos Teltonika (FMC150 / FMC650).
 * Flujo por conexión:
 *   1. Paquete IMEI  -> validación de dispositivo -> handshake 0x01/0x00
 *   2. Paquetes AVL  -> verificación CRC -> decode Codec 8/8E -> pipeline -> ACK
 */
export class TeltonikaTcpServer {
  private server: net.Server | null = null;
  readonly sessions = new TeltonikaSessionManager();
  private readonly parser = new TeltonikaParser();
  private readonly handshake = new TeltonikaHandshakeService();
  private readonly acker = new TeltonikaAckService();
  private readonly decoder = new Codec8Decoder();

  constructor(
    private readonly deviceService: DeviceService,
    private readonly ingestService: IngestService,
  ) {}

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = net.createServer((socket) => this.onConnection(socket));
      this.server.maxConnections = config.tcp.maxConnections;
      this.server.on('error', (err) => logger.error({ err }, 'Error en servidor TCP'));
      this.server.listen(config.tcp.port, config.tcp.host, () => {
        logger.info({ port: config.tcp.port, host: config.tcp.host }, 'Servidor TCP Teltonika escuchando');
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    for (const session of this.sessions.list()) session.socket.destroy();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  private onConnection(socket: Socket): void {
    const session = this.sessions.create(socket);
    const log = childLogger({ remote: session.remoteAddress });
    log.debug('Nueva conexión TCP');

    socket.setTimeout(config.tcp.idleTimeoutMs);
    socket.setKeepAlive(true, 60_000);

    socket.on('data', (chunk) => {
      session.lastActivityAt = new Date();
      session.buffer = Buffer.concat([session.buffer, chunk]);
      this.processBuffer(session).catch((err) => {
        log.error({ err, imei: session.imei }, 'Error procesando datos; cerrando conexión');
        socket.destroy();
      });
    });

    socket.on('timeout', () => {
      log.info({ imei: session.imei }, 'Sesión inactiva; cerrando');
      socket.destroy();
    });
    socket.on('error', (err) => log.warn({ err: err.message, imei: session.imei }, 'Error de socket'));
    socket.on('close', () => {
      this.sessions.remove(socket);
      log.debug({ imei: session.imei }, 'Conexión cerrada');
    });
  }

  private async processBuffer(session: DeviceSession): Promise<void> {
    // Fase 1: identificación por IMEI
    if (!session.imei) {
      const result = this.parser.parseImei(session.buffer);
      if (result.kind === 'incomplete') return;
      if (result.kind === 'invalid') {
        logger.warn({ remote: session.remoteAddress, reason: result.reason }, 'Paquete IMEI inválido; rechazando');
        this.handshake.reject(session.socket);
        session.socket.destroy();
        return;
      }
      if (result.kind !== 'imei') return;

      session.buffer = session.buffer.subarray(result.consumed);
      const device = await this.deviceService.authorize(result.imei);
      if (!device.authorized) {
        logger.warn({ imei: result.imei, remote: session.remoteAddress }, 'Dispositivo no autorizado; rechazando');
        this.handshake.reject(session.socket);
        session.socket.destroy();
        return;
      }

      this.sessions.identify(session, result.imei);
      session.authorized = true;
      session.deviceType = device.deviceType;
      session.vehicleId = device.vehicleId;
      this.handshake.accept(session.socket);
      logger.info({ imei: result.imei, deviceType: device.deviceType }, 'Dispositivo identificado y aceptado');
      await this.deviceService.markConnected(result.imei, session.remoteAddress);
    }

    // Fase 2: paquetes AVL (pueden llegar varios encadenados en el buffer)
    while (session.buffer.length > 0) {
      const frame = this.parser.parseAvlFrame(session.buffer);
      if (frame.kind === 'incomplete') return;
      if (frame.kind === 'invalid') {
        logger.warn({ imei: session.imei, reason: frame.reason }, 'Frame AVL inválido; cerrando conexión');
        session.socket.destroy();
        return;
      }
      if (frame.kind !== 'avl') return;

      session.buffer = session.buffer.subarray(frame.consumed);

      if (!frame.crcOk) {
        logger.warn({ imei: session.imei }, 'CRC inválido; solicitando reenvío (ACK 0)');
        this.acker.nack(session.socket);
        continue;
      }

      try {
        const packet = this.decoder.decode(frame.data);
        session.packetsReceived += 1;
        session.recordsReceived += packet.recordCount;

        await this.ingestService.ingest(session, packet);

        // ACK con el número de registros recibidos (obligatorio para que el
        // dispositivo borre los registros de su memoria)
        this.acker.ack(session.socket, packet.recordCount);
        logger.debug({ imei: session.imei, records: packet.recordCount }, 'Paquete AVL procesado y confirmado');
      } catch (err) {
        logger.error({ err, imei: session.imei }, 'Error decodificando/procesando paquete AVL');
        this.acker.nack(session.socket);
      }
    }
  }
}
