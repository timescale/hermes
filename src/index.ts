// ============================================================================
// Hermes CLI - Main Entry Point
// ============================================================================

import { program } from 'commander';
import {
  branchAction,
  branchCommand,
  withBranchOptions,
} from './commands/branch';
import { configCommand } from './commands/config';
import { resumeCommand } from './commands/resume';
import { sessionsCommand } from './commands/sessions';

program
  .name('hermes')
  .description('Automates branch + database fork + agent sandbox creation')
  .version('1.0.0')
  .enablePositionalOptions();

// Make 'branch' the default command by adding same options to root
// This must be done BEFORE adding subcommands so that subcommands take precedence
withBranchOptions(program)
  .argument('[prompt]', 'Natural language description of the task')
  .action(async (prompt, options) => {
    // Only run if prompt is provided (otherwise show help)
    if (prompt) {
      // Guard against accidentally running with an invalid command as prompt
      // Prompt must contain at least one space (more than one word)
      if (!prompt.includes(' ')) {
        console.error(
          `Error: Prompt must be more than one word. Did you mean to run a command?\n`,
        );
        program.help();
        return;
      }
      await branchAction(prompt, options);
    } else {
      program.help();
    }
  });

// Add subcommands (after root options so they take precedence)
program.addCommand(branchCommand);
program.addCommand(configCommand);
program.addCommand(resumeCommand);
program.addCommand(sessionsCommand);

program.parse();
