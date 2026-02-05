// ============================================================================
// Telemetry Service - Anonymous usage tracking
// ============================================================================

import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { platform, release } from 'node:os';
import { dirname, join } from 'node:path';
import envPaths from 'env-paths';
import packageJson from '../../package.json' with { type: 'json' };
import { readConfig } from './config.ts';

// ============================================================================
// Types
// ============================================================================

/** Schema version for telemetry events. Increment when event structure changes. */
const SCHEMA_VERSION = 1;

export interface TelemetryEvent {
  /** Schema version for backwards compatibility */
  schemaVersion: number;
  /** Event name */
  event: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Anonymous device identifier (UUID) */
  anonymousId: string;
  /** Event-specific properties */
  properties?: Record<string, string | number | boolean | null>;
  /** Contextual information about the client */
  context: {
    app: { name: 'hermes'; version: string };
    os: { name: string; version: string };
  };
}

interface TelemetryData {
  anonymousId: string;
  createdAt: string;
}

/** Known error types for type-safe error tracking */
export const ErrorTypes = {
  DOCKER_NOT_FOUND: 'docker_not_found',
  DOCKER_NOT_RUNNING: 'docker_not_running',
  GIT_NOT_FOUND: 'git_not_found',
  AUTH_FAILED: 'auth_failed',
  NETWORK_ERROR: 'network_error',
  CONFIG_ERROR: 'config_error',
  UNKNOWN: 'unknown',
} as const;

export type ErrorType = (typeof ErrorTypes)[keyof typeof ErrorTypes];

// ============================================================================
// Constants
// ============================================================================

const TELEMETRY_ENDPOINT =
  process.env.HERMES_TELEMETRY_URL ||
  'https://hermes-telemetry.fly.dev/v1/track';

/** Number of events to batch before auto-flushing */
const BATCH_SIZE = 10;

/** Maximum queue size to prevent unbounded memory growth */
const MAX_QUEUE_SIZE = 100;

/** Timeout for flush requests */
const FLUSH_TIMEOUT_MS = 5000;

/** Maximum retry attempts for failed requests */
const MAX_RETRIES = 3;

/** Base delay for exponential backoff (doubles each retry) */
const RETRY_BASE_DELAY_MS = 1000;

// ============================================================================
// State
// ============================================================================

// Caches are module-level to persist across singleton resets during testing.
// This matches the pattern used by other services in this codebase.
let _enabledCache: boolean | null = null;
let _anonymousIdCache: string | null = null;
let _telemetry: TelemetryService | null = null;

// ============================================================================
// Telemetry Service
// ============================================================================

class TelemetryService {
  private queue: TelemetryEvent[] = [];
  private flushPromise: Promise<void> | null = null;

  /**
   * Track an event. Non-blocking, best-effort.
   * Events are queued and flushed periodically or when the queue reaches BATCH_SIZE.
   */
  async track(
    event: string,
    properties?: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    if (!(await this.isEnabled())) return;

    // Enforce queue size limit to prevent unbounded memory growth
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      // Drop oldest events to make room
      this.queue.shift();
    }

    this.queue.push({
      schemaVersion: SCHEMA_VERSION,
      event,
      timestamp: new Date().toISOString(),
      anonymousId: await this.getAnonymousId(),
      properties,
      context: this.getContext(),
    });

    if (this.queue.length >= BATCH_SIZE) {
      // Fire and forget - don't await
      this.flush().catch(() => {});
    }
  }

  /**
   * Flush queued events to the telemetry endpoint.
   * Includes retry logic with exponential backoff for transient failures.
   */
  async flush(): Promise<void> {
    if (this.queue.length === 0) return;

    // If already flushing, wait for that flush to complete
    if (this.flushPromise) {
      return this.flushPromise;
    }

    const batch = this.queue.splice(0);
    if (batch.length === 0) return;

    this.flushPromise = this.sendWithRetry(batch);

    try {
      await this.flushPromise;
    } finally {
      this.flushPromise = null;
    }
  }

  /**
   * Best-effort flush for process exit scenarios.
   * Fires the request but doesn't wait for completion.
   * Some events may be lost on exit - this is acceptable for telemetry.
   */
  flushOnExit(): void {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0);

    // Fire request with short timeout - process is exiting
    fetch(TELEMETRY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch }),
      signal: AbortSignal.timeout(1000),
    }).catch(() => {
      // Silently ignore - process is exiting anyway
    });
  }

  /**
   * Check if telemetry is enabled.
   *
   * Precedence (highest to lowest):
   * 1. HERMES_TELEMETRY=0 or DO_NOT_TRACK=1 env var (immediate disable)
   * 2. Config file setting (telemetry: false)
   * 3. Default: enabled (opt-out model)
   */
  async isEnabled(): Promise<boolean> {
    if (_enabledCache !== null) return _enabledCache;

    // Check env vars first (immediate disable)
    if (
      process.env.HERMES_TELEMETRY === '0' ||
      process.env.DO_NOT_TRACK === '1'
    ) {
      _enabledCache = false;
      return false;
    }

    // Check config
    try {
      const config = await readConfig();
      _enabledCache = config.telemetry !== false;
    } catch {
      // If config read fails, default to enabled
      _enabledCache = true;
    }

    return _enabledCache;
  }

  /**
   * Get or create the anonymous device ID.
   * ID is persisted to disk for consistency across sessions.
   */
  async getAnonymousId(): Promise<string> {
    if (_anonymousIdCache) return _anonymousIdCache;

    const filePath = this.getTelemetryFilePath();
    const telemetryFile = Bun.file(filePath);

    try {
      if (await telemetryFile.exists()) {
        const data = (await telemetryFile.json()) as TelemetryData;
        if (data.anonymousId && typeof data.anonymousId === 'string') {
          _anonymousIdCache = data.anonymousId;
          return _anonymousIdCache;
        }
      }
    } catch {
      // File doesn't exist, is invalid JSON, or has wrong structure
      // Generate a new ID below
    }

    // Generate and persist new ID
    _anonymousIdCache = randomUUID();
    const data: TelemetryData = {
      anonymousId: _anonymousIdCache,
      createdAt: new Date().toISOString(),
    };

    try {
      await mkdir(dirname(filePath), { recursive: true });
      await Bun.write(filePath, JSON.stringify(data));
    } catch {
      // Ignore write errors - ID is still usable in memory
    }

    return _anonymousIdCache;
  }

  /**
   * Reset cached enabled state. Call after config changes.
   */
  resetCache(): void {
    _enabledCache = null;
  }

  /** Get current queue length (for testing) */
  getQueueLength(): number {
    return this.queue.length;
  }

  private async sendWithRetry(batch: TelemetryEvent[]): Promise<void> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(TELEMETRY_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batch }),
          signal: AbortSignal.timeout(FLUSH_TIMEOUT_MS),
        });

        // Success or client error (4xx) - don't retry
        // Client errors indicate bad request, retrying won't help
        if (response.ok || (response.status >= 400 && response.status < 500)) {
          return;
        }

        // Server error (5xx) - will retry
      } catch {
        // Network error or timeout - will retry
      }

      // Exponential backoff before retry (1s, 2s, 4s)
      if (attempt < MAX_RETRIES - 1) {
        const delay = RETRY_BASE_DELAY_MS * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // All retries exhausted - silently fail
    // Telemetry is best-effort, don't impact user experience
  }

  private getTelemetryFilePath(): string {
    const configDir =
      process.env.HERMES_USER_CONFIG_DIR ||
      envPaths('hermes', { suffix: '' }).config;
    return join(configDir, 'telemetry.json');
  }

  private getContext(): TelemetryEvent['context'] {
    return {
      app: {
        name: 'hermes',
        version: packageJson.version,
      },
      os: {
        name: platform(),
        version: release(),
      },
    };
  }
}

