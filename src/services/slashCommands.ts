// ============================================================================
// Slash Command System
// Defines the slash command interface and built-in commands
// ============================================================================

export interface SlashCommand {
  /** The command name (e.g., "theme" for /theme) */
  name: string;

  /** Short description of what the command does */
  description: string;

  /** Called when the command is selected */
  onSelect: () => void;
}

/**
 * Filter slash commands based on partial input.
 * Used when user types "/" followed by characters.
 */
export function filterSlashCommands(
  commands: SlashCommand[],
  query: string,
): SlashCommand[] {
  const lowerQuery = query.toLowerCase();
  return commands.filter(
    (cmd) =>
      cmd.name.toLowerCase().includes(lowerQuery) ||
      cmd.description.toLowerCase().includes(lowerQuery),
  );
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
