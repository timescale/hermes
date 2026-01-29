// ============================================================================
// Clipboard Utilities
// ============================================================================

import clipboardy from 'clipboardy';
import { log } from './logger';

/**
 * Writes text to clipboard via OSC 52 escape sequence.
 * This allows clipboard operations to work over SSH by having
 * the terminal emulator handle the clipboard locally.
 */
function writeOsc52(text: string): void {
  if (!process.stdout.isTTY) return;
  const base64 = Buffer.from(text).toString('base64');
  const osc52 = `\x1b]52;c;${base64}\x07`;
  // tmux and screen require DCS passthrough wrapping
  const passthrough = process.env.TMUX || process.env.STY;
  const sequence = passthrough ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52;
  process.stdout.write(sequence);
}

/**
 * Copy text to the system clipboard.
 * Uses OSC 52 for SSH/tmux compatibility, plus clipboardy as fallback.
 */
export async function copyToClipboard(text: string): Promise<void> {
  writeOsc52(text);
  await clipboardy.write(text).catch((err) => {
    log.debug({ err }, 'clipboardy.write failed');
  });
}
