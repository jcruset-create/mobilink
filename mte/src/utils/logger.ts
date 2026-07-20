import pino from 'pino';
import { config } from '../config';

export const logger = pino({
  level: config.logLevel,
  base: { service: 'mte' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
