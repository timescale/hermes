// ============================================================================
// Docker Container Service
// ============================================================================

import { homedir } from 'node:os';
import { join } from 'node:path';
// Import the Dockerfile as text - Bun's bundler embeds this in the binary
import SANDBOX_DOCKERFILE from '../../sandbox/Dockerfile' with { type: 'text' };
import { formatShellError, type ShellError } from '../utils';
import type { AgentType } from './config';
import type { RepoInfo } from './git';

// Compute MD5 hash of the Dockerfile content for versioned tagging
const hasher = new Bun.CryptoHasher('md5');
hasher.update(SANDBOX_DOCKERFILE);
const dockerfileHash = hasher.digest('hex').slice(0, 12);

const DOCKER_IMAGE_NAME = 'conductor-sandbox';
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

  const conductorEnvPath = '.conductor/.env';
  const conductorEnvFile = Bun.file(conductorEnvPath);

  // Create empty .conductor/.env if it doesn't exist
  if (!(await conductorEnvFile.exists())) {
    await Bun.write(conductorEnvPath, '');
  }

  const containerName = `conductor-${branchName}`;

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
git switch -c "conductor/${branchName}"
exec ${agentCommand} \\
  "${prompt.replace(/"/g, '\\"')}

Use the \\\`gh\\\` command to create a PR when done."
`.trim();

  try {
    if (detach) {
      const result = await Bun.$`docker run -d \
        --name ${containerName} \
        ${hostEnvArgs} \
        --env-file ${conductorEnvPath} \
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
        ...hostEnvArgs,
        '--env-file',
        conductorEnvPath,
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
