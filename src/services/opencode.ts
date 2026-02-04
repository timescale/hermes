import { mkdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { file } from 'bun';
import { readConfig } from './config';
import { log } from './logger';
import {
  type RunInDockerOptionsBase,
  type RunInDockerResult,
  runInDocker,
} from './runInDocker';

const HERMES_DIR = join(process.cwd(), '.hermes');
const OPENCODE_CONFIG_DIR = join(HERMES_DIR, '.local', 'share', 'opencode');
const OPENCODE_HOST_CONFIG_DIR = join(homedir(), '.local', 'share', 'opencode');
const OPENCODE_AUTH_FILE_NAME = 'auth.json';
const OPENCODE_LOCAL_AUTH_PATH = join(
  OPENCODE_CONFIG_DIR,
  OPENCODE_AUTH_FILE_NAME,
);

/**
 * Check if the auth path is a directory (broken state from Docker mount bug)
 * and remove it if so.
 */
const fixBrokenAuthDir = async (): Promise<void> => {
  try {
    const stats = await stat(OPENCODE_LOCAL_AUTH_PATH);
    if (stats.isDirectory()) {
      log.warn('Found auth.json as a directory (broken state), removing it');
      await rm(OPENCODE_LOCAL_AUTH_PATH, { recursive: true });
    }
  } catch {
    // Path doesn't exist, which is fine
  }
};

/**
 * Ensure the auth file exists (at minimum as an empty JSON object).
 * This is required so Docker can mount it as a file, not a directory.
 * The login flow will populate it with actual credentials.
 */
const ensureAuthFile = async (): Promise<void> => {
  await mkdir(OPENCODE_CONFIG_DIR, { recursive: true });
  await fixBrokenAuthDir();

  const localAuth = file(OPENCODE_LOCAL_AUTH_PATH);
  if (!(await localAuth.exists())) {
    // Create empty JSON file so Docker mounts it as a file, not a directory
    await Bun.write(OPENCODE_LOCAL_AUTH_PATH, '{}');
  }
};

/**
 * Returns the Docker volume mount string for Opencode credentials.
 * Always returns a valid volume string since ensureAuthFile creates the file if needed.
 */
export const getOpencodeConfigVolume = async (): Promise<string> => {
  await ensureAuthFile();
  return `${OPENCODE_LOCAL_AUTH_PATH}:/home/hermes/.local/share/opencode/${OPENCODE_AUTH_FILE_NAME}`;
};

const checkConfig = async () => {
  await ensureAuthFile();

  const hostAuth = file(
    join(OPENCODE_HOST_CONFIG_DIR, OPENCODE_AUTH_FILE_NAME),
  );
  if (!(await hostAuth.exists())) {
    log.info('Opencode auth.json not found in host config directory');
    return;
  }
  const localAuth = file(OPENCODE_LOCAL_AUTH_PATH);
  const localContent = await localAuth.json();
  const hostContent = await hostAuth.json();
  const keys = new Set([
    ...Object.keys(localContent),
    ...Object.keys(hostContent),
  ]);
  let changed = false;
  for (const key of keys) {
    if (
      !localContent[key] ||
      (localContent[key].expires &&
        localContent[key].expires < Date.now() &&
        hostContent[key])
    ) {
      log.debug(
        `Adding missing or outdated key "${key}" to local opencode ${OPENCODE_AUTH_FILE_NAME} from host`,
      );
      localContent[key] = hostContent[key];
      changed = true;
    }
  }
  if (changed) {
    await localAuth.write(JSON.stringify(localContent, null, 2));
  }
};

export const runOpencodeInDocker = async ({
  dockerArgs = ['--rm'],
  cmdArgs = [],
  dockerImage,
  interactive = false,
  shouldThrow = true,
}: RunInDockerOptionsBase): Promise<RunInDockerResult> => {
  await checkConfig();

  const configVolume = await getOpencodeConfigVolume();

  return runInDocker({
    dockerArgs: ['-v', configVolume, ...dockerArgs],
    cmdArgs,
    cmdName: 'opencode',
    dockerImage,
    interactive,
    shouldThrow,
  });
};

export const checkOpencodeCredentials = async (
  model?: string,
): Promise<boolean> => {
  const proc = await runOpencodeInDocker({
    cmdArgs: ['auth', 'list'],
    shouldThrow: false,
  });
  const exitCode = await proc.exited;
  const output = proc.text().trim();
  const match = output.match(/(\d+)\s+credentials/);
  const numCreds = match?.[1] ? parseInt(match[1], 10) : 0;
  log.debug(
    { exitCode, output, numCreds },
    'checkOpencodeCredentials auth list',
  );
  if (exitCode || !numCreds) {
    return false;
  }
  const effectiveModel = model ?? (await readConfig())?.model;
  const proc2 = await runOpencodeInDocker({
    cmdArgs: [
      'run',
      ...(effectiveModel ? ['--model', effectiveModel] : []),
      'just output `true`, and nothing else',
    ],
    shouldThrow: false,
  });
  const exitCode2 = await proc2.exited;
  const output2 = proc2.text().trim();
  const errText = proc2.errorText().trim();
  log.debug(
    { exitCode: exitCode2, output: output2, errText, model: effectiveModel },
    'checkOpencodeCredentials test run',
  );
  return exitCode2 === 0 && !errText.includes('Error');
};

/**
 * Ensure Opencode credentials are valid, running interactive login if needed.
 * Returns true if credentials are valid after the check/login, false if login failed or was cancelled.
 */
export const ensureOpencodeAuth = async (model?: string): Promise<boolean> => {
  const isValid = await checkOpencodeCredentials(model);
  if (isValid) {
    return true;
  }

  console.log('\nOpencode credentials are missing or expired.');
  console.log('Starting Opencode login...\n');

  const proc = await runOpencodeInDocker({
    cmdArgs: ['auth', 'login'],
    interactive: true,
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error('\nError: Opencode login failed');
    return false;
  }

  // Verify credentials after login
  return await checkOpencodeCredentials(model);
};
