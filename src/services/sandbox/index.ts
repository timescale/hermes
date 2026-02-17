// ============================================================================
// Sandbox Provider - Factory and re-exports
// ============================================================================

export { DockerSandboxProvider } from './dockerProvider.ts';
export type {
  CreateSandboxOptions,
  CreateShellSandboxOptions,
  ExecType,
  HermesSession,
  LogStream,
  ResumeSandboxOptions,
  SandboxBuildProgress,
  SandboxProvider,
  SandboxProviderType,
  SandboxStats,
} from './types.ts';

import { readConfig } from '../config.ts';
import { DockerSandboxProvider } from './dockerProvider.ts';
import type {
  HermesSession,
  SandboxProvider,
  SandboxProviderType,
} from './types.ts';

/**
 * Get a sandbox provider instance by type.
 * Currently only 'docker' is implemented; 'cloud' will be added in Phase 5.
 */
export function getSandboxProvider(type: SandboxProviderType): SandboxProvider {
  switch (type) {
    case 'docker':
      return new DockerSandboxProvider();
    case 'cloud':
      // TODO: Phase 5 - return new CloudSandboxProvider()
      throw new Error(
        'Cloud sandbox provider is not yet implemented. Use sandboxProvider: "docker" in your config.',
      );
  }
}

/**
 * Get the default sandbox provider based on user/project config.
 * Falls back to 'docker' if not configured.
 */
export async function getDefaultProvider(): Promise<SandboxProvider> {
  const config = await readConfig();
  return getSandboxProvider(config.sandboxProvider ?? 'docker');
}

/**
 * Get the appropriate provider for an existing session.
 * Uses the session's `provider` field to select the correct implementation.
 */
export function getProviderForSession(session: HermesSession): SandboxProvider {
  return getSandboxProvider(session.provider);
}
