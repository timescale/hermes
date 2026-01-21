// ============================================================================
// Docker Container Service
// ============================================================================

import { homedir } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
// Import the Dockerfile as text - Bun's bundler embeds this in the binary
import SANDBOX_DOCKERFILE from '../../sandbox/Dockerfile' with { type: 'text' };
import { formatShellError, type ShellError } from '../utils';
import type { AgentType } from './config';
import type { RepoInfo } from './git';

// Compute MD5 hash of the Dockerfile content for versioned tagging
const hasher = new Bun.CryptoHasher('md5');
hasher.update(SANDBOX_DOCKERFILE);
const dockerfileHash = hasher.digest('hex').slice(0, 12);

const DOCKER_IMAGE_NAME = 'hermes-sandbox';
const DOCKER_IMAGE_TAG = `${DOCKER_IMAGE_NAME}:md5-${dockerfileHash}`;

// ============================================================================
// Docker Image Management
// ============================================================================

async function dockerImageExists(): Promise<boolean> {
  try {
    await Bun.$`docker image inspect ${DOCKER_IMAGE_TAG}`.quiet();
    return true;
  } catch {
    return false;
  }
}

async function buildDockerImage(): Promise<void> {
  // Use Bun.spawn to pipe the Dockerfile content to docker build
  const proc = Bun.spawn(['docker', 'build', '-t', DOCKER_IMAGE_TAG, '-'], {
    stdin: Buffer.from(SANDBOX_DOCKERFILE),
    stdout: 'inherit',
    stderr: 'inherit',
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`Docker build failed with exit code ${exitCode}`);
  }
}

export async function ensureDockerImage(): Promise<void> {
  if (await dockerImageExists()) {
    return;
  }

  console.log(
    `Building Docker image ${DOCKER_IMAGE_TAG} (this may take a while)...`,
  );
  await buildDockerImage();
  console.log('  Docker image built successfully');
}

// ============================================================================
// Container Management
// ============================================================================

export type { AgentType } from './config';

export interface StartContainerOptions {
  branchName: string;
  prompt: string;
  repoInfo: RepoInfo;
  agent: AgentType;
  model?: string;
  detach: boolean;
  interactive: boolean;
  envVars?: Record<string, string>;
}

// ============================================================================
// Container Listing and Status
// ============================================================================

export interface HermesSession {
  containerId: string;
  containerName: string;
  name: string;
  branch: string;
  agent: AgentType;
  model?: string;
  repo: string;
  prompt: string;
  created: string;
  resumedFrom?: string;
  status: 'running' | 'exited' | 'paused' | 'restarting' | 'dead' | 'created';
  exitCode?: number;
  startedAt?: string;
  finishedAt?: string;
}

interface DockerInspectResult {
  Id: string;
  Name: string;
  State: {
    Status: string;
    Running: boolean;
    Paused: boolean;
    Restarting: boolean;
    Dead: boolean;
    ExitCode: number;
    StartedAt: string;
    FinishedAt: string;
  };
  Config: {
    Labels: Record<string, string>;
    Env?: string[];
  };
}

/**
 * List all hermes-managed containers with their metadata
 */
export async function listHermesSessions(): Promise<HermesSession[]> {
  try {
    // Get all containers (running and stopped) with hermes.managed=true label
    const result =
      await Bun.$`docker ps -a --filter label=hermes.managed=true --format {{.ID}}`.quiet();
    const containerIds = result.stdout
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean);

    if (containerIds.length === 0) {
      return [];
    }

    // Inspect each container to get full details
    const inspectResult = await Bun.$`docker inspect ${containerIds}`.quiet();
    const containers: DockerInspectResult[] = JSON.parse(
      inspectResult.stdout.toString(),
    );

    return containers.map((container) => {
      const labels = container.Config.Labels;
      const state = container.State;

      let status: HermesSession['status'];
      if (state.Running) {
        status = 'running';
      } else if (state.Paused) {
        status = 'paused';
      } else if (state.Restarting) {
        status = 'restarting';
      } else if (state.Dead) {
        status = 'dead';
      } else if (state.Status === 'created') {
        status = 'created';
      } else {
        status = 'exited';
      }

      return {
        containerId: container.Id.slice(0, 12),
        containerName: container.Name.replace(/^\//, ''),
        name: labels['hermes.name'] || labels['hermes.branch'] || 'unknown',
        branch: labels['hermes.branch'] || 'unknown',
        agent: (labels['hermes.agent'] as AgentType) || 'opencode',
        model: labels['hermes.model'],
        repo: labels['hermes.repo'] || 'unknown',
        prompt: labels['hermes.prompt'] || '',
        created: labels['hermes.created'] || '',
        resumedFrom: labels['hermes.resumed-from'],
        status,
        exitCode: status === 'exited' ? state.ExitCode : undefined,
        startedAt: state.StartedAt,
        finishedAt: status === 'exited' ? state.FinishedAt : undefined,
      };
    });
  } catch {
    // If docker command fails, return empty array
    return [];
  }
}

