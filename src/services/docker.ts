// ============================================================================
// Docker Container Service
// ============================================================================

import { homedir } from 'node:os';
import { join } from 'node:path';
import { formatShellError, type ShellError } from '../utils';
import type { RepoInfo } from './git';

export type AgentType = 'claude' | 'opencode';

export interface StartContainerOptions {
  branchName: string;
  prompt: string;
  repoInfo: RepoInfo;
  agent: AgentType;
  detach: boolean;
  interactive: boolean;
  envVars?: Record<string, string>;
}

export async function startContainer(
  options: StartContainerOptions,
): Promise<string | null> {
  const { branchName, prompt, repoInfo, agent, detach, interactive, envVars } =
    options;

  const conductorEnvPath = '.conductor/.env';
  const conductorEnvFile = Bun.file(conductorEnvPath);

  // Create empty .conductor/.env if it doesn't exist
  if (!(await conductorEnvFile.exists())) {
    await Bun.write(conductorEnvPath, '');
  }

  const containerName = `conductor-${branchName}`;

  // Build env var arguments for docker run
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

  // Build the agent command based on the selected agent type and mode
  const agentCommand =
    agent === 'claude'
      ? `claude${interactive ? '' : ' -p'} --dangerously-skip-permissions`
      : `opencode ${interactive ? '--prompt' : 'run'}`;

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
        --env-file ${conductorEnvPath} \
        ${envArgs} \
        ${volumeArgs} \
        conductor-sandbox \
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
        '--env-file',
        conductorEnvPath,
        ...envArgs,
        ...volumeArgs,
        'conductor-sandbox',
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
