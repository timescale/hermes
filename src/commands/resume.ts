// ============================================================================
// Resume Command - Resume a stopped hermes agent
// ============================================================================

import { Command } from 'commander';
import { getDefaultProvider } from '../services/sandbox';

export async function resumeAction(
  containerId: string,
  prompt: string | undefined,
  options: { detach?: boolean; shell?: boolean },
): Promise<void> {
  if (options.detach && (!prompt || prompt.trim().length === 0)) {
    console.error('Error: prompt is required for detached resume');
    process.exit(1);
  }

  if (options.detach && options.shell) {
    console.error('Error: --detach and --shell cannot be used together');
    process.exit(1);
  }

  const provider = await getDefaultProvider();
  const sessions = await provider.list();
  const resolvedSession = sessions.find(
    (session) => session.name === containerId,
  );
  const fallbackSession = sessions.find(
    (session) =>
      session.containerName === containerId || session.id === containerId,
  );
  const targetId = resolvedSession?.id ?? fallbackSession?.id ?? containerId;

  try {
    const mode = options.shell
      ? 'shell'
      : options.detach
        ? 'detached'
        : 'interactive';
    const result = await provider.resume(targetId, {
      mode,
      prompt,
    });
    if (mode === 'detached') {
      console.log(`Resumed container started: ${result.substring(0, 12)}`);
    }
  } catch (err) {
    console.error(`Failed to resume: ${err}`);
    process.exit(1);
  }
}

export const resumeCommand = new Command('resume')
  .description('Resume a stopped hermes session')
  .argument('<session>', 'Session name to resume')
  .argument('[prompt]', 'Prompt for the resumed agent')
  .option('-d, --detach', 'Resume in detached mode (runs agent in background)')
  .option('-s, --shell', 'Resume with a bash shell instead of the agent')
  .action(resumeAction);
