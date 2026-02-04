import { mkdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { file } from 'bun';
import { log } from './logger';
import {
  type RunInDockerOptionsBase,
  type RunInDockerResult,
  runInDocker,
} from './runInDocker';

const HERMES_DIR = join(process.cwd(), '.hermes');
const CLAUDE_CONFIG_DIR = join(HERMES_DIR, '.claude');
const CLAUDE_HOST_CONFIG_DIR = join(homedir(), '.claude');
const CLAUDE_AUTH_FILE_NAME = '.credentials.json';
const CLAUDE_LOCAL_CREDS_PATH = join(CLAUDE_CONFIG_DIR, CLAUDE_AUTH_FILE_NAME);

/**
 * Check if the credentials path is a directory (broken state from Docker mount bug)
 * and remove it if so.
 */
const fixBrokenCredentialsDir = async (): Promise<void> => {
  try {
    const stats = await stat(CLAUDE_LOCAL_CREDS_PATH);
    if (stats.isDirectory()) {
      log.warn(
        'Found .credentials.json as a directory (broken state), removing it',
      );
      await rm(CLAUDE_LOCAL_CREDS_PATH, { recursive: true });
    }
  } catch {
    // Path doesn't exist, which is fine
  }
};

/**
 * Ensure the credentials file exists (at minimum as an empty JSON object).
 * This is required so Docker can mount it as a file, not a directory.
 * The login flow will populate it with actual credentials.
 */
const ensureCredentialsFile = async (): Promise<void> => {
  await mkdir(CLAUDE_CONFIG_DIR, { recursive: true });
  await fixBrokenCredentialsDir();

  const localCreds = file(CLAUDE_LOCAL_CREDS_PATH);
  if (!(await localCreds.exists())) {
    // Create empty JSON file so Docker mounts it as a file, not a directory
    await Bun.write(CLAUDE_LOCAL_CREDS_PATH, '{}');
  }
};

/**
 * Returns the Docker volume mount string for Claude credentials.
 * Always returns a valid volume string since ensureCredentialsFile creates the file if needed.
 */
export const getClaudeConfigVolume = async (): Promise<string> => {
  await ensureCredentialsFile();
  return `${CLAUDE_LOCAL_CREDS_PATH}:/home/hermes/.claude/${CLAUDE_AUTH_FILE_NAME}`;
};

const checkConfig = async () => {
  await ensureCredentialsFile();

  const hostCreds = file(join(CLAUDE_HOST_CONFIG_DIR, CLAUDE_AUTH_FILE_NAME));
  if (!(await hostCreds.exists())) {
    log.info('Claude credentials not found in host config directory');
    return;
  }
  const localCreds = file(CLAUDE_LOCAL_CREDS_PATH);
  if (
    !(await localCreds.exists()) ||
    (await localCreds.json())?.claudeAiOauth?.expiresAt < Date.now()
  ) {
    await localCreds.write(await hostCreds.bytes());
  }
};

export const runClaudeInDocker = async ({
  dockerArgs = ['--rm'],
  cmdArgs = [],
  dockerImage,
  interactive = false,
  shouldThrow = true,
}: RunInDockerOptionsBase): Promise<RunInDockerResult> => {
  await checkConfig();

  const configVolume = await getClaudeConfigVolume();

  return runInDocker({
    dockerArgs: ['-v', configVolume, ...dockerArgs],
    cmdArgs,
    cmdName: 'claude',
    dockerImage,
    interactive,
    shouldThrow,
  });
};

export const checkClaudeCredentials = async (
  model = 'haiku',
): Promise<boolean> => {
  const proc = await runClaudeInDocker({
    cmdArgs: ['--model', model, '-p', 'just output `true`, and nothing else'],
    shouldThrow: false,
  });
  const exitCode = await proc.exited;
  const output = proc.text().trim();
  log.debug({ exitCode, output, model }, 'checkClaudeCredentials');
  return exitCode === 0;
};

/**
 * Ensure Claude credentials are valid, running interactive login if needed.
 * Returns true if credentials are valid after the check/login, false if login failed or was cancelled.
 */
export const ensureClaudeAuth = async (model?: string): Promise<boolean> => {
  const isValid = await checkClaudeCredentials(model);
  if (isValid) {
    return true;
  }

  console.log('\nClaude credentials are missing or expired.');
  console.log('Starting Claude login...\n');

  const proc = await runClaudeInDocker({
    cmdArgs: ['/login'],
    interactive: true,
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error('\nError: Claude login failed');
    return false;
  }

  // Verify credentials after login
  return await checkClaudeCredentials(model);
};
