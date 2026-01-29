// ============================================================================
// Docker Setup Screen - Standalone screen runner for Docker setup
// ============================================================================

import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { restoreConsole } from '../utils';
import { CopyOnSelect } from './CopyOnSelect';
import { DockerSetup, type DockerSetupResult } from './DockerSetup';

/**
 * Run the Docker setup screen as a standalone TUI.
 * This is used by commands like `branch` that need to ensure Docker is ready
 * but aren't part of a larger wizard flow.
 *
 * The TUI handles both Docker runtime setup and Docker image building.
 *
 * @returns Promise that resolves with the setup result
 */
export async function runDockerSetupScreen(): Promise<DockerSetupResult> {
  // Always show the TUI - it handles both Docker setup and image building
  // The DockerSetup component will skip straight to image building if Docker is already running
  let resolveSetup: (result: DockerSetupResult) => void;
  const setupPromise = new Promise<DockerSetupResult>((resolve) => {
    resolveSetup = resolve;
  });

  const renderer = await createCliRenderer({ exitOnCtrlC: true });
  const root = createRoot(renderer);

  root.render(
    <CopyOnSelect>
      <DockerSetup
        title="Docker Setup"
        onComplete={(result) => resolveSetup(result)}
      />
    </CopyOnSelect>,
  );

  const result = await setupPromise;

  await renderer.idle();
  renderer.destroy();
  restoreConsole();

  return result;
}
