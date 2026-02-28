// ============================================================================
// Prompt History Store - Zustand store for prompt history navigation
//
// Mirrors opencode's history design:
//   index  0  → current input (no history selected)
//   index -1  → most recent history entry
//   index -2  → second most recent, etc.
// Uses Array.at() for negative indexing.
// ============================================================================

import { create } from 'zustand';
import type { PromptHistoryEntry } from '../services/promptHistoryDb.ts';
import {
  addPromptHistoryEntry,
  getRecentPrompts,
} from '../services/promptHistoryDb.ts';
import { openSessionDb } from '../services/sandbox/sessionDb.ts';

const PAGE_SIZE = 50;

export interface PromptHistoryState {
  /** All loaded history entries, oldest first (chronological order) */
  entries: PromptHistoryEntry[];
  /**
   * Navigation index.
   *  0  = current input (no history selected)
   * -1  = most recent entry
   * -2  = second most recent, etc.
   */
  index: number;
  /** Whether the store has been initialized from DB */
  initialized: boolean;

  /** Record a submitted prompt: persist to DB, append to entries, reset index */
  addEntry: (prompt: string) => void;
  /**
   * Move through history.
   * @param direction  -1 = older (up arrow), 1 = newer (down arrow)
   * @param currentInput  The current text in the textarea
   * @returns The prompt text to display, or undefined if navigation is blocked
   */
  move: (direction: -1 | 1, currentInput: string) => string | undefined;
  /** Load the initial window of recent prompts from DB */
  initialize: () => void;
}

export const usePromptHistoryStore = create<PromptHistoryState>()(
  (set, get) => ({
    entries: [],
    index: 0,
    initialized: false,

    addEntry: (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed) return;

      const db = openSessionDb();
      addPromptHistoryEntry(db, trimmed);

      const { entries } = get();

      // Skip appending if it would be a consecutive duplicate
      const newest = entries[entries.length - 1];
      if (newest && newest.prompt === trimmed) {
        set({ index: 0 });
        return;
      }

      // Append with a synthetic id
      const syntheticId = newest ? newest.id + 1 : 1;
      const entry: PromptHistoryEntry = {
        id: syntheticId,
        prompt: trimmed,
        createdAt: new Date().toISOString(),
      };

      set({
        entries: [...entries, entry],
        index: 0,
      });
    },

    move: (direction: -1 | 1, currentInput: string) => {
      const { entries, index } = get();
      if (!entries.length) return undefined;

      // If we're on a history entry, check that the current input still matches.
      // If the user has edited it, block navigation (like opencode).
      const current = entries.at(index);
      if (current && current.prompt !== currentInput && currentInput.length) {
        return undefined;
      }

      const next = index + direction;

      // Don't go beyond the oldest entry
      if (Math.abs(next) > entries.length) return undefined;
      // Don't go past 0 (current input)
      if (next > 0) return undefined;

      set({ index: next });

      // index 0 → return empty string (back to current input)
      if (next === 0) return '';
      return entries.at(next)?.prompt;
    },

    initialize: () => {
      if (get().initialized) return;

      const db = openSessionDb();
      // getRecentPrompts returns newest-first; reverse to get chronological order
      const rows = getRecentPrompts(db, PAGE_SIZE);
      const entries = rows.reverse();

      set({
        entries,
        initialized: true,
      });
    },
  }),
);
