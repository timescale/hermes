import { $, spawn } from 'bun';
import { nanoid } from 'nanoid';
import { printArgs, resolveSandboxImage } from './docker';
import { log } from './logger';

export interface RunInDockerOptionsBase {
  containerName?: string;
  dockerArgs?: readonly string[];
  cmdArgs?: readonly string[];
  dockerImage?: string;
  interactive?: boolean;
  detached?: boolean;
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

export const runInDocker = async ({
  containerName = `hermes-anon-${nanoid(12)}`,
  dockerArgs = ['--rm'],
  cmdName,
  cmdArgs = [],
  dockerImage,
  interactive = false,
  detached = false,
  shouldThrow = true,
}: RunInDockerOptions): Promise<RunInDockerResult> => {
  // Resolve the sandbox image if not explicitly provided
  const resolvedImage = dockerImage ?? (await resolveSandboxImage()).image;
  const effectiveDockerArgs = [
    '--name',
    containerName,
    ...(detached ? ['-d'] : []),
    ...dockerArgs,
  ];
  log.debug(
    {
      containerName,
      dockerArgs,
      cmdArgs,
      cmdName,
      dockerImage: resolvedImage,
      interactive,
      detached,
      shouldThrow,
      cmd: `docker run${interactive ? ' -it' : ''} ${printArgs(effectiveDockerArgs)} ${resolvedImage} ${cmdName} ${printArgs(cmdArgs)}`,
    },
    'runInDocker',
  );
  if (interactive) {
    const proc = spawn(
      [
        'docker',
        'run',
        '-it',
        ...effectiveDockerArgs,
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
    await $`docker run ${effectiveDockerArgs} ${resolvedImage} ${cmdName} ${cmdArgs}`
      .quiet()
      .throws(shouldThrow);
  return {
    errorText: () => proc.stderr.toString(),
    text: () => proc.text(),
    json: () => proc.json(),
    exited: Promise.resolve(proc.exitCode),
  };
};
