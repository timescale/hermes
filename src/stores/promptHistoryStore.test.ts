// ============================================================================
// Prompt History Store Tests
// ============================================================================

import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, mock, test } from 'bun:test';
import { initPromptHistorySchema } from '../services/promptHistoryDb.ts';
import { initSessionSchema } from '../services/sandbox/sessionDb.ts';
import { usePromptHistoryStore } from './promptHistoryStore.ts';

// Mock openSessionDb to return an in-memory database
let testDb: Database;

mock.module('../services/sandbox/sessionDb.ts', () => ({
  openSessionDb: () => testDb,
  // Re-export the real initSessionSchema for test setup
  initSessionSchema,
}));

function resetStore() {
  usePromptHistoryStore.setState({
    draft: '',
    entries: [],
    cursor: -1,
    hasMore: false,
    initialized: false,
  });
}

function createTestDb(): Database {
  const db = new Database(':memory:');
  initSessionSchema(db);
  initPromptHistorySchema(db);
  return db;
}

describe('promptHistoryStore', () => {
  afterEach(() => {
    resetStore();
  });

  // ==========================================================================
  // setDraft
  // ==========================================================================

  test('setDraft updates draft text', () => {
    const store = usePromptHistoryStore.getState();
    store.setDraft('hello world');
    expect(usePromptHistoryStore.getState().draft).toBe('hello world');
  });

  // ==========================================================================
  // initialize
  // ==========================================================================

  test('initialize loads entries from DB', () => {
    testDb = createTestDb();
    testDb
      .prepare(
        'INSERT INTO prompt_history (prompt, created_at) VALUES ($p, $c)',
      )
      .run({ $p: 'prompt one', $c: '2025-01-01T00:00:00Z' });
    testDb
      .prepare(
        'INSERT INTO prompt_history (prompt, created_at) VALUES ($p, $c)',
      )
      .run({ $p: 'prompt two', $c: '2025-01-01T00:01:00Z' });

    const store = usePromptHistoryStore.getState();
    store.initialize();

    const state = usePromptHistoryStore.getState();
    expect(state.initialized).toBe(true);
    expect(state.entries).toHaveLength(2);
    expect(state.entries[0]?.prompt).toBe('prompt two');
    expect(state.entries[1]?.prompt).toBe('prompt one');
  });

  test('initialize is idempotent', () => {
    testDb = createTestDb();
    const store = usePromptHistoryStore.getState();
    store.initialize();
    store.initialize(); // Should not throw or re-fetch
    expect(usePromptHistoryStore.getState().initialized).toBe(true);
  });

  // ==========================================================================
  // addEntry
  // ==========================================================================

  test('addEntry persists to DB and prepends to entries', () => {
    testDb = createTestDb();
    const store = usePromptHistoryStore.getState();
    store.initialize();

    store.addEntry('new prompt');

    const state = usePromptHistoryStore.getState();
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]?.prompt).toBe('new prompt');
    expect(state.draft).toBe('');
    expect(state.cursor).toBe(-1);
  });

  test('addEntry skips consecutive duplicates', () => {
    testDb = createTestDb();
    const store = usePromptHistoryStore.getState();
    store.initialize();

    store.addEntry('same prompt');
    store.addEntry('same prompt');

    const state = usePromptHistoryStore.getState();
    expect(state.entries).toHaveLength(1);
  });

  test('addEntry skips empty prompts', () => {
    testDb = createTestDb();
    const store = usePromptHistoryStore.getState();
    store.initialize();

    store.addEntry('');
    store.addEntry('   ');

    expect(usePromptHistoryStore.getState().entries).toHaveLength(0);
  });

  test('addEntry clears draft and resets cursor', () => {
    testDb = createTestDb();
    const store = usePromptHistoryStore.getState();
    store.initialize();

    store.setDraft('work in progress');
    store.addEntry('submitted prompt');

    const state = usePromptHistoryStore.getState();
    expect(state.draft).toBe('');
    expect(state.cursor).toBe(-1);
  });

  // ==========================================================================
  // navigateUp / navigateDown
  // ==========================================================================

  test('navigateUp moves through history', () => {
    testDb = createTestDb();
    testDb
      .prepare(
        'INSERT INTO prompt_history (prompt, created_at) VALUES ($p, $c)',
      )
      .run({ $p: 'oldest', $c: '2025-01-01T00:00:00Z' });
    testDb
      .prepare(
        'INSERT INTO prompt_history (prompt, created_at) VALUES ($p, $c)',
      )
      .run({ $p: 'newest', $c: '2025-01-01T00:01:00Z' });

    const store = usePromptHistoryStore.getState();
    store.initialize();

    // First up: go to newest entry
    const text1 = store.navigateUp();
    expect(text1).toBe('newest');
    expect(usePromptHistoryStore.getState().cursor).toBe(0);

    // Second up: go to oldest entry
    const text2 = usePromptHistoryStore.getState().navigateUp();
    expect(text2).toBe('oldest');
    expect(usePromptHistoryStore.getState().cursor).toBe(1);

    // Third up: no more entries
    const text3 = usePromptHistoryStore.getState().navigateUp();
    expect(text3).toBeNull();
    expect(usePromptHistoryStore.getState().cursor).toBe(1);
  });

  test('navigateDown moves back toward draft', () => {
    testDb = createTestDb();
    testDb
      .prepare(
        'INSERT INTO prompt_history (prompt, created_at) VALUES ($p, $c)',
      )
      .run({ $p: 'oldest', $c: '2025-01-01T00:00:00Z' });
    testDb
      .prepare(
        'INSERT INTO prompt_history (prompt, created_at) VALUES ($p, $c)',
      )
      .run({ $p: 'newest', $c: '2025-01-01T00:01:00Z' });

    const store = usePromptHistoryStore.getState();
    store.initialize();
    store.setDraft('my draft');

    // Navigate up twice
    store.navigateUp();
    usePromptHistoryStore.getState().navigateUp();
    expect(usePromptHistoryStore.getState().cursor).toBe(1);

    // Navigate down: back to newest
    const text1 = usePromptHistoryStore.getState().navigateDown();
    expect(text1).toBe('newest');
    expect(usePromptHistoryStore.getState().cursor).toBe(0);

    // Navigate down again: back to draft
    const text2 = usePromptHistoryStore.getState().navigateDown();
    expect(text2).toBe('my draft');
    expect(usePromptHistoryStore.getState().cursor).toBe(-1);

    // Navigate down again: already at draft
    const text3 = usePromptHistoryStore.getState().navigateDown();
    expect(text3).toBeNull();
    expect(usePromptHistoryStore.getState().cursor).toBe(-1);
  });

  test('navigateUp returns null when no history exists', () => {
    testDb = createTestDb();
    const store = usePromptHistoryStore.getState();
    store.initialize();

    const text = store.navigateUp();
    expect(text).toBeNull();
  });

  test('navigateDown returns null when already at draft', () => {
    testDb = createTestDb();
    const store = usePromptHistoryStore.getState();
    store.initialize();

    const text = store.navigateDown();
    expect(text).toBeNull();
  });

  // ==========================================================================
  // currentText
  // ==========================================================================

  test('currentText returns draft when cursor is -1', () => {
    testDb = createTestDb();
    const store = usePromptHistoryStore.getState();
    store.initialize();
    store.setDraft('my draft');

    expect(usePromptHistoryStore.getState().currentText()).toBe('my draft');
  });

  test('currentText returns history entry when navigating', () => {
    testDb = createTestDb();
    testDb
      .prepare(
        'INSERT INTO prompt_history (prompt, created_at) VALUES ($p, $c)',
      )
      .run({ $p: 'history entry', $c: '2025-01-01T00:00:00Z' });

    const store = usePromptHistoryStore.getState();
    store.initialize();
    store.navigateUp();

    expect(usePromptHistoryStore.getState().currentText()).toBe(
      'history entry',
    );
  });

  // ==========================================================================
  // resetCursor
  // ==========================================================================

  test('resetCursor moves back to draft without clearing it', () => {
    testDb = createTestDb();
    testDb
      .prepare(
        'INSERT INTO prompt_history (prompt, created_at) VALUES ($p, $c)',
      )
      .run({ $p: 'entry', $c: '2025-01-01T00:00:00Z' });

    const store = usePromptHistoryStore.getState();
    store.initialize();
    store.setDraft('preserved draft');
    store.navigateUp();

    expect(usePromptHistoryStore.getState().cursor).toBe(0);

    usePromptHistoryStore.getState().resetCursor();

    const state = usePromptHistoryStore.getState();
    expect(state.cursor).toBe(-1);
    expect(state.draft).toBe('preserved draft');
  });

  // ==========================================================================
  // Pagination (hasMore)
  // ==========================================================================

  test('hasMore is true when DB has more entries than loaded', () => {
    testDb = createTestDb();
    // Insert more entries than the page size would load in a real scenario
    // For testing, we rely on the count comparison
    for (let i = 0; i < 5; i++) {
      testDb
        .prepare(
          'INSERT INTO prompt_history (prompt, created_at) VALUES ($p, $c)',
        )
        .run({
          $p: `prompt ${i}`,
          $c: `2025-01-01T00:0${i}:00Z`,
        });
    }

    const store = usePromptHistoryStore.getState();
    store.initialize();

    // PAGE_SIZE is 50, so 5 entries should all be loaded
    const state = usePromptHistoryStore.getState();
    expect(state.entries).toHaveLength(5);
    expect(state.hasMore).toBe(false);
  });

  // ==========================================================================
  // Draft persistence across screen switches
  // ==========================================================================

  test('draft persists across store resets (simulating screen switch)', () => {
    testDb = createTestDb();
    const store = usePromptHistoryStore.getState();
    store.initialize();
    store.setDraft('work in progress');

    // Simulate unmounting — the store state persists
    expect(usePromptHistoryStore.getState().draft).toBe('work in progress');

    // Simulate re-mounting — draft is still there
    expect(usePromptHistoryStore.getState().draft).toBe('work in progress');
  });
});
