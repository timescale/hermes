import type { Plugin } from '@opencode-ai/plugin';

const SUPPORTED_EXTENSIONS = /\.(ts|tsx|js|jsx|json|jsonc|css)$/;

export const LintOnSave: Plugin = async ({ $ }) => {
  return {
    'tool.execute.after': async (input, output) => {
      // Only run after file write/edit tools
      if (input.tool !== 'write' && input.tool !== 'edit') return;

      const filePath: string | undefined = input.args?.filePath;
      if (!filePath) return;

      // Only lint file types biome supports
      if (!SUPPORTED_EXTENSIONS.test(filePath)) return;

      try {
        await $`./bun run lint --write ${filePath}`.quiet();
      } catch (err: any) {
        const stderr =
          err?.stderr?.toString() ?? err?.message ?? 'Unknown lint error';
        output.output += `\n\nLint errors in ${filePath}:\n${stderr}`;
      }
    },
  };
};
