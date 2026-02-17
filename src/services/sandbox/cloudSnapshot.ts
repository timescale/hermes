// ============================================================================
// Cloud Snapshot Management - Base image for cloud sandboxes
// ============================================================================

import type { Sandbox } from '@deno/sandbox';

import packageJson from '../../../package.json' with { type: 'json' };
import { log } from '../logger.ts';
import { DenoApiClient } from './denoApi.ts';

export type SnapshotBuildProgress =
  | { type: 'checking' }
  | { type: 'exists'; snapshotSlug: string }
  | { type: 'creating-volume'; message: string }
  | { type: 'booting-sandbox'; message: string }
  | { type: 'installing'; message: string; detail?: string }
  | { type: 'snapshotting'; message: string }
  | { type: 'cleaning-up'; message: string }
  | { type: 'done'; snapshotSlug: string }
  | { type: 'error'; message: string };

function getBaseSnapshotSlug(): string {
  return `hermes-base-${packageJson.version}`;
}

/**
 * Run a shell command in a sandbox and wait for it to finish.
 * Throws if the command exits with a non-zero status.
 *
 * Uses `sandbox.spawn(...)` instead of `sandbox.sh` because `sh` is a
 * tagged template literal that shell-escapes interpolated values, which
 * would break compound commands containing `|`, `&&`, `>`, etc.
 *
 * The Deno sandbox default user is NOT root, so we use `sudo` to run
 * commands as root (the default) or `sudo su - {user}` to run as a
 * specific user.
 */
async function sh(
  sandbox: Sandbox,
  command: string,
  options?: { user?: string },
): Promise<void> {
  const args = options?.user
    ? ['-c', `su - ${options.user} -c ${JSON.stringify(command)}`]
    : ['-c', command];
  const proc = await sandbox.spawn('sudo', {
    args: ['bash', ...args],
    stdout: 'piped',
    stderr: 'piped',
  });
  const result = await proc.output();
  if (!result.status.success) {
    const stderr = result.stderrText ?? '';
    log.warn(
      { command, exitCode: result.status.code, stderr },
      'Sandbox command failed',
    );
    throw new Error(
      `Command failed (exit ${result.status.code}): ${stderr.slice(0, 200)}`,
    );
  }
}

/**
 * Ensure the base cloud snapshot exists for the current hermes version.
 * Creates it if it doesn't exist by:
 * 1. Booting a sandbox from builtin:debian-13
 * 2. Installing all required tools
 * 3. Snapshotting the volume
 */
export async function ensureCloudSnapshot(options: {
  token: string;
  region: string;
  onProgress?: (progress: SnapshotBuildProgress) => void;
}): Promise<string> {
  const { token, region, onProgress } = options;
  const client = new DenoApiClient(token);
  const snapshotSlug = getBaseSnapshotSlug();

  // 1. Check if snapshot already exists
  onProgress?.({ type: 'checking' });
  try {
    const existing = await client.getSnapshot(snapshotSlug);
    if (existing) {
      onProgress?.({ type: 'exists', snapshotSlug });
      return snapshotSlug;
    }
  } catch (err) {
    log.debug({ err }, 'Failed to check snapshot');
  }

  // 2. Create a temporary bootable volume
  const buildVolumeSlug = `hermes-base-build-${Date.now()}`;
  onProgress?.({
    type: 'creating-volume',
    message: 'Creating build volume',
  });

  const volume = await client.createVolume({
    slug: buildVolumeSlug,
    region,
    capacity: '10GiB',
    from: 'builtin:debian-13',
  });

  let sandbox: Sandbox | null = null;

  try {
    // 3. Boot sandbox with volume as writable root
    onProgress?.({
      type: 'booting-sandbox',
      message: 'Booting build sandbox',
    });

    sandbox = await client.createSandbox({
      region: region as 'ord' | 'ams',
      root: volume.slug,
      timeout: '30m',
      memory: '2GiB',
    });

    // 4. Install system packages
    onProgress?.({
      type: 'installing',
      message: 'Installing system packages',
      detail: 'git, curl, ca-certificates, zip, unzip, tar, gzip, jq',
    });
    await sh(
      sandbox,
      'apt-get update && apt-get install -y git curl ca-certificates zip unzip tar gzip jq openssh-client',
    );

    // 5. Install GitHub CLI
    onProgress?.({
      type: 'installing',
      message: 'Installing GitHub CLI',
    });
    await sh(
      sandbox,
      [
        'curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg',
        'chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg',
        'echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null',
        'apt-get update && apt-get install -y gh',
      ].join(' && '),
    );

    // 6. Create hermes user
    onProgress?.({
      type: 'installing',
      message: 'Creating hermes user',
    });
    await sh(
      sandbox,
      [
        'groupadd -g 10000 hermes',
        'useradd -u 10000 -g hermes -m -s /bin/bash hermes',
        'mkdir -p /home/hermes/.local/bin /home/hermes/.local/share/opencode /home/hermes/.cache /home/hermes/.config/gh /home/hermes/.claude',
        'chown -R hermes:hermes /home/hermes',
        'mkdir -p /work && chown hermes:hermes /work',
      ].join(' && '),
    );

    // 7. Install Claude Code
    onProgress?.({
      type: 'installing',
      message: 'Installing Claude Code',
      detail: 'This may take a minute',
    });
    await sh(sandbox, 'curl -fsSL https://claude.ai/install.sh | bash', {
      user: 'hermes',
    });

    // 8. Install Tiger CLI
    onProgress?.({
      type: 'installing',
      message: 'Installing Tiger CLI',
    });
    await sh(sandbox, 'curl -fsSL https://cli.tigerdata.com | sh', {
      user: 'hermes',
    });

    // 9. Install OpenCode
    onProgress?.({
      type: 'installing',
      message: 'Installing OpenCode',
    });
    await sh(
      sandbox,
      'curl -fsSL https://opencode.ai/install | bash && mkdir -p /home/hermes/.opencode/bin && ln -sf /home/hermes/.local/bin/opencode /home/hermes/.opencode/bin/opencode',
      { user: 'hermes' },
    );

    // 10. Configure git
    onProgress?.({
      type: 'installing',
      message: 'Configuring git',
    });
    await sh(
      sandbox,
      'git config --global user.email "hermes@tigerdata.com" && git config --global user.name "Hermes Agent"',
      { user: 'hermes' },
    );

    // 11. Snapshot the volume
    onProgress?.({
      type: 'snapshotting',
      message: 'Creating snapshot (this may take a moment)',
    });
    await client.snapshotVolume(volume.id, { slug: snapshotSlug });

    onProgress?.({ type: 'done', snapshotSlug });
    return snapshotSlug;
  } finally {
    // 12. Cleanup: kill sandbox and delete build volume
    onProgress?.({
      type: 'cleaning-up',
      message: 'Cleaning up build resources',
    });
    try {
      if (sandbox) await sandbox.kill();
    } catch (err) {
      log.debug({ err }, 'Failed to kill build sandbox');
    }
    try {
      await client.deleteVolume(volume.id);
    } catch (err) {
      log.debug({ err }, 'Failed to delete build volume');
    }
  }
}
