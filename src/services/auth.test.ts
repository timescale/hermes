import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { hasLocalGhAuth } from './auth';

describe('auth service', async () => {
  const testDir = '.hermes-auth-test';
  const originalCwd = process.cwd();
  const testPath = join(originalCwd, testDir);

  beforeEach(async () => {
    await mkdir(testPath, { recursive: true });
    process.chdir(testPath);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    try {
      await rm(testPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  afterAll(() => {
    process.chdir(originalCwd);
  });

  describe('hasLocalGhAuth', () => {
    test('returns false when .hermes/gh directory does not exist', async () => {
      const result = await hasLocalGhAuth();
      expect(result).toBe(false);
    });

    test('returns false when hosts.yml does not exist', async () => {
      await mkdir('.hermes/gh', { recursive: true });
      const result = await hasLocalGhAuth();
      expect(result).toBe(false);
    });

    test('returns false when hosts.yml is empty', async () => {
      await mkdir('.hermes/gh', { recursive: true });
      await Bun.write('.hermes/gh/hosts.yml', '');

      const result = await hasLocalGhAuth();
      expect(result).toBe(false);
    });

    test('returns false when hosts.yml has no github.com entry', async () => {
      await mkdir('.hermes/gh', { recursive: true });
      await Bun.write(
        '.hermes/gh/hosts.yml',
        `
gitlab.com:
  oauth_token: abc123
  user: testuser
  git_protocol: https
`,
      );

      const result = await hasLocalGhAuth();
      expect(result).toBe(false);
    });

    test('returns false when github.com entry has no oauth_token', async () => {
      await mkdir('.hermes/gh', { recursive: true });
      await Bun.write(
        '.hermes/gh/hosts.yml',
        `
github.com:
  user: testuser
  git_protocol: https
`,
      );

      const result = await hasLocalGhAuth();
      expect(result).toBe(false);
    });

    test('returns true when valid github.com credentials exist', async () => {
      await mkdir('.hermes/gh', { recursive: true });
      await Bun.write(
        '.hermes/gh/hosts.yml',
        `
github.com:
  oauth_token: ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  user: testuser
  git_protocol: https
`,
      );

      const result = await hasLocalGhAuth();
      expect(result).toBe(true);
    });

    test('returns true even with minimal valid config', async () => {
      await mkdir('.hermes/gh', { recursive: true });
      await Bun.write(
        '.hermes/gh/hosts.yml',
        `
github.com:
  oauth_token: token123
`,
      );

      const result = await hasLocalGhAuth();
      expect(result).toBe(true);
    });

    test('returns false for invalid YAML', async () => {
      await mkdir('.hermes/gh', { recursive: true });
      await Bun.write('.hermes/gh/hosts.yml', 'not: valid: yaml: content:');

      const result = await hasLocalGhAuth();
      expect(result).toBe(false);
    });
  });
});
