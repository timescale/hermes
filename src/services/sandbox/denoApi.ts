// ============================================================================
// Deno Deploy API - Thin wrapper around the @deno/sandbox SDK
// ============================================================================

import type {
  SandboxMetadata,
  SandboxOptions,
  SnapshotInit,
  VolumeInit,
} from '@deno/sandbox';
import { Client, Sandbox } from '@deno/sandbox';

import { log } from '../logger.ts';

// Re-export SDK types that our code consumes
export type { SandboxMetadata, SandboxOptions };
export { Sandbox };

export interface DenoVolume {
  id: string;
  slug: string;
  region: string;
}

export interface DenoSnapshot {
  id: string;
  slug: string;
  region: string;
}

/**
 * High-level Deno Deploy API client wrapping the @deno/sandbox SDK.
 *
 * Uses `Client` for management operations (volumes, snapshots, listing)
 * and `Sandbox` for individual sandbox lifecycle (create, connect, exec).
 */
export class DenoApiClient {
  private client: Client;
  private token: string;

  constructor(token: string) {
    this.token = token;
    this.client = new Client({ token });
  }

  // --------------------------------------------------------------------------
  // Sandbox Management (via Client)
  // --------------------------------------------------------------------------

  async listSandboxes(
    labels?: Record<string, string>,
  ): Promise<SandboxMetadata[]> {
    return this.client.sandboxes.list({ labels });
  }

  /**
   * Create a new sandbox. Returns the SDK Sandbox instance which provides
   * spawn(), fs, env, ssh, and other capabilities over its WebSocket connection.
   */
  async createSandbox(
    options: Omit<SandboxOptions, 'token'>,
  ): Promise<Sandbox> {
    log.debug(
      { region: options.region, root: options.root },
      'Creating sandbox',
    );
    return Sandbox.create({ ...options, token: this.token });
  }

  /**
   * Connect to an existing sandbox by ID.
   */
  async connectSandbox(id: string): Promise<Sandbox> {
    log.debug({ id }, 'Connecting to sandbox');
    return Sandbox.connect(id, { token: this.token });
  }

  /**
   * Kill a sandbox by ID. Uses Sandbox.connect + kill to avoid needing
   * an active connection.
   */
  async killSandbox(id: string): Promise<void> {
    log.debug({ id }, 'Killing sandbox');
    try {
      const sandbox = await Sandbox.connect(id, { token: this.token });
      await sandbox.kill();
    } catch (err) {
      // Sandbox may already be dead — log and swallow
      log.debug({ err, id }, 'Failed to kill sandbox (may already be stopped)');
    }
  }

  // --------------------------------------------------------------------------
  // Volume Management (via Client)
  // --------------------------------------------------------------------------

  async createVolume(init: VolumeInit): Promise<DenoVolume> {
    log.debug({ slug: init.slug, region: init.region }, 'Creating volume');
    const vol = await this.client.volumes.create(init);
    return { id: vol.id, slug: vol.slug, region: vol.region };
  }

  async listVolumes(): Promise<DenoVolume[]> {
    const result = await this.client.volumes.list();
    return result.items.map((v) => ({
      id: v.id,
      slug: v.slug,
      region: v.region,
    }));
  }

  async deleteVolume(idOrSlug: string): Promise<void> {
    log.debug({ idOrSlug }, 'Deleting volume');
    await this.client.volumes.delete(idOrSlug);
  }

  async snapshotVolume(
    volumeIdOrSlug: string,
    init: SnapshotInit,
  ): Promise<DenoSnapshot> {
    log.debug({ volumeIdOrSlug, slug: init.slug }, 'Snapshotting volume');
    const snap = await this.client.volumes.snapshot(volumeIdOrSlug, init);
    return { id: snap.id, slug: snap.slug, region: snap.region };
  }

  // --------------------------------------------------------------------------
  // Snapshot Management (via Client)
  // --------------------------------------------------------------------------

  async listSnapshots(): Promise<DenoSnapshot[]> {
    const result = await this.client.snapshots.list();
    return result.items.map((s) => ({
      id: s.id,
      slug: s.slug,
      region: s.region,
    }));
  }

  async getSnapshot(idOrSlug: string): Promise<DenoSnapshot | null> {
    // Try direct lookup first (works for proper IDs like snp_ord_...)
    try {
      const snap = await this.client.snapshots.get(idOrSlug);
      if (snap) return { id: snap.id, slug: snap.slug, region: snap.region };
    } catch {
      // Fall through to search by slug
    }
    // Search by slug for human-readable names
    const result = await this.client.snapshots.list({ search: idOrSlug });
    const match = result.items.find((s) => s.slug === idOrSlug);
    if (!match) return null;
    return { id: match.id, slug: match.slug, region: match.region };
  }

  async deleteSnapshot(idOrSlug: string): Promise<void> {
    log.debug({ idOrSlug }, 'Deleting snapshot');
    await this.client.snapshots.delete(idOrSlug);
  }
}
