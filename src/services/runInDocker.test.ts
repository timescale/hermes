import { describe, expect, test } from 'bun:test';
import { API_KEYS_TO_PASSTHROUGH, getHostEnvArgs } from './runInDocker';

describe('getHostEnvArgs', () => {
  const originalEnv = { ...process.env };

  const clearApiKeys = () => {
    for (const key of API_KEYS_TO_PASSTHROUGH) {
      delete process.env[key];
    }
  };

  const restoreEnv = () => {
    clearApiKeys();
    for (const key of API_KEYS_TO_PASSTHROUGH) {
      if (originalEnv[key]) {
        process.env[key] = originalEnv[key];
      }
    }
  };

  test('returns empty array when no API keys are set', () => {
    clearApiKeys();
    try {
      expect(getHostEnvArgs()).toEqual([]);
    } finally {
      restoreEnv();
    }
  });

  test('passes through ANTHROPIC_API_KEY when set', () => {
    clearApiKeys();
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-123';
    try {
      expect(getHostEnvArgs()).toEqual([
        '-e',
        'ANTHROPIC_API_KEY=sk-ant-test-123',
      ]);
    } finally {
      restoreEnv();
    }
  });

  test('passes through OPENAI_API_KEY when set', () => {
    clearApiKeys();
    process.env.OPENAI_API_KEY = 'sk-openai-test-456';
    try {
      expect(getHostEnvArgs()).toEqual([
        '-e',
        'OPENAI_API_KEY=sk-openai-test-456',
      ]);
    } finally {
      restoreEnv();
    }
  });

  test('passes through both keys when both are set', () => {
    clearApiKeys();
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    try {
      expect(getHostEnvArgs()).toEqual([
        '-e',
        'ANTHROPIC_API_KEY=sk-ant-test',
        '-e',
        'OPENAI_API_KEY=sk-openai-test',
      ]);
    } finally {
      restoreEnv();
    }
  });

  test('skips keys with empty string values', () => {
    clearApiKeys();
    process.env.ANTHROPIC_API_KEY = '';
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    try {
      expect(getHostEnvArgs()).toEqual(['-e', 'OPENAI_API_KEY=sk-openai-test']);
    } finally {
      restoreEnv();
    }
  });
});
