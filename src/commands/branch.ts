// ============================================================================
// Branch Command - Creates feature branch with isolated DB fork and agent
// ============================================================================

import { Command } from 'commander';
import { getConfiguredServiceId } from '../services/config';
import { type ForkResult, forkDatabase } from '../services/db';
import {
  type AgentType,
  ensureDockerImage,
  startContainer,
} from '../services/docker';
import {
  generateBranchName,
  getRepoInfo,
  type RepoInfo,
} from '../services/git';
import { ensureGitignore } from '../utils';

interface BranchOptions {
  serviceId?: string;
  dbFork: boolean;
  agent: AgentType;
  detach: boolean;
  interactive: boolean;
}

function printSummary(
  branchName: string,
  repoInfo: RepoInfo,
  forkResult: ForkResult | null,
): void {
  console.log(`
Repository: ${repoInfo.fullName}
Branch: conductor/${branchName}${
    forkResult
      ? `
Database: ${forkResult.name} (service ID: ${forkResult.service_id})`
      : ''
  }
Container: conductor-${branchName}

To view agent logs:
  docker logs -f conductor-${branchName}

To stop the agent:
  docker stop conductor-${branchName}
`);
}

export async function branchAction(
  prompt: string,
  options: BranchOptions,
): Promise<void> {
  // Validate mutually exclusive options
  if (options.detach && options.interactive) {
    console.error('Error: --detach and --interactive are mutually exclusive');
    process.exit(1);
  }

  // Step 1: Get repo info
  console.log('Getting repository info...');
  const repoInfo = await getRepoInfo();
  console.log(`  Repository: ${repoInfo.fullName}`);

  // Step 2: Generate branch name
  console.log('Generating branch name...');
  const branchName = await generateBranchName(prompt);
  console.log(`  Branch name: ${branchName}`);

  // Step 3: Ensure .gitignore has .conductor/ entry
  await ensureGitignore();

  // Step 4: Determine service ID from options or config
  const effectiveServiceId: string | null | undefined =
    options.serviceId || (await getConfiguredServiceId());

  // Step 5: Fork database (unless --no-db-fork is set or config says null)
  let forkResult: ForkResult | null = null;
  if (!options.dbFork) {
    console.log('Skipping database fork (--no-db-fork)');
  } else if (effectiveServiceId === null) {
    console.log('Skipping database fork (configured as "none" in config)');
  } else {
    console.log('Forking database (this may take a few minutes)...');
    forkResult = await forkDatabase(
      branchName,
      effectiveServiceId || undefined,
    );
    console.log(`  Database fork created: ${forkResult.name}`);
  }

  // Step 6: Ensure Docker image exists (build if missing)
  await ensureDockerImage();

  // Step 7: Start container (repo will be cloned inside container)
  console.log(`Starting agent container (using ${options.agent})...`);
  const containerId = await startContainer({
    branchName,
    prompt,
    repoInfo,
    agent: options.agent,
    detach: options.detach,
    interactive: options.interactive,
    envVars: forkResult?.envVars,
  });

  if (options.detach) {
    console.log(`  Container started: ${containerId?.substring(0, 12)}`);
    // Summary only shown in detached mode
    printSummary(branchName, repoInfo, forkResult);
  } else if (options.interactive) {
    // Interactive mode exited
    console.log(`\n${options.agent} session ended.`);
  }
}

/**
 * Add the standard branch command options to a Command instance
 */
export function withBranchOptions<T extends Command>(cmd: T): T {
  return cmd
    .option(
      '-s, --service-id <id>',
      'Database service ID to fork (defaults to .conductor config or tiger default)',
    )
    .option('--no-db-fork', 'Skip the database fork step')
    .option(
      '-a, --agent <type>',
      'Agent to use: claude or opencode',
      'opencode',
    )
    .option('-d, --detach', 'Run container in background (detached mode)')
    .option('-i, --interactive', 'Run agent in full TUI mode') as T;
}

export const branchCommand = withBranchOptions(
  new Command('branch')
    .description(
      'Create a feature branch with isolated DB fork and start agent sandbox',
    )
    .argument('<prompt>', 'Natural language description of the task'),
).action(branchAction);