/**
 * Remove a hermes container by name or ID
 */
export async function removeContainer(nameOrId: string): Promise<void> {
  let resumeImage: string | null = null;
  try {
    const result = await Bun.$`docker inspect ${nameOrId}`.quiet();
    const containers: DockerInspectResult[] = JSON.parse(
      result.stdout.toString(),
    );
    const container = containers[0];
    if (container) {
      resumeImage = container.Config.Labels?.['hermes.resume-image'] ?? null;
    }
  } catch {
    resumeImage = null;
  }

  await Bun.$`docker rm -f ${nameOrId}`.quiet();

  if (resumeImage) {
    try {
      await Bun.$`docker rmi ${resumeImage}`.quiet();
    } catch {
      // Ignore image removal errors
    }
  }
}

/**
 * Stop a running container gracefully
 */
export async function stopContainer(nameOrId: string): Promise<void> {
  await Bun.$`docker stop ${nameOrId}`.quiet();
}

/**
 * Get container logs (static snapshot)
 */
export async function getContainerLogs(
  nameOrId: string,
  tail?: number,
): Promise<string> {
  const tailArg = tail ? ['--tail', String(tail)] : [];
  const result = await Bun.$`docker logs ${tailArg} ${nameOrId} 2>&1`.quiet();
  return result.stdout.toString();
}

/**
 * Stream container logs in real-time
 */
export interface LogStream {
  lines: AsyncIterable<string>;
  stop: () => void;
}

// ANSI escape code pattern for stripping color codes
// biome-ignore lint/suspicious/noControlCharactersInRegex: needed for ANSI codes
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

function stripAnsi(str: string): string {
  return str.replace(ANSI_PATTERN, '');
}

export function streamContainerLogs(nameOrId: string): LogStream {
  const proc = Bun.spawn(['docker', 'logs', '-f', nameOrId], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  let stopped = false;

  const stop = () => {
    stopped = true;
    proc.kill();
  };

  async function* generateLines(): AsyncIterable<string> {
    // Combine stdout and stderr
    const decoder = new TextDecoder();
    let buffer = '';

    // Helper to process a stream
    async function* processStream(
      stream: ReadableStream<Uint8Array>,
    ): AsyncIterable<string> {
      const reader = stream.getReader();
      try {
        while (!stopped) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Split by newlines and yield complete lines
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            yield stripAnsi(line);
          }
        }
        // Yield any remaining content
        if (buffer) {
          yield stripAnsi(buffer);
          buffer = '';
        }
      } finally {
        reader.releaseLock();
      }
    }

    // Process both stdout and stderr
    if (proc.stdout) {
      yield* processStream(proc.stdout);
    }
    if (proc.stderr) {
      yield* processStream(proc.stderr);
    }
  }

  return {
    lines: generateLines(),
    stop,
  };
}

/**
 * Attach to a running container interactively.
 * This replaces the current process with docker attach.
 */
