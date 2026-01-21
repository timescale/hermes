// ============================================================================
// Resume Command - Resume a stopped hermes agent
// ============================================================================

import { Command } from 'commander';
import { listHermesSessions, resumeSession } from '../services/docker';

export async function resumeAction(
  containerId: string,
  prompt: string | undefined,
  options: { detach?: boolean },
): Promise<void> {
  if (options.detach && (!prompt || prompt.trim().length === 0)) {
    console.error('Error: prompt is required for detached resume');
    process.exit(1);
  }

  const sessions = await listHermesSessions();
  const resolvedSession = sessions.find(
    (session) => session.name === containerId,
  );
  const fallbackSession = sessions.find(
    (session) =>
      session.containerName === containerId ||
      session.containerId === containerId,
  );
  const targetId =
    resolvedSession?.containerId ?? fallbackSession?.containerId ?? containerId;

  try {
    const mode = options.detach ? 'detached' : 'interactive';
    const result = await resumeSession(targetId, {
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
  .option('-d, --detach', 'Resume in detached mode')
  .action(resumeAction);
