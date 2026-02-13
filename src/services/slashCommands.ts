// ============================================================================
// Slash Command System
// Defines the slash command interface and built-in commands
// ============================================================================

import fuzzysort from 'fuzzysort';

export interface SlashCommand {
  /** The command name (e.g., "theme" for /theme) */
  name: string;

  /** Short description of what the command does */
  description: string;

  /** Called when the command is selected */
  onSelect: () => void;
}

/**
 * Filter slash commands based on partial input using fuzzy search.
 * Used when user types "/" followed by characters.
 */
export function filterSlashCommands(
  commands: SlashCommand[],
  query: string,
): SlashCommand[] {
  if (!query) return commands;
  return fuzzysort
    .go(query, commands, {
      keys: ['name', 'description'],
      scoreFn: (r) =>
        Math.max(
          r[0]?.score ?? 0, // name (full weight)
          (r[1]?.score ?? 0) * 0.5, // description (reduced)
        ),
      threshold: 0.3,
    })
    .map((r) => r.obj);
}

/**
 * Check if text starts with a slash command.
 * Returns the partial command text (without the "/") or null if not a slash command.
 */
export function parseSlashCommand(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith('/')) {
    // Return everything after the "/" (could be empty)
    return trimmed.slice(1);
  }
  return null;
}
