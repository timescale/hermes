// ============================================================================
// Prompt History Store - Zustand store for prompt history navigation
// ============================================================================

import { create } from 'zustand';
import type { PromptHistoryEntry } from '../services/promptHistoryDb.ts';
import {
  addPromptHistoryEntry,
  getPromptHistoryCount,
  getRecentPrompts,
} from '../services/promptHistoryDb.ts';
import { openSessionDb } from '../services/sandbox/sessionDb.ts';

const PAGE_SIZE = 50;

export interface PromptHistoryState {
  /** The user's in-progress prompt text (survives screen switches) */
  draft: string;
  /** Window of recent prompts loaded from DB, newest first */
  entries: PromptHistoryEntry[];
  /** -1 = viewing draft, 0..N = index into entries array */
  cursor: number;
  /** Whether older entries exist in DB beyond what's loaded */
  hasMore: boolean;
  /** Whether the store has been initialized from DB */
  initialized: boolean;

  /** Update the in-progress draft text */
  setDraft: (text: string) => void;
  /** Record a submitted prompt: persist to DB, prepend to entries, clear draft */
  addEntry: (prompt: string) => void;
  /**
   * Move cursor toward older entries.
   * Returns the prompt text to display, or null if already at the oldest loaded
   * entry with no more to fetch.
   */
  navigateUp: () => string | null;
  /**
   * Move cursor toward newer entries / draft.
   * Returns the text to display, or null if already viewing the draft.
   */
  navigateDown: () => string | null;
  /** Get the text that should currently be displayed based on cursor position */
  currentText: () => string;
  /** Reset cursor to draft position (-1) without clearing draft */
  resetCursor: () => void;
  /** Load the initial window of recent prompts from DB */
  initialize: () => void;
}

export const usePromptHistoryStore = create<PromptHistoryState>()(
  (set, get) => ({
    draft: '',
    entries: [],
    cursor: -1,
    hasMore: false,
    initialized: false,

    setDraft: (text: string) => {
      set({ draft: text });
    },

    addEntry: (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed) return;

      const db = openSessionDb();
      addPromptHistoryEntry(db, trimmed);

      const { entries } = get();

      // Skip prepending if it would be a consecutive duplicate
      const newest = entries[0];
      if (newest && newest.prompt === trimmed) {
        set({ draft: '', cursor: -1 });
        return;
      }

      // Prepend the new entry with a synthetic id (actual id from DB not needed
      // for navigation — it just needs to be higher than any existing entry id)
      const syntheticId = newest ? newest.id + 1 : 1;
      const entry: PromptHistoryEntry = {
        id: syntheticId,
        prompt: trimmed,
        createdAt: new Date().toISOString(),
      };

      set({
        entries: [entry, ...entries],
        draft: '',
        cursor: -1,
      });
    },

    navigateUp: () => {
      const { cursor, entries, hasMore } = get();
      const nextCursor = cursor + 1;

      if (nextCursor < entries.length) {
        set({ cursor: nextCursor });
        return entries[nextCursor]?.prompt ?? null;
      }

      // At the end of loaded entries — try to fetch more
      if (hasMore) {
        const db = openSessionDb();
        const lastEntry = entries[entries.length - 1];
        const moreEntries = getRecentPrompts(db, PAGE_SIZE, lastEntry?.id);
        const totalCount = getPromptHistoryCount(db);
        const allEntries = [...entries, ...moreEntries];

        if (nextCursor < allEntries.length) {
          set({
            entries: allEntries,
            hasMore: allEntries.length < totalCount,
            cursor: nextCursor,
          });
          return allEntries[nextCursor]?.prompt ?? null;
        }

        // No more entries even after fetch
        set({
          entries: allEntries,
          hasMore: false,
        });
      }

      return null;
    },

    navigateDown: () => {
      const { cursor, entries, draft } = get();

      if (cursor <= -1) {
        // Already viewing draft
        return null;
      }

      if (cursor === 0) {
        // Move back to draft
        set({ cursor: -1 });
        return draft;
      }

      // Move toward newer entries
      const nextCursor = cursor - 1;
      set({ cursor: nextCursor });
      return entries[nextCursor]?.prompt ?? null;
    },

    currentText: () => {
      const { cursor, entries, draft } = get();
      if (cursor === -1) return draft;
      return entries[cursor]?.prompt ?? draft;
    },

    resetCursor: () => {
      set({ cursor: -1 });
    },

    initialize: () => {
      if (get().initialized) return;

      const db = openSessionDb();
      const entries = getRecentPrompts(db, PAGE_SIZE);
      const totalCount = getPromptHistoryCount(db);

      set({
        entries,
        hasMore: entries.length < totalCount,
        initialized: true,
      });
    },
  }),
);
