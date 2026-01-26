import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import pino, { type Logger } from 'pino';

export const LOGS_DIR = '.hermes/logs';
export const LOG_FILE = join(LOGS_DIR, 'hermes.log');

// Lazy-initialized logger to avoid sonic-boom errors when CLI exits early (e.g., --help)
let _log: Logger | null = null;

export function getLogger(): Logger {
  if (!_log) {
    try {
      mkdirSync(LOGS_DIR, { recursive: true });
    } catch {
      // Ignore errors - directory may already exist
    }

    _log = pino(
      {
        level: process.env.LOG_LEVEL || 'info',
        timestamp: pino.stdTimeFunctions.isoTime,
      },
      pino.destination({
        dest: LOG_FILE,
      }),
    );
  }
  return _log;
}

// For backwards compatibility, export a proxy that lazily initializes the logger
export const log = new Proxy({} as Logger, {
  get(_target, prop) {
    return (getLogger() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
