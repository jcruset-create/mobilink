import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from '../config';
import { eventBus } from '../events/event-bus';
import { logger } from '../utils/logger';

/**
 * WebSocket de tiempo real: publica telemetría normalizada y eventos de
 * dominio a los módulos Mobilink (Panel TV, Fleet, Assist, ...).
 * Autenticación por query param ?apiKey= o cabecera x-api-key.
 */
export function startWebSocket(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const key = url.searchParams.get('apiKey') ?? req.headers['x-api-key'];
    if (!config.http.apiKey || key !== config.http.apiKey) {
      ws.close(4401, 'No autorizado');
      return;
    }
    logger.debug('Cliente WebSocket conectado');
  });

  const broadcast = (payload: unknown) => {
    const msg = JSON.stringify(payload);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
  };

  eventBus.onTelemetry((t) => broadcast({ channel: 'telemetry', data: t }));
  eventBus.onDomainEvent((e) => broadcast({ channel: 'event', data: e }));

  return wss;
}
