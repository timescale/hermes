import { extract } from 'tar-stream';

export const CONTAINER_HOME = '/home/hermes';

export async function writeFileToContainer(
  containerId: string,
  containerPath: string,
  content: string,
) {
  const proc = Bun.spawn(
    ['docker', 'exec', '-i', containerId, 'sh', '-c', `cat > ${containerPath}`],
    { stdin: new Blob([content]), stderr: 'ignore', stdout: 'ignore' },
  );
  await proc.exited;
}

export async function readFileFromContainer(
  containerId: string,
  containerPath: string,
): Promise<string> {
  const proc = Bun.spawn(
    ['docker', 'cp', `${containerId}:${containerPath}`, '-'],
    { stdout: 'pipe', stderr: 'ignore' },
  );

  const ex = extract();

  const result = new Promise<string>((resolve, reject) => {
    ex.on('entry', (_header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf-8'));
        next();
      });
    });
    ex.on('error', reject);
  });

  await proc.stdout.pipeTo(
    new WritableStream({
      write(chunk) {
        ex.write(chunk);
      },
      close() {
        ex.end();
      },
    }),
  );

  return result;
}
