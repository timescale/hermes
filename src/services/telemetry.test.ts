import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  flush,
  getAnonymousId,
  getTelemetry,
  isEnabled,
  resetTelemetryCaches,
  type TelemetryEvent,
  track,
} from './telemetry.ts';

// Store original env vars
const originalEnv = { ...process.env };

describe('telemetry', () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a temp directory for config files
    tempDir = join(tmpdir(), `hermes-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    process.env.HERMES_USER_CONFIG_DIR = tempDir;

    // Reset env vars that affect telemetry
    delete process.env.HERMES_TELEMETRY;
    delete process.env.DO_NOT_TRACK;

    // Reset telemetry state
    resetTelemetryCaches();
  });

  afterEach(async () => {
    // Restore original env
    process.env = { ...originalEnv };

    // Clean up temp directory
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('isEnabled', () => {
    test('returns false when HERMES_TELEMETRY=0', async () => {
      process.env.HERMES_TELEMETRY = '0';
      resetTelemetryCaches();

      const enabled = await isEnabled();
      expect(enabled).toBe(false);
    });

    test('returns false when DO_NOT_TRACK=1', async () => {
      process.env.DO_NOT_TRACK = '1';
      resetTelemetryCaches();

      const enabled = await isEnabled();
      expect(enabled).toBe(false);
    });

    test('returns true by default (opt-out model)', async () => {
      const enabled = await isEnabled();
      expect(enabled).toBe(true);
    });

    test('caches the enabled state', async () => {
      // First call
      const enabled1 = await isEnabled();
      expect(enabled1).toBe(true);

      // Set env var after first call - should still return cached value
      process.env.HERMES_TELEMETRY = '0';
      const enabled2 = await isEnabled();
      expect(enabled2).toBe(true); // Still true because cached
    });
  });

  describe('getAnonymousId', () => {
    test('generates and persists a UUID', async () => {
      const id1 = await getAnonymousId();
      expect(id1).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );

      // Should return same ID on subsequent calls
      const id2 = await getAnonymousId();
      expect(id2).toBe(id1);
    });

    test('persists ID to file', async () => {
      const id = await getAnonymousId();

      // Verify file was created
      const file = Bun.file(join(tempDir, 'telemetry.json'));
      expect(await file.exists()).toBe(true);

      const data = await file.json();
      expect(data.anonymousId).toBe(id);
      expect(data.createdAt).toBeDefined();
    });

    test('reads ID from existing file', async () => {
      const existingId = '12345678-1234-1234-1234-123456789abc';
      await Bun.write(
        join(tempDir, 'telemetry.json'),
        JSON.stringify({
          anonymousId: existingId,
          createdAt: new Date().toISOString(),
        }),
      );

      // Reset to clear any cached ID
      resetTelemetryCaches();

      const id = await getAnonymousId();
      expect(id).toBe(existingId);
    });

    test('handles corrupted telemetry.json gracefully', async () => {
      // Write invalid JSON
      await Bun.write(join(tempDir, 'telemetry.json'), 'not valid json {{{');

      resetTelemetryCaches();

      // Should generate a new ID instead of crashing
      const id = await getAnonymousId();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    test('handles telemetry.json with missing anonymousId', async () => {
      // Write JSON without anonymousId
      await Bun.write(
        join(tempDir, 'telemetry.json'),
        JSON.stringify({ createdAt: new Date().toISOString() }),
      );

      resetTelemetryCaches();

      // Should generate a new ID
      const id = await getAnonymousId();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    test('handles telemetry.json with wrong type for anonymousId', async () => {
      // Write JSON with wrong type
      await Bun.write(
        join(tempDir, 'telemetry.json'),
        JSON.stringify({
          anonymousId: 12345,
          createdAt: new Date().toISOString(),
        }),
      );

      resetTelemetryCaches();

      // Should generate a new ID
      const id = await getAnonymousId();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });
  });

  describe('track', () => {
    test('does not throw when telemetry is disabled', async () => {
      process.env.HERMES_TELEMETRY = '0';
      resetTelemetryCaches();

      // Should not throw
      track('test_event', { foo: 'bar' });
      // Wait for async track to complete
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    test('queues events when enabled', async () => {
      const telemetry = getTelemetry();
      await telemetry.track('test_event', { key: 'value' });

      expect(telemetry.getQueueLength()).toBe(1);
    });

    test('enforces queue size limit', async () => {
      const telemetry = getTelemetry();

      // Mock fetch to prevent actual flushing
      const originalFetch = global.fetch;
      global.fetch = (() => new Promise(() => {})) as unknown as typeof fetch; // Never resolves

      // Track more than MAX_QUEUE_SIZE events
      for (let i = 0; i < 150; i++) {
        await telemetry.track(`event_${i}`, {});
      }

      // Restore fetch
      global.fetch = originalFetch;

      // Queue should be capped at MAX_QUEUE_SIZE (100)
      expect(telemetry.getQueueLength()).toBeLessThanOrEqual(100);
    });
  });

  describe('flush', () => {
    test('handles empty queue gracefully', async () => {
      // Should not throw with empty queue
      await flush();
    });

    test('clears queue after flush', async () => {
      const telemetry = getTelemetry();
      await telemetry.track('test_event', { key: 'value' });

      // Mock fetch to avoid actual network calls
      const originalFetch = global.fetch;
      global.fetch = (() =>
        Promise.resolve(new Response('ok'))) as unknown as typeof fetch;

      await flush();

      // Restore fetch
      global.fetch = originalFetch;

      // Queue should be empty
      expect(telemetry.getQueueLength()).toBe(0);
    });

    test('retries on server error (5xx)', async () => {
      const telemetry = getTelemetry();
      await telemetry.track('test_event', { key: 'value' });

      let callCount = 0;
      const originalFetch = global.fetch;
      global.fetch = (() => {
        callCount++;
        if (callCount < 3) {
          return Promise.resolve(new Response('error', { status: 500 }));
        }
        return Promise.resolve(new Response('ok', { status: 200 }));
      }) as unknown as typeof fetch;

      await flush();

      // Restore fetch
      global.fetch = originalFetch;

      // Should have retried
      expect(callCount).toBe(3);
    });

    test('does not retry on client error (4xx)', async () => {
      const telemetry = getTelemetry();
      await telemetry.track('test_event', { key: 'value' });

      let callCount = 0;
      const originalFetch = global.fetch;
      global.fetch = (() => {
        callCount++;
        return Promise.resolve(new Response('bad request', { status: 400 }));
      }) as unknown as typeof fetch;

      await flush();

      // Restore fetch
      global.fetch = originalFetch;

      // Should not have retried
      expect(callCount).toBe(1);
    });

    test('retries on network error', async () => {
      const telemetry = getTelemetry();
      await telemetry.track('test_event', { key: 'value' });

      let callCount = 0;
      const originalFetch = global.fetch;
      global.fetch = (() => {
        callCount++;
        if (callCount < 3) {
          return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve(new Response('ok', { status: 200 }));
      }) as unknown as typeof fetch;

      await flush();

      // Restore fetch
      global.fetch = originalFetch;

      // Should have retried
      expect(callCount).toBe(3);
    });
  });

  describe('event structure', () => {
    test('includes schema version', async () => {
      const telemetry = getTelemetry();
      await telemetry.track('test_event', { key: 'value' });

      const queue = (telemetry as unknown as { queue: TelemetryEvent[] }).queue;
      const event = queue[0];

      expect(event?.schemaVersion).toBe(1);
    });

    test('has correct structure', async () => {
      const telemetry = getTelemetry();
      await telemetry.track('test_event', { key: 'value', count: 42 });

      const queue = (telemetry as unknown as { queue: TelemetryEvent[] }).queue;
      const event = queue[0];

      expect(event).toBeDefined();
      expect(event?.schemaVersion).toBe(1);
      expect(event?.event).toBe('test_event');
      expect(event?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(event?.anonymousId).toMatch(/^[0-9a-f-]{36}$/);
      expect(event?.properties).toEqual({ key: 'value', count: 42 });
      expect(event?.context.app.name).toBe('hermes');
      expect(event?.context.app.version).toBeDefined();
      expect(event?.context.os.name).toBeDefined();
      expect(event?.context.os.version).toBeDefined();
    });
  });

  describe('concurrent flush handling', () => {
    test('concurrent flushes wait for each other', async () => {
      const telemetry = getTelemetry();
      await telemetry.track('event1', {});
      await telemetry.track('event2', {});

      let callCount = 0;
      const originalFetch = global.fetch;
      global.fetch = (() => {
        callCount++;
        return new Promise((resolve) =>
          setTimeout(() => resolve(new Response('ok')), 50),
        );
      }) as unknown as typeof fetch;

      // Start two flushes concurrently
      const flush1 = flush();
      const flush2 = flush();

      await Promise.all([flush1, flush2]);

      // Restore fetch
      global.fetch = originalFetch;

      // Should only have made one fetch call
      expect(callCount).toBe(1);
    });
  });
});
