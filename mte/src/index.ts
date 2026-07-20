import express from 'express';
import http from 'http';
import { config } from './config';
import { logger } from './utils/logger';
import { TeltonikaTcpServer } from './receivers/teltonika/teltonika-tcp.server';
import { DeviceService } from './services/device.service';
import { IngestService } from './services/ingest.service';
import { PositionRepository } from './repositories/position.repository';
import { TelemetryController } from './controllers/telemetry.controller';
import { buildRoutes } from './routes/api.routes';
import { startWebSocket } from './websocket/ws.server';

async function main(): Promise<void> {
  logger.info({ env: config.env }, 'Arrancando Mobilink Telematics Engine (MTE)');

  const deviceService = new DeviceService();
  const ingestService = new IngestService();
  const tcpServer = new TeltonikaTcpServer(deviceService, ingestService);

  // API REST + WebSocket
  const app = express();
  app.use(express.json());
  const positionRepo = new PositionRepository();
  const controller = new TelemetryController(positionRepo, tcpServer);
  app.use(buildRoutes(controller));

  const httpServer = http.createServer(app);
  startWebSocket(httpServer);

  await tcpServer.start();
  await new Promise<void>((resolve) => httpServer.listen(config.http.port, resolve));
  logger.info({ port: config.http.port }, 'API REST + WebSocket escuchando');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Parando MTE...');
    await tcpServer.stop();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Error fatal arrancando MTE');
  process.exit(1);
});
