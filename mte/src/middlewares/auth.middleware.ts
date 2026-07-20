import { NextFunction, Request, Response } from 'express';
import { config } from '../config';

/** Autenticación simple por API key (cabecera x-api-key). */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  if (!config.http.apiKey) {
    res.status(503).json({ error: 'API_KEY no configurada en el servidor' });
    return;
  }
  if (req.header('x-api-key') !== config.http.apiKey) {
    res.status(401).json({ error: 'No autorizado' });
    return;
  }
  next();
}