// ============================================================================
// Singleton Access
// ============================================================================

function getTelemetryInstance(): TelemetryService {
  if (!_telemetry) {
    _telemetry = new TelemetryService();
  }
  return _telemetry;
}

/** Reset all state. Exported for testing only. */
export function resetTelemetryCaches(): void {
  _enabledCache = null;
  _anonymousIdCache = null;
  _telemetry = null;
}

// ============================================================================
// Public API
// ============================================================================

/** Track an event with optional properties. */
export function track(
  event: string,
  properties?: Record<string, string | number | boolean | null>,
): void {
  getTelemetryInstance().track(event, properties);
}

/** Flush queued events to the telemetry endpoint. */
export function flush(): Promise<void> {
  return getTelemetryInstance().flush();
}

/** Check if telemetry is enabled. */
export function isEnabled(): Promise<boolean> {
  return getTelemetryInstance().isEnabled();
}

/** Get the anonymous device ID. */
export function getAnonymousId(): Promise<string> {
  return getTelemetryInstance().getAnonymousId();
}

/** Reset the enabled cache. Call after config changes. */
export function resetCache(): void {
  getTelemetryInstance().resetCache();
}

/**
 * Get the telemetry service instance.
 * @internal Exported for testing only. Use the public API functions instead.
 */
export const getTelemetry = getTelemetryInstance;

// ============================================================================
// Convenience Helpers
// ============================================================================

/** Track a CLI command invocation. */
export function trackCommand(command: string): void {
  track('command_invoked', { command, version: packageJson.version });
}

/** Track session start. */
export function trackSessionStart(
  agent: string,
  model: string | undefined,
  options: {
    mountMode?: boolean;
    dbForkEnabled?: boolean;
  },
): void {
  track('session_started', {
    agent,
    model: model ?? null,
    mount_mode: options.mountMode ?? false,
    db_fork_enabled: options.dbForkEnabled ?? false,
  });
}

/** Track session completion. */
export function trackSessionCompleted(
  status: 'success' | 'error',
  durationMs: number,
  exitCode?: number,
): void {
  track('session_completed', {
    status,
    duration_ms: durationMs,
    exit_code: exitCode ?? null,
  });
}

/** Track session resume. */
export function trackSessionResumed(
  agent: string,
  mode: 'interactive' | 'detached' | 'shell',
): void {
  track('session_resumed', { agent, mode });
}

/** Track an error. Use ErrorTypes constants for common errors. */
export function trackError(
  errorType: ErrorType | string,
  command?: string,
): void {
  track('error_occurred', {
    error_type: errorType,
    command: command ?? null,
  });
}

/** Track agent selection. */
export function trackAgentSelected(
  agent: string,
  source: 'cli' | 'tui' | 'config',
): void {
  track('agent_selected', { agent, source });
}

/** Track model selection. */
export function trackModelSelected(model: string, agent: string): void {
  track('model_selected', { model, agent });
}

/** Track database fork creation. */
export function trackDbForkCreated(durationMs: number): void {
  track('db_fork_created', { duration_ms: durationMs });
}

/** Track config update. */
export function trackConfigUpdated(fieldsChanged: string[]): void {
  track('config_updated', {
    fields_changed: fieldsChanged.join(','),
  });
}

// ============================================================================
// Process Exit Handler
// ============================================================================

// Best-effort flush on process exit
// Note: Events may be lost on exit - this is acceptable for telemetry
process.on('beforeExit', () => {
  getTelemetryInstance().flushOnExit();
});

process.on('SIGINT', () => {
  getTelemetryInstance().flushOnExit();
});

process.on('SIGTERM', () => {
  getTelemetryInstance().flushOnExit();
});
