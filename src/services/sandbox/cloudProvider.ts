// ============================================================================
// Cloud Sandbox Provider - Deno Deploy implementation using @deno/sandbox SDK
// ============================================================================

import type { Sandbox } from '@deno/sandbox';
import { runCloudSetupScreen } from '../../components/CloudSetup.tsx';
import { enterSubprocessScreen, resetTerminal } from '../../utils.ts';
import type { AgentType } from '../config.ts';
import { readConfig } from '../config.ts';
import { ensureDenoToken, getDenoToken } from '../deno.ts';
import { getCredentialFiles } from '../docker.ts';
import { log } from '../logger.ts';
import { ensureCloudSnapshot } from './cloudSnapshot.ts';
import { DenoApiClient, denoSlug, type ResolvedSandbox } from './denoApi.ts';
import {
  deleteSession as dbDeleteSession,
  getSession as dbGetSession,
  listSessions as dbListSessions,
  openSessionDb,
  updateSessionSnapshot,
  updateSessionStatus,
  upsertSession,
} from './sessionDb.ts';
import type {
  CreateSandboxOptions,
  CreateShellSandboxOptions,
  HermesSession,
  LogStream,
  ResumeSandboxOptions,
  SandboxBuildProgress,
  SandboxProvider,
} from './types.ts';

// ============================================================================
// Constants
// ============================================================================

/** Name of the tmux session used for agent processes inside cloud sandboxes. */
const TMUX_SESSION = 'hermes';

// ============================================================================
// Shell Helpers
// ============================================================================

/** Escape a value for safe interpolation in a shell command string. */
function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

// ============================================================================
// Agent Command Builder
// ============================================================================

/**
 * Build the shell command string that starts an AI agent inside a sandbox.
 * Uses base64 encoding to safely pass the prompt through the shell.
 */
function buildAgentCommand(options: CreateSandboxOptions): string {
  const modelArg = options.model ? ` --model ${options.model}` : '';
  const extraArgs = options.agentArgs?.length
    ? ` ${options.agentArgs.join(' ')}`
    : '';
  const hasPrompt = options.prompt.trim().length > 0;

  if (options.agent === 'claude') {
    const hasPlanArgs =
      options.agentArgs?.includes('--permission-mode') ?? false;
    const skipPermsFlag = hasPlanArgs
      ? '--allow-dangerously-skip-permissions'
      : '--dangerously-skip-permissions';
    const asyncFlag = !options.interactive ? ' -p' : '';
    return hasPrompt
      ? `echo '${Buffer.from(options.prompt).toString('base64')}' | base64 -d | claude${asyncFlag}${extraArgs}${modelArg} ${skipPermsFlag}`
      : `claude${asyncFlag}${extraArgs}${modelArg} ${skipPermsFlag}`;
  }

  if (!options.interactive) {
    return hasPrompt
      ? `echo '${Buffer.from(options.prompt).toString('base64')}' | base64 -d | opencode${modelArg}${extraArgs} run`
      : `opencode${modelArg}${extraArgs} run`;
  }

  return hasPrompt
    ? `opencode${modelArg}${extraArgs} --prompt '${options.prompt.replace(/'/g, "'\\''")}'`
    : `opencode${modelArg}${extraArgs}`;
}

// ============================================================================
// Credential Injection
// ============================================================================

/**
 * Write all credential files (Claude, OpenCode, gh CLI) into a sandbox
 * using the SDK's filesystem API. Resolves the default user's $HOME first
 * so paths are correct for the sandbox environment.
 */
async function injectCredentials(sandbox: Sandbox): Promise<void> {
  const homeResult = await spawnShellCapture(sandbox, 'echo $HOME');
  const home = homeResult.trim();
  const credFiles = await getCredentialFiles(home);
  for (const file of credFiles) {
    const dir = file.path.substring(0, file.path.lastIndexOf('/'));
    await sandbox.fs.mkdir(dir, { recursive: true });
    await sandbox.fs.writeTextFile(file.path, file.value);
  }
}

