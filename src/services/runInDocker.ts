import { $, spawn } from 'bun';
import { printArgs, resolveSandboxImage } from './docker';
import { log } from './logger';

export interface RunInDockerOptionsBase {
  dockerArgs?: readonly string[];
  cmdArgs?: readonly string[];
  dockerImage?: string;
  interactive?: boolean;
  shouldThrow?: boolean;
}

interface RunInDockerOptions extends RunInDockerOptionsBase {
  cmdName: string;
}

export interface RunInDockerResult {
  errorText: () => string;
  exited: Promise<number>;
  json: () => unknown;
  text: () => string;
}

export const API_KEYS_TO_PASSTHROUGH = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'];

export const getHostEnvArgs = (): string[] => {
  const args: string[] = [];
  for (const key of API_KEYS_TO_PASSTHROUGH) {
    const value = process.env[key];
    if (value) {
      args.push('-e', `${key}=${value}`);
    }
  }
  return args;
};

const redactEnvArgs = (args: readonly string[]): string[] =>
  args.map((arg) =>
    API_KEYS_TO_PASSTHROUGH.some((key) => arg.startsWith(`${key}=`))
      ? `${arg.split('=')[0]}=[REDACTED]`
      : arg,
  );

export const runInDocker = async ({
  dockerArgs = ['--rm'],
  cmdArgs = [],
  cmdName,
  dockerImage,
  interactive = false,
  shouldThrow = true,
}: RunInDockerOptions): Promise<RunInDockerResult> => {
  // Pass through API keys from host environment so credential checks
  // and agent runs inside Docker can use them without re-authentication
  const hostEnvArgs = getHostEnvArgs();
  const allDockerArgs = [...hostEnvArgs, ...dockerArgs];

  // Resolve the sandbox image if not explicitly provided
  const resolvedImage = dockerImage ?? (await resolveSandboxImage()).image;
  log.debug(
    {
      dockerArgs: redactEnvArgs(allDockerArgs),
      cmdArgs,
      cmdName,
      dockerImage: resolvedImage,
      interactive,
      shouldThrow,
      cmd: `docker run${interactive ? ' -it' : ''} ${printArgs(redactEnvArgs(allDockerArgs))} ${resolvedImage} ${cmdName} ${printArgs(cmdArgs)}`,
    },
    'runInDocker',
  );
  if (interactive) {
    const proc = spawn(
      [
        'docker',
        'run',
        '-it',
        ...allDockerArgs,
        resolvedImage,
        cmdName,
        ...cmdArgs,
      ],
      {
        stdio: ['inherit', 'inherit', 'inherit'],
      },
    );
    if (shouldThrow) {
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        throw new Error(`${cmdName} exited with code ${exitCode}`);
      }
    }
    return {
      exited: proc.exited,
      errorText: () => '',
      text: () => '',
      json: () => null,
    };
  }

  const proc =
    await $`docker run ${allDockerArgs} ${resolvedImage} ${cmdName} ${cmdArgs}`
      .quiet()
      .throws(shouldThrow);
  return {
    errorText: () => proc.stderr.toString(),
    text: () => proc.text(),
    json: () => proc.json(),
    exited: Promise.resolve(proc.exitCode),
  };
};
