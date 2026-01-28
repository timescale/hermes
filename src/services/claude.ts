import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { $, file, spawn } from 'bun';
import { HASHED_SANDBOX_DOCKER_IMAGE } from './docker';
import { log } from './logger';

const HERMES_DIR = join(process.cwd(), '.hermes');
const CLAUDE_CONFIG_DIR = join(HERMES_DIR, '.claude');
const CLAUDE_HOST_CONFIG_DIR = join(homedir(), '.claude');
export const CLAUDE_CONFIG_VOLUME = `${CLAUDE_CONFIG_DIR}:/home/agent/.claude`;

const checkConfig = async () => {
  await mkdir(CLAUDE_CONFIG_DIR, { recursive: true });

  const localCreds = file(join(CLAUDE_CONFIG_DIR, '.credentials.json'));
  if (
    !(await localCreds.exists()) ||
    (await localCreds.json())?.claudeAiOauth?.expiresAt < Date.now()
  ) {
    const hostCreds = file(join(CLAUDE_HOST_CONFIG_DIR, '.credentials.json'));
    if (await hostCreds.exists()) {
      await localCreds.write(await hostCreds.bytes());
    }
  }
};

interface RunClaudeOptions {
  dockerArgs?: readonly string[];
  claudeArgs?: readonly string[];
  dockerImage?: string;
  interactive?: boolean;
  shouldThrow?: boolean;
}

interface RunClaudeResult {
  text: () => string;
  json: () => unknown;
  exited: Promise<number>;
}

export const runClaudeInDocker = async ({
  dockerArgs = ['--rm'],
  claudeArgs = [],
  dockerImage = HASHED_SANDBOX_DOCKER_IMAGE,
  interactive = false,
  shouldThrow = true,
}: RunClaudeOptions): Promise<RunClaudeResult> => {
  await checkConfig();

  if (interactive) {
    const proc = spawn(
      [
        'docker',
        'run',
        '-it',
        '-v',
        CLAUDE_CONFIG_VOLUME,
        ...dockerArgs,
        dockerImage,
        'claude',
        ...claudeArgs,
      ],
      {
        stdio: ['inherit', 'inherit', 'inherit'],
      },
    );
    if (shouldThrow) {
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        throw new Error(`Claude CLI exited with code ${exitCode}`);
      }
    }
    return {
      exited: proc.exited,
      text: () => '',
      json: () => null,
    };
  }

  const proc =
    await $`docker run -v ${CLAUDE_CONFIG_DIR}:/home/agent/.claude ${dockerArgs} ${dockerImage} claude ${claudeArgs}`
      .quiet()
      .throws(shouldThrow);
  return {
    text: () => proc.text(),
    json: () => proc.json(),
    exited: Promise.resolve(proc.exitCode),
  };
};

export const checkClaudeCredentials = async (): Promise<boolean> => {
  const proc = await runClaudeInDocker({
    claudeArgs: [
      '--model',
      'haiku',
      '-p',
      'just output `true`, and nothing else',
    ],
    shouldThrow: false,
  });
  const exitCode = await proc.exited;
  const output = proc.text().trim();
  log.debug({ exitCode, output }, 'checkClaudeCredentials');
  return exitCode === 0;
};