// ============================================================================
// SSH Helper
// ============================================================================

/**
 * Expose SSH on a sandbox and run an interactive SSH session.
 *
 * @param options.command  Shell command to execute on the remote side.
 * @param options.tmux     If true, wrap the command in a persistent tmux
 *                         session so the agent survives SSH disconnects.
 *                         ctrl+\ detaches (configured in ~/.tmux.conf).
 *                         When reattaching (command omitted, tmux true),
 *                         connects to the existing tmux session.
 */
async function sshIntoSandbox(
  sandbox: Sandbox,
  options?: { command?: string; tmux?: boolean },
): Promise<void> {
  const { command, tmux } = options ?? {};
  const sshInfo = await sandbox.exposeSsh();
  enterSubprocessScreen();
  const sshArgs = [
    'ssh',
    '-o',
    'StrictHostKeyChecking=no',
    '-o',
    'UserKnownHostsFile=/dev/null',
    '-o',
    'LogLevel=ERROR',
    '-o',
    'SetEnv=TERM=xterm-256color',
  ];

  // Build the remote command
  // -u forces UTF-8 mode so block/box-drawing characters render correctly
  let remoteCmd: string | undefined;
  if (tmux && command) {
    // Start agent inside a named tmux session (or attach if it already exists)
    remoteCmd = `tmux -u new-session -A -s ${TMUX_SESSION} ${shellEscape(command)}`;
  } else if (tmux) {
    // Reattach to existing tmux session, or fall back to a shell
    remoteCmd = `tmux -u attach -t ${TMUX_SESSION} 2>/dev/null || bash -l`;
  } else if (command) {
    remoteCmd = command;
  }

  if (remoteCmd) {
    // Force PTY allocation — required for interactive TUIs and tmux
    sshArgs.push('-t');
    sshArgs.push(`${sshInfo.username}@${sshInfo.hostname}`);
    sshArgs.push(remoteCmd);
  } else {
    sshArgs.push(`${sshInfo.username}@${sshInfo.hostname}`);
  }

  const proc = Bun.spawn(sshArgs, {
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  await proc.exited;
  resetTerminal();
}

/**
 * Run a shell command in the sandbox with piped stdout/stderr.
 * Throws on non-zero exit code.
 *
 * Uses spawn() directly instead of sandbox.sh because the SDK has a
 * chaining bug: each builder method (sudo, stdout, stderr, noThrow) creates
 * a fresh clone that only retains the single property being set, losing all
 * previous chain state.
 */
async function spawnShell(sandbox: Sandbox, command: string): Promise<void> {
  const proc = await sandbox.spawn('bash', {
    args: ['-c', command],
    stdout: 'piped',
    stderr: 'piped',
    env: { BASH_ENV: '$HOME/.bashrc' },
  });
  const result = await proc.output();
  if (!result.status.success) {
    const stderr = result.stderrText ?? '';
    log.warn(
      { command: command.slice(0, 200), exitCode: result.status.code, stderr },
      'Sandbox command failed',
    );
    throw new Error(
      `Sandbox command failed (exit ${result.status.code}): ${stderr || command}`,
    );
  }
}

/**
 * Run a shell command and return its stdout text. Piped so nothing leaks to TUI.
 */
async function spawnShellCapture(
  sandbox: Sandbox,
  command: string,
): Promise<string> {
  const proc = await sandbox.spawn('bash', {
    args: ['-c', command],
    stdout: 'piped',
    stderr: 'piped',
    env: { BASH_ENV: '$HOME/.bashrc' },
  });
  const result = await proc.output();
  if (!result.status.success) {
    const stderr = result.stderrText ?? '';
    throw new Error(
      `Sandbox command failed (exit ${result.status.code}): ${stderr || command}`,
    );
  }
  return result.stdoutText ?? '';
}

// ============================================================================
// Cloud Provider Implementation
// ============================================================================

export class CloudSandboxProvider implements SandboxProvider {
  readonly type = 'cloud' as const;

  private client: DenoApiClient | null = null;
  private region: string;

  constructor(region?: string) {
    this.region = region ?? 'ord';
  }

  // --------------------------------------------------------------------------
  // Private Helpers
  // --------------------------------------------------------------------------

  private async getClient(): Promise<DenoApiClient> {
    if (this.client) return this.client;
    const token = await getDenoToken();
    if (!token) throw new Error('No Deno Deploy token available');
    this.client = new DenoApiClient(token);
    return this.client;
  }

  private async resolveRegion(): Promise<string> {
    const config = await readConfig();
    return config.cloudRegion ?? this.region;
  }

  // --------------------------------------------------------------------------
  // Setup
  // --------------------------------------------------------------------------

  /**
   * Check whether the cloud provider needs setup (no token available).
   * Useful for UI to decide whether to show the setup flow before proceeding.
   */
  async needsSetup(): Promise<boolean> {
    const token = await getDenoToken();
    return !token;
  }

  async ensureReady(): Promise<void> {
    const token = await getDenoToken();
    if (!token) {
      const result = await runCloudSetupScreen();
      if (result.type !== 'ready') {
        throw new Error('Cloud setup was cancelled');
      }
    }
    // Verify we now have a valid token
    const validToken = await ensureDenoToken();
    if (!validToken) {
      throw new Error('No valid Deno Deploy token available');
    }
    this.client = new DenoApiClient(validToken);
  }

  // --------------------------------------------------------------------------
  // Image / Snapshot Management
  // --------------------------------------------------------------------------

  async ensureImage(options?: {
    onProgress?: (progress: SandboxBuildProgress) => void;
  }): Promise<string> {
    const token = await getDenoToken();
    if (!token) {
      throw new Error(
        'No Deno Deploy token configured. Run cloud setup first.',
      );
    }

    const region = await this.resolveRegion();

    const slug = await ensureCloudSnapshot({
      token,
      region,
      onProgress: (p) => {
        switch (p.type) {
          case 'checking':
            options?.onProgress?.({ type: 'checking' });
            break;
          case 'exists':
            options?.onProgress?.({ type: 'exists' });
            break;
          case 'creating-volume':
          case 'booting-sandbox':
          case 'installing':
          case 'snapshotting':
          case 'cleaning-up':
            options?.onProgress?.({ type: 'building', message: p.message });
            break;
          case 'done':
            options?.onProgress?.({ type: 'done' });
            break;
          case 'error':
            log.error({ error: p.message }, 'Snapshot build error');
            break;
        }
      },
    });

    return slug;
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  async create(options: CreateSandboxOptions): Promise<HermesSession | null> {
    const client = await this.getClient();
    const region = await this.resolveRegion();
    const baseSnapshot = await this.ensureImage();

    // 1. Create session-specific root volume from the base snapshot.
    // Volumes created from snapshots are copy-on-write: they start with
    // all the tools/config from the snapshot and only allocate space for
    // new writes.  We must boot from a volume (not directly from a
    // snapshot) because Deno's snapshot-boot uses a read-only overlay
    // that does not expose the snapshot's installed packages.
    const volumeSlug = denoSlug('hs', options.branchName);
    const rootVolume = await client.createVolume({
      slug: volumeSlug,
      region,
      capacity: '10GiB',
      from: baseSnapshot,
    });

    // 2. Build env vars
    const env: Record<string, string> = { ...options.envVars };

    // 3. Boot sandbox from the session volume
    let sandbox: ResolvedSandbox;
    try {
      sandbox = await client.createSandbox({
        region: region as 'ord' | 'ams',
        root: rootVolume.slug,
        timeout: '30m',
        memory: '2GiB',
        labels: {
          'hermes.managed': 'true',
          'hermes.name': options.branchName,
          'hermes.agent': options.agent,
          'hermes.repo': options.repoInfo?.fullName ?? 'local',
        },
        env,
      });
    } catch (err) {
      // Clean up the orphaned volume
      try {
        await client.deleteVolume(rootVolume.id);
      } catch (delErr) {
        log.debug(
          { err: delErr },
          'Failed to clean up volume after sandbox creation failure',
        );
      }

      const message = (err as { message?: string })?.message ?? String(err);
      if (
        message.includes('limit') ||
        message.includes('concurrent') ||
        message.includes('quota')
      ) {
        const db = openSessionDb();
        const running = dbListSessions(db, {
          provider: 'cloud',
          status: 'running',
        });
        throw new Error(
          `Cloud sandbox limit reached (${running.length} running). ` +
            'Stop a running session or wait for one to finish.',
        );
      }
      throw err;
    }

    try {
      // 4. Inject credential files
      await injectCredentials(sandbox);

      // 5. Clone repo and create branch
      if (options.repoInfo && options.isGitRepo !== false) {
        const fullName = options.repoInfo.fullName;
        const branchRef = `hermes/${options.branchName}`;
        await spawnShell(
          sandbox,
          `cd /work && gh auth setup-git && gh repo clone ${shellEscape(fullName)} app && cd app && git switch -c ${shellEscape(branchRef)}`,
        );
      } else {
        await spawnShell(sandbox, 'mkdir -p /work/app');
      }

      // 6. Run init script if configured (dynamic — may contain shell syntax)
      if (options.initScript) {
        await spawnShell(sandbox, `cd /work/app && ${options.initScript}`);
      }

      // 7. Start agent process
      const agentCommand = buildAgentCommand(options);
      if (options.interactive) {
        // Interactive mode: launch agent inside tmux for detach/reattach
        await sshIntoSandbox(sandbox, {
          command: `cd /work/app && ${agentCommand}`,
          tmux: true,
        });
      } else {
        // Detached mode: start agent in background (dynamic — contains pipes/redirects)
        await spawnShell(
          sandbox,
          `cd /work/app && nohup ${agentCommand} > /work/agent.log 2>&1 &`,
        );
      }
    } finally {
      // Close our WebSocket connection — the sandbox keeps running
      await sandbox.close();
    }

    // 8. Record in SQLite
    const session: HermesSession = {
      id: sandbox.resolvedId,
      name: options.branchName,
      provider: 'cloud',
      status: 'running',
      agent: options.agent,
      model: options.model,
      prompt: options.prompt,
      branch: options.branchName,
      repo: options.repoInfo?.fullName ?? 'local',
      created: new Date().toISOString(),
      interactive: options.interactive,
      region,
      volumeSlug: rootVolume.slug,
    };

    if (!session.id) {
      log.warn(
        'Session created with empty sandbox ID — status tracking may not work',
      );
    }

    const db = openSessionDb();
    upsertSession(db, session);

    return options.interactive ? null : session;
  }

  async createShell(options: CreateShellSandboxOptions): Promise<void> {
    const client = await this.getClient();
    const region = await this.resolveRegion();
    const baseSnapshot = await this.ensureImage();

    // Create an ephemeral root volume from the base snapshot so installed
    // tools are visible (snapshot-direct boot uses a read-only overlay).
    const shellVolume = await client.createVolume({
      slug: denoSlug('hsh'),
      region,
      capacity: '10GiB',
      from: baseSnapshot,
    });

    const sandbox = await client.createSandbox({
      region: region as 'ord' | 'ams',
      root: shellVolume.slug,
      timeout: '30m',
      memory: '2GiB',
      labels: { 'hermes.managed': 'true' },
    });

    try {
      // Inject credentials
      await injectCredentials(sandbox);
      await spawnShell(sandbox, 'mkdir -p /work');

      // Clone repo if available
      if (options.repoInfo && options.isGitRepo !== false) {
        const fullName = options.repoInfo.fullName;
        await spawnShell(
          sandbox,
          `cd /work && gh auth setup-git && gh repo clone ${shellEscape(fullName)} app`,
        );
      }

      // SSH into the sandbox
      await sshIntoSandbox(sandbox);
    } finally {
      // Kill sandbox after shell exits
      try {
        await sandbox.kill();
      } catch {
        // Best-effort cleanup
      }
      // Clean up ephemeral volume
      try {
        await client.deleteVolume(shellVolume.id);
      } catch {
        // Best-effort cleanup
      }
    }
  }

  async resume(
    sessionId: string,
    options: ResumeSandboxOptions,
  ): Promise<string> {
    const client = await this.getClient();
    const db = openSessionDb();

    const existing = dbGetSession(db, sessionId);
    if (!existing?.snapshotSlug && !existing?.volumeSlug) {
      throw new Error(
        'No resume snapshot or volume available for this session',
      );
    }

    // Check region consistency — volumes/snapshots must stay in the same region
    const currentRegion = await this.resolveRegion();
    if (existing.region && existing.region !== currentRegion) {
      log.warn(
        { sessionRegion: existing.region, currentRegion },
        'Session region differs from current config region. Using session region.',
      );
    }
    // Use session's original region for consistency (volumes/snapshots are regional)
    const region = existing.region ?? currentRegion;

    // 1. Determine the root volume to boot from.
    //    Preferred: create a new volume from the resume snapshot (CoW).
    //    Fallback:  boot directly from the session's existing volume
    //    (available when stop() snapshot failed but the volume persists).
    let bootVolumeSlug: string;
    let createdNewVolume = false;

    if (existing.snapshotSlug) {
      const resumeVolumeSlug = denoSlug('hr', existing.name);
      const resumeVolume = await client.createVolume({
        slug: resumeVolumeSlug,
        region,
        from: existing.snapshotSlug,
        capacity: '10GiB',
      });
      bootVolumeSlug = resumeVolume.slug;
      createdNewVolume = true;
    } else {
      // No snapshot — boot directly from the existing volume
      bootVolumeSlug = existing.volumeSlug as string;
      log.info(
        { volumeSlug: bootVolumeSlug },
        'No resume snapshot — booting directly from session volume',
      );
    }

    // 2. Boot new sandbox from the resume volume (contains tools + work data)
    let sandbox: ResolvedSandbox;
    try {
      sandbox = await client.createSandbox({
        region: region as 'ord' | 'ams',
        root: bootVolumeSlug,
        timeout: '30m',
        memory: '2GiB',
        labels: {
          'hermes.managed': 'true',
          'hermes.name': existing.name,
          'hermes.agent': existing.agent,
          'hermes.repo': existing.repo,
        },
      });
    } catch (err) {
      // Clean up the orphaned volume (only if we created a new one)
      if (createdNewVolume) {
        try {
          await client.deleteVolume(bootVolumeSlug);
        } catch (delErr) {
          log.debug(
            { err: delErr },
            'Failed to clean up volume after sandbox creation failure',
          );
        }
      }

      const message = (err as { message?: string })?.message ?? String(err);
      if (
        message.includes('limit') ||
        message.includes('concurrent') ||
        message.includes('quota')
      ) {
        const running = dbListSessions(db, {
          provider: 'cloud',
          status: 'running',
        });
        throw new Error(
          `Cloud sandbox limit reached (${running.length} running). ` +
            'Stop a running session or wait for one to finish.',
        );
      }
      throw err;
    }

    try {
      // 3. Inject fresh credentials
      await injectCredentials(sandbox);

      // 4. Start agent with continue flag or open shell
      const agent = existing.agent as AgentType;
      const model = options.model ?? existing.model;
      const modelArg = model ? ` --model ${model}` : '';
      const extraArgs = options.agentArgs?.length
        ? ` ${options.agentArgs.join(' ')}`
        : '';

      if (options.mode === 'shell') {
        await sshIntoSandbox(sandbox);
      } else if (options.mode === 'interactive') {
        // Interactive resume: launch agent with continue flag
        let agentCmd: string;
        if (agent === 'claude') {
          const hasPlanArgs =
            options.agentArgs?.includes('--permission-mode') ?? false;
          const skipPermsFlag = hasPlanArgs
            ? '--allow-dangerously-skip-permissions'
            : '--dangerously-skip-permissions';
          agentCmd = `claude -c${extraArgs}${modelArg} ${skipPermsFlag}`;
        } else {
          agentCmd = `opencode${modelArg}${extraArgs}`;
        }
        await sshIntoSandbox(sandbox, {
          command: `cd /work/app && ${agentCmd}`,
          tmux: true,
        });
      } else {
        // Detached: run agent in background with continue flag
        let agentCmd: string;
        if (agent === 'claude') {
          const hasPlanArgs =
            options.agentArgs?.includes('--permission-mode') ?? false;
          const skipPermsFlag = hasPlanArgs
            ? '--allow-dangerously-skip-permissions'
            : '--dangerously-skip-permissions';
          const promptArg = ' -p';
          agentCmd = `claude -c${promptArg}${extraArgs}${modelArg} ${skipPermsFlag}`;
        } else {
          agentCmd = `opencode${modelArg}${extraArgs} run -c`;
        }

        if (options.prompt) {
          const b64 = Buffer.from(options.prompt).toString('base64');
          agentCmd = `echo '${b64}' | base64 -d | ${agentCmd}`;
        }

        // Dynamic command — contains pipes/redirects
        await spawnShell(
          sandbox,
          `cd /work/app && nohup ${agentCmd} > /work/agent.log 2>&1 &`,
        );
      }
    } finally {
      await sandbox.close();
    }

    // 5. Update SQLite
    const newSession: HermesSession = {
      id: sandbox.resolvedId,
      name: existing.name,
      provider: 'cloud',
      status: 'running',
      agent: existing.agent as AgentType,
      model: options.model ?? existing.model,
      prompt: options.prompt ?? existing.prompt,
      branch: existing.branch,
      repo: existing.repo,
      created: new Date().toISOString(),
      interactive: options.mode === 'interactive' || options.mode === 'shell',
      region,
      volumeSlug: bootVolumeSlug,
      resumedFrom: sessionId,
    };
    upsertSession(db, newSession);

    return sandbox.resolvedId;
  }

  // --------------------------------------------------------------------------
  // Session Management
  // --------------------------------------------------------------------------

  async list(): Promise<HermesSession[]> {
    const db = openSessionDb();

    // Get sessions from SQLite
    const dbSessions = dbListSessions(db, { provider: 'cloud' });

    // If we have a client, try to sync status from Deno API
    try {
      const client = await this.getClient();
      const runningSandboxes = await client.listSandboxes({
        'hermes.managed': 'true',
      });

      const runningIds = new Set(runningSandboxes.map((s) => s.id));

      // Update status for sessions that are no longer running
      for (const session of dbSessions) {
        if (session.status === 'running' && !runningIds.has(session.id)) {
          updateSessionStatus(db, session.id, 'exited');
          session.status = 'exited';
        }
      }
    } catch (err) {
      log.debug({ err }, 'Failed to sync cloud session status');
    }

    return dbSessions;
  }

  async get(sessionId: string): Promise<HermesSession | null> {
    const db = openSessionDb();
    return dbGetSession(db, sessionId);
  }

  async remove(sessionId: string): Promise<void> {
    const db = openSessionDb();
    const session = dbGetSession(db, sessionId);

    // Best-effort cleanup of cloud resources.  Always remove the local
    // session record afterwards — cloud resources have TTLs and can be
    // cleaned up manually if individual deletes fail.
    try {
      const client = await this.getClient();

      // Kill sandbox if running
      try {
        await client.killSandbox(sessionId);
      } catch (err) {
        log.debug({ err, sessionId }, 'Failed to kill sandbox during remove');
      }

      // Delete snapshot BEFORE volume (snapshots depend on their source
      // volume — the API rejects volume deletion while snapshots exist).
      if (session?.snapshotSlug) {
        try {
          await client.deleteSnapshot(session.snapshotSlug);
        } catch (err) {
          log.debug(
            { err, snapshotSlug: session.snapshotSlug },
            'Failed to delete snapshot during remove',
          );
        }
      }

      // Delete volume (may fail if another session's snapshot references
      // it — that's expected and fine).
      if (session?.volumeSlug) {
        try {
          await client.deleteVolume(session.volumeSlug);
        } catch (err) {
          log.debug(
            { err, volumeSlug: session.volumeSlug },
            'Failed to delete volume during remove',
          );
        }
      }
    } catch (err) {
      log.debug({ err, sessionId }, 'Failed to initialize cloud cleanup');
    }

    // Always remove from local DB regardless of cleanup results
    dbDeleteSession(db, sessionId);
  }

  async stop(sessionId: string): Promise<void> {
    const db = openSessionDb();
    const session = dbGetSession(db, sessionId);
    const client = await this.getClient();

    // 1. Kill sandbox first (detaches the volume so it can be snapshotted)
    await client.killSandbox(sessionId);
    updateSessionStatus(db, sessionId, 'stopped');

    // 2. Best-effort snapshot for resume.  The volume is still available
    //    for direct boot even if the snapshot fails, so this is non-fatal.
    if (session?.volumeSlug) {
      const snapshotSlug = denoSlug('hsnap', session.name);
      try {
        await client.snapshotVolume(session.volumeSlug, {
          slug: snapshotSlug,
        });
        updateSessionSnapshot(db, sessionId, snapshotSlug);
      } catch (err) {
        log.warn(
          { err, volumeSlug: session.volumeSlug },
          'Failed to snapshot volume after stop — resume will boot from volume directly',
        );
      }
    }
  }

  // --------------------------------------------------------------------------
  // Interactive Access
  // --------------------------------------------------------------------------

  async attach(sessionId: string): Promise<void> {
    const token = await getDenoToken();
    if (!token) throw new Error('No Deno Deploy token available');
    const sandbox = await new DenoApiClient(token).connectSandbox(sessionId);
    try {
      // Reattach to the tmux session where the agent is running
      await sshIntoSandbox(sandbox, { tmux: true });
    } finally {
      await sandbox.close();
    }
  }

  async shell(sessionId: string): Promise<void> {
    // Open a plain SSH shell (no tmux) for manual debugging
    const token = await getDenoToken();
    if (!token) throw new Error('No Deno Deploy token available');
    const sandbox = await new DenoApiClient(token).connectSandbox(sessionId);
    try {
      await sshIntoSandbox(sandbox);
    } finally {
      await sandbox.close();
    }
  }

  // --------------------------------------------------------------------------
  // Logs
  // --------------------------------------------------------------------------

  async getLogs(sessionId: string, tail?: number): Promise<string> {
    try {
      const token = await getDenoToken();
      if (!token) return '';
      const sandbox = await new DenoApiClient(token).connectSandbox(sessionId);
      try {
        const content = await sandbox.fs.readTextFile('/work/agent.log');
        if (tail) {
          const lines = content.split('\n');
          return lines.slice(-tail).join('\n');
        }
        return content;
      } finally {
        await sandbox.close();
      }
    } catch (err) {
      log.debug({ err }, 'Failed to read cloud sandbox logs');
      return '';
    }
  }

  streamLogs(sessionId: string): LogStream {
    let stopped = false;
    let lastOffset = 0;

    const stop = () => {
      stopped = true;
    };

    async function* generateLines(): AsyncIterable<string> {
      while (!stopped) {
        try {
          const token = await getDenoToken();
          if (!token) break;

          // Connect, read, disconnect on each poll
          const sandbox = await new DenoApiClient(token).connectSandbox(
            sessionId,
          );
          let content: string;
          try {
            content = await sandbox.fs.readTextFile('/work/agent.log');
          } finally {
            await sandbox.close();
          }

          const newContent = content.substring(lastOffset);
          lastOffset = content.length;

          if (newContent) {
            const lines = newContent.split('\n');
            for (const line of lines) {
              if (line) yield line;
            }
          }
        } catch {
          // File might not exist yet or sandbox may be gone
        }

        // Poll every 2 seconds
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    return { lines: generateLines(), stop };
  }
}
