import { type CliRenderer, createCliRenderer } from '@opentui/core';
import type { Root } from '@opentui/react';
import { createRoot } from '@opentui/react';
import type { ReactNode } from 'react';
import { useTheme } from '../stores/themeStore';
import { restoreConsole } from '../utils';

interface TuiResult {
  renderer: CliRenderer;
  root: Root;
  destroy: () => Promise<void>;
  render: (node: ReactNode) => void;
}

export const createTui = async (): Promise<TuiResult> => {
  await useTheme.getState().initialize();
  const renderer = await createCliRenderer({ exitOnCtrlC: true });
  const root = createRoot(renderer);

  const render = (node: ReactNode) => {
    root.render(node);
  };

  const destroy = async () => {
    await renderer.idle();
    renderer.destroy();
    restoreConsole();
  };

  return { root, destroy, render, renderer };
};
