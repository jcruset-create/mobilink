import { Router } from 'express';
import { apiKeyAuth } from '../middlewares/auth.middleware';
import { TelemetryController } from '../controllers/telemetry.controller';

export function buildRoutes(controller: TelemetryController): Router {
  const router = Router();

  // Público (para health checks de Render / balanceadores)
  router.get('/health', controller.health);

  // Protegido por API key
  router.get('/api/v1/positions/current', apiKeyAuth, controller.currentPositions);
  router.get('/api/v1/positions/:imei/history', apiKeyAuth, controller.history);
  router.get('/api/v1/sessions', apiKeyAuth, controller.sessions);

  return router;
}
