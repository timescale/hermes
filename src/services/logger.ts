import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import pino from 'pino';

const LOGS_DIR = '.hermes/logs';

try {
  mkdirSync(LOGS_DIR, { recursive: true });
} catch {
  // Ignore errors - directory may already exist
}

export const log = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.destination({
    dest: join(LOGS_DIR, 'hermes.log'),
  }),
);
