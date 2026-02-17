import { describe, expect, test } from 'bun:test';
import { deleteDenoToken, getDenoToken, setDenoToken } from './deno';

describe.skipIf(!!process.env.CI)('deno token management', () => {
  test('getDenoToken returns null when no token is stored', async () => {
    // Clean up first
    await deleteDenoToken();
    const token = await getDenoToken();
    expect(token).toBeNull();
  });

  test('setDenoToken and getDenoToken round-trip', async () => {
    const testToken = 'test-deno-token-12345';
    await setDenoToken(testToken);
    const retrieved = await getDenoToken();
    expect(retrieved).toBe(testToken);
    // Clean up
    await deleteDenoToken();
  });

  test('deleteDenoToken removes the token', async () => {
    await setDenoToken('to-be-deleted');
    await deleteDenoToken();
    const token = await getDenoToken();
    expect(token).toBeNull();
  });

  test('deleteDenoToken is safe to call when no token exists', async () => {
    await deleteDenoToken();
    // Should not throw
    await deleteDenoToken();
  });
});
