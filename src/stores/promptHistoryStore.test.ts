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
    entries: [],
    index: 0,
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
  // initialize
  // ==========================================================================

  test('initialize loads entries from DB in chronological order', () => {
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
    // Chronological order: oldest first
    expect(state.entries[0]?.prompt).toBe('prompt one');
    expect(state.entries[1]?.prompt).toBe('prompt two');
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

  test('addEntry persists to DB and appends to entries', () => {
    testDb = createTestDb();
    const store = usePromptHistoryStore.getState();
    store.initialize();

    store.addEntry('new prompt');

    const state = usePromptHistoryStore.getState();
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]?.prompt).toBe('new prompt');
    expect(state.index).toBe(0);
  });

  test('addEntry skips consecutive duplicates', () => {
    testDb = createTestDb();
    const store = usePromptHistoryStore.getState();
    store.initialize();

    store.addEntry('same prompt');
    usePromptHistoryStore.getState().addEntry('same prompt');

    const state = usePromptHistoryStore.getState();
    expect(state.entries).toHaveLength(1);
  });

  test('addEntry skips empty prompts', () => {
    testDb = createTestDb();
    const store = usePromptHistoryStore.getState();
    store.initialize();

    store.addEntry('');
    usePromptHistoryStore.getState().addEntry('   ');

    expect(usePromptHistoryStore.getState().entries).toHaveLength(0);
  });

  test('addEntry resets index to 0', () => {
    testDb = createTestDb();
    testDb
      .prepare(
        'INSERT INTO prompt_history (prompt, created_at) VALUES ($p, $c)',
      )
      .run({ $p: 'old', $c: '2025-01-01T00:00:00Z' });

    const store = usePromptHistoryStore.getState();
    store.initialize();

    // Navigate into history
    store.move(-1, '');
    expect(usePromptHistoryStore.getState().index).toBe(-1);

    // Submit resets index
    usePromptHistoryStore.getState().addEntry('submitted prompt');
    expect(usePromptHistoryStore.getState().index).toBe(0);
  });

  // ==========================================================================
  // move (up / down)
  // ==========================================================================

  test('move(-1) walks backward through history', () => {
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

    // First up: go to most recent (newest)
    const text1 = store.move(-1, '');
    expect(text1).toBe('newest');
    expect(usePromptHistoryStore.getState().index).toBe(-1);

    // Second up: go to older entry
    const text2 = usePromptHistoryStore.getState().move(-1, 'newest');
    expect(text2).toBe('oldest');
    expect(usePromptHistoryStore.getState().index).toBe(-2);

    // Third up: no more entries
    const text3 = usePromptHistoryStore.getState().move(-1, 'oldest');
    expect(text3).toBeUndefined();
    expect(usePromptHistoryStore.getState().index).toBe(-2);
  });

  test('move(1) walks forward back to current input', () => {
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

    // Navigate up twice
    store.move(-1, '');
    usePromptHistoryStore.getState().move(-1, 'newest');
    expect(usePromptHistoryStore.getState().index).toBe(-2);

    // Navigate down: back to newest
    const text1 = usePromptHistoryStore.getState().move(1, 'oldest');
    expect(text1).toBe('newest');
    expect(usePromptHistoryStore.getState().index).toBe(-1);

    // Navigate down again: back to current input (empty string)
    const text2 = usePromptHistoryStore.getState().move(1, 'newest');
    expect(text2).toBe('');
    expect(usePromptHistoryStore.getState().index).toBe(0);

    // Navigate down again: already at current input
    const text3 = usePromptHistoryStore.getState().move(1, '');
    expect(text3).toBeUndefined();
    expect(usePromptHistoryStore.getState().index).toBe(0);
  });

  test('move returns undefined when no history exists', () => {
    testDb = createTestDb();
    const store = usePromptHistoryStore.getState();
    store.initialize();

    const text = store.move(-1, '');
    expect(text).toBeUndefined();
  });

  test('move returns undefined when already at current input and going down', () => {
    testDb = createTestDb();
    const store = usePromptHistoryStore.getState();
    store.initialize();

    const text = store.move(1, '');
    expect(text).toBeUndefined();
  });

  test('move blocks navigation when input has been edited', () => {
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

    // Navigate to most recent entry
    store.move(-1, '');
    expect(usePromptHistoryStore.getState().index).toBe(-1);

    // Try to navigate further but with modified text — should be blocked
    const text = usePromptHistoryStore.getState().move(-1, 'newest edited');
    expect(text).toBeUndefined();
    // Index should not have changed
    expect(usePromptHistoryStore.getState().index).toBe(-1);
  });
});