export async function attachToContainer(nameOrId: string): Promise<void> {
  const proc = Bun.spawn(['docker', 'exec', '-it', nameOrId, '/bin/bash'], {
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  await proc.exited;
}

// ============================================================================
// Container Resume
// ============================================================================

export interface ResumeSessionOptions {
  mode: 'interactive' | 'detached';
  prompt?: string;
}

function buildResumeAgentCommand(
  agent: AgentType,
  mode: ResumeSessionOptions['mode'],
  model?: string,
): string {
  const modelArg = model ? ` --model ${model}` : '';

  if (agent === 'claude') {
    const promptArg = mode === 'detached' ? ' -p' : '';
    return `claude -c${promptArg}${modelArg} --dangerously-skip-permissions`;
  }

  if (mode === 'detached') {
    return `opencode${modelArg} run -c`;
  }

  return `opencode${modelArg} -c`;
}

export async function resumeSession(
  nameOrId: string,
  options: ResumeSessionOptions,
): Promise<string> {
  const { mode, prompt } = options;

  if (mode === 'detached' && (!prompt || prompt.trim().length === 0)) {
    throw new Error('Prompt is required for detached resume');
  }

  let container: DockerInspectResult | undefined;
  try {
    const result = await Bun.$`docker inspect ${nameOrId}`.quiet();
    const containers: DockerInspectResult[] = JSON.parse(
      result.stdout.toString(),
    );
    container = containers[0];
  } catch {
    throw new Error(`Container ${nameOrId} not found`);
  }

  if (!container) {
    throw new Error(`Container ${nameOrId} not found`);
  }

  const labels = container.Config.Labels ?? {};
  if (labels['hermes.managed'] !== 'true') {
    throw new Error('Container is not managed by hermes');
  }

  if (container.State?.Running) {
    throw new Error('Container is already running');
  }

  const agent = (labels['hermes.agent'] as AgentType) || 'opencode';
  const model = labels['hermes.model'];
  const resumeSuffix = nanoid(6).toLowerCase();
  const resumeImage = `hermes-resume:${container.Id.slice(0, 12)}-${resumeSuffix}`;

  try {
    await Bun.$`docker commit ${container.Id} ${resumeImage}`.quiet();
  } catch (err) {
    throw formatShellError(err as ShellError);
  }

  const envArgs: string[] = [];
  for (const envVar of container.Config.Env ?? []) {
    envArgs.push('-e', envVar);
  }

  const baseName = container.Name.replace(/\//g, '').trim();
  const containerName = `${baseName}-resumed-${resumeSuffix}`;

  const resumePrompt =
    mode === 'detached' ? prompt?.trim() || '' : labels['hermes.prompt'] || '';
  const baseSessionName =
    labels['hermes.name'] || labels['hermes.branch'] || 'session';
  const resumeName = `${baseSessionName}-resumed-${resumeSuffix}`;
  const agentCommand = buildResumeAgentCommand(agent, mode, model);
  const resumeScript =
    mode === 'detached' && prompt
      ? `
set -e
cd /work/app
exec ${agentCommand} <<'HERMES_PROMPT_HEREDOC'
${prompt}

HERMES_PROMPT_HEREDOC
`.trim()
      : `
set -e
cd /work/app
exec ${agentCommand}
`.trim();

  const labelArgs: string[] = [
    '--label',
    'hermes.managed=true',
    '--label',
    `hermes.name=${resumeName}`,
    '--label',
    `hermes.branch=${labels['hermes.branch'] ?? 'unknown'}`,
    '--label',
    `hermes.agent=${agent}`,
    '--label',
    `hermes.repo=${labels['hermes.repo'] ?? 'unknown'}`,
    '--label',
    `hermes.created=${new Date().toISOString()}`,
    '--label',
    `hermes.prompt=${resumePrompt}`,
    '--label',
    `hermes.resumed-from=${container.Name.replace(/^\//, '')}`,
    '--label',
    `hermes.resume-image=${resumeImage}`,
  ];
  if (model) {
    labelArgs.push('--label', `hermes.model=${model}`);
  }

  try {
    if (mode === 'detached') {
      const result = await Bun.$`docker run -d \
        --name ${containerName} \
        ${labelArgs} \
        ${envArgs} \
        ${resumeImage} \
        bash -c ${resumeScript}`.quiet();
      return result.stdout.toString().trim();
    }

    const proc = Bun.spawn(
      [
        'docker',
        'run',
        '-it',
        '--name',
        containerName,
        ...labelArgs,
        ...envArgs,
        resumeImage,
        'bash',
        '-c',
        resumeScript,
      ],
      {
        stdio: ['inherit', 'inherit', 'inherit'],
      },
    );
    await proc.exited;
    return containerName;
  } catch (err) {
    throw formatShellError(err as ShellError);
  }
}

/**
 * Get a single session by container ID or name
 */
export async function getSession(
  nameOrId: string,
): Promise<HermesSession | null> {
  try {
    const result = await Bun.$`docker inspect ${nameOrId}`.quiet();
    const containers: DockerInspectResult[] = JSON.parse(
      result.stdout.toString(),
    );

    const container = containers[0];
    if (!container) {
      return null;
    }

    const labels = container.Config.Labels;

    // Check if this is a hermes-managed container
    if (labels['hermes.managed'] !== 'true') {
      return null;
    }

    const state = container.State;

    let status: HermesSession['status'];
    if (state.Running) {
      status = 'running';
    } else if (state.Paused) {
      status = 'paused';
    } else if (state.Restarting) {
      status = 'restarting';
    } else if (state.Dead) {
      status = 'dead';
    } else if (state.Status === 'created') {
      status = 'created';
    } else {
      status = 'exited';
    }

    return {
      containerId: container.Id.slice(0, 12),
      containerName: container.Name.replace(/^\//, ''),
      name: labels['hermes.name'] || labels['hermes.branch'] || 'unknown',
      branch: labels['hermes.branch'] || 'unknown',
      agent: (labels['hermes.agent'] as AgentType) || 'opencode',
      model: labels['hermes.model'],
      repo: labels['hermes.repo'] || 'unknown',
      prompt: labels['hermes.prompt'] || '',
      created: labels['hermes.created'] || '',
      resumedFrom: labels['hermes.resumed-from'],
      status,
      exitCode: status === 'exited' ? state.ExitCode : undefined,
      startedAt: state.StartedAt,
      finishedAt: status === 'exited' ? state.FinishedAt : undefined,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// Container Creation
// ============================================================================

export async function startContainer(
  options: StartContainerOptions,
): Promise<string | null> {
  const {
    branchName,
    prompt,
    repoInfo,
    agent,
    model,
    detach,
    interactive,
    envVars,
  } = options;

  const hermesEnvPath = '.hermes/.env';
  const hermesEnvFile = Bun.file(hermesEnvPath);

  // Create empty .hermes/.env if it doesn't exist
  if (!(await hermesEnvFile.exists())) {
    await Bun.write(hermesEnvPath, '');
  }

  const containerName = `hermes-${branchName}`;

  // Build env var arguments for docker run
  // Order matters for precedence: later values override earlier ones
  // Precedence (lowest to highest): hostEnvArgs -> --env-file -> envArgs

  // Pass through API keys from host environment (lowest precedence)
  const hostEnvArgs: string[] = [];
  const apiKeysToPassthrough = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'];
  for (const key of apiKeysToPassthrough) {
    const value = process.env[key];
    if (value) {
      hostEnvArgs.push('-e', `${key}=${value}`);
    }
  }

  // Explicit env vars passed to startContainer (highest precedence)
  const envArgs: string[] = [];
  for (const [key, value] of Object.entries(envVars ?? {})) {
    envArgs.push('-e', `${key}=${value}`);
  }

  // Check if opencode auth.json exists on host and prepare mount args
  const opencodeConfigDir = join(homedir(), '.local', 'share', 'opencode');
  const opencodeAuthFile = Bun.file(join(opencodeConfigDir, 'auth.json'));
  const hasOpencodeAuth = await opencodeAuthFile.exists();
  const volumeArgs: string[] = [];
  if (hasOpencodeAuth) {
    // Mount the directory read-only to a temp location
    volumeArgs.push('-v', `${opencodeConfigDir}:/tmp/opencode-cfg:ro`);
  }

  // Build the agent command based on the selected agent type, model, and mode
  const modelArg = model ? ` --model ${model}` : '';
  const agentCommand =
    agent === 'claude'
      ? `claude${interactive ? '' : ' -p'}${modelArg} --dangerously-skip-permissions`
      : `opencode${modelArg} ${interactive ? '--prompt' : 'run'}`;

  // Build the startup script that:
  // 1. Copies opencode auth.json if mounted
  // 2. Clones the repo using gh
  // 3. Creates and checks out the new branch
  // 4. Runs the selected agent with the prompt
  const opencodeAuthSetup = hasOpencodeAuth
    ? `
mkdir -p ~/.local/share/opencode
cp /tmp/opencode-cfg/auth.json ~/.local/share/opencode/auth.json
`.trim()
    : '';

  const startupScript = `
set -e
${opencodeAuthSetup}
cd /work
 gh auth setup-git
 gh repo clone ${repoInfo.fullName} app
 cd app
 git switch -c "hermes/${branchName}"
 exec ${agentCommand} <<'HERMES_PROMPT_HEREDOC'
${prompt}

Use the \`gh\` command to create a PR when done.
HERMES_PROMPT_HEREDOC
`.trim();

  // Build label arguments for hermes metadata
  const labelArgs: string[] = [
    '--label',
    'hermes.managed=true',
    '--label',
    `hermes.name=${branchName}`,
    '--label',
    `hermes.branch=${branchName}`,
    '--label',
    `hermes.agent=${agent}`,
    '--label',
    `hermes.repo=${repoInfo.fullName}`,
    '--label',
    `hermes.created=${new Date().toISOString()}`,
  ];
  if (model) {
    labelArgs.push('--label', `hermes.model=${model}`);
  }
  // Store the full prompt in label (truncation is done only at display time)
  labelArgs.push('--label', `hermes.prompt=${prompt}`);

  try {
    if (detach) {
      const result = await Bun.$`docker run -d \
        --name ${containerName} \
        ${labelArgs} \
        ${hostEnvArgs} \
        --env-file ${hermesEnvPath} \
        ${envArgs} \
        ${volumeArgs} \
        ${DOCKER_IMAGE_TAG} \
        bash -c ${startupScript}`;
      return result.stdout.toString().trim();
    }

    // Interactive/foreground mode - use Bun.spawn with inherited stdio for proper TTY
    const proc = Bun.spawn(
      [
        'docker',
        'run',
        '-it',
        '--rm',
        '--name',
        containerName,
        ...labelArgs,
        ...hostEnvArgs,
        '--env-file',
        hermesEnvPath,
        ...envArgs,
        ...volumeArgs,
        DOCKER_IMAGE_TAG,
        'bash',
        '-c',
        startupScript,
      ],
      {
        stdio: ['inherit', 'inherit', 'inherit'],
      },
    );
    await proc.exited;
    return null;
  } catch (err) {
    throw formatShellError(err as ShellError);
  }
}
