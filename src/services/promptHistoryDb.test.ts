// ============================================================================
// Prompt History Database Tests
// ============================================================================

import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import {
  addPromptHistoryEntry,
  getPromptHistoryCount,
  getRecentPrompts,
  initPromptHistorySchema,
} from './promptHistoryDb.ts';

function createTestDb(): Database {
  const db = new Database(':memory:');
  initPromptHistorySchema(db);
  return db;
}

describe('promptHistoryDb', () => {
  // ==========================================================================
  // addPromptHistoryEntry
  // ==========================================================================

  test('adds a prompt entry', () => {
    const db = createTestDb();
    addPromptHistoryEntry(db, 'fix the bug');

    const entries = getRecentPrompts(db, 10);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.prompt).toBe('fix the bug');
    expect(entries[0]?.id).toBeGreaterThan(0);
    expect(entries[0]?.createdAt).toBeTruthy();
  });

  test('trims whitespace before storing', () => {
    const db = createTestDb();
    addPromptHistoryEntry(db, '  add a feature  ');

    const entries = getRecentPrompts(db, 10);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.prompt).toBe('add a feature');
  });

  test('skips empty prompts', () => {
    const db = createTestDb();
    addPromptHistoryEntry(db, '');
    addPromptHistoryEntry(db, '   ');

    const entries = getRecentPrompts(db, 10);
    expect(entries).toHaveLength(0);
  });

  test('skips consecutive duplicates', () => {
    const db = createTestDb();
    addPromptHistoryEntry(db, 'fix the bug');
    addPromptHistoryEntry(db, 'fix the bug');
    addPromptHistoryEntry(db, 'fix the bug');

    const entries = getRecentPrompts(db, 10);
    expect(entries).toHaveLength(1);
  });

  test('allows non-consecutive duplicates', () => {
    const db = createTestDb();
    addPromptHistoryEntry(db, 'fix the bug');
    addPromptHistoryEntry(db, 'add a feature');
    addPromptHistoryEntry(db, 'fix the bug');

    const entries = getRecentPrompts(db, 10);
    expect(entries).toHaveLength(3);
  });

  // ==========================================================================
  // getRecentPrompts
  // ==========================================================================

  test('returns entries newest first', () => {
    const db = createTestDb();
    addPromptHistoryEntry(db, 'first');
    addPromptHistoryEntry(db, 'second');
    addPromptHistoryEntry(db, 'third');

    const entries = getRecentPrompts(db, 10);
    expect(entries).toHaveLength(3);
    expect(entries[0]?.prompt).toBe('third');
    expect(entries[1]?.prompt).toBe('second');
    expect(entries[2]?.prompt).toBe('first');
  });

  test('respects limit', () => {
    const db = createTestDb();
    addPromptHistoryEntry(db, 'first');
    addPromptHistoryEntry(db, 'second');
    addPromptHistoryEntry(db, 'third');

    const entries = getRecentPrompts(db, 2);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.prompt).toBe('third');
    expect(entries[1]?.prompt).toBe('second');
  });

  test('paginates with beforeId', () => {
    const db = createTestDb();
    addPromptHistoryEntry(db, 'first');
    addPromptHistoryEntry(db, 'second');
    addPromptHistoryEntry(db, 'third');
    addPromptHistoryEntry(db, 'fourth');
    addPromptHistoryEntry(db, 'fifth');

    // Get first page
    const page1 = getRecentPrompts(db, 2);
    expect(page1).toHaveLength(2);
    expect(page1[0]?.prompt).toBe('fifth');
    expect(page1[1]?.prompt).toBe('fourth');

    // Get second page using the last entry's id
    const page2 = getRecentPrompts(db, 2, page1[1]?.id);
    expect(page2).toHaveLength(2);
    expect(page2[0]?.prompt).toBe('third');
    expect(page2[1]?.prompt).toBe('second');

    // Get third page
    const page3 = getRecentPrompts(db, 2, page2[1]?.id);
    expect(page3).toHaveLength(1);
    expect(page3[0]?.prompt).toBe('first');
  });

  test('returns empty array when no entries exist', () => {
    const db = createTestDb();
    const entries = getRecentPrompts(db, 10);
    expect(entries).toHaveLength(0);
  });

  // ==========================================================================
  // getPromptHistoryCount
  // ==========================================================================

  test('returns correct count', () => {
    const db = createTestDb();
    expect(getPromptHistoryCount(db)).toBe(0);

    addPromptHistoryEntry(db, 'first');
    expect(getPromptHistoryCount(db)).toBe(1);

    addPromptHistoryEntry(db, 'second');
    expect(getPromptHistoryCount(db)).toBe(2);

    // Duplicate should not increase count
    addPromptHistoryEntry(db, 'second');
    expect(getPromptHistoryCount(db)).toBe(2);
  });

  // ==========================================================================
  // Schema idempotency
  // ==========================================================================

  test('initPromptHistorySchema is idempotent', () => {
    const db = createTestDb();
    // Call again — should not throw
    initPromptHistorySchema(db);

    addPromptHistoryEntry(db, 'still works');
    const entries = getRecentPrompts(db, 10);
    expect(entries).toHaveLength(1);
  });
});
