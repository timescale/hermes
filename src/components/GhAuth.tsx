// ============================================================================
// GitHub Authentication TUI Component
// ============================================================================

import { useKeyboard } from '@opentui/react';
import open from 'open';
import { useEffect, useState } from 'react';
import { copyToClipboard } from '../services/clipboard';
import { log } from '../services/logger';
import { Dots } from './Dots';
import { Frame } from './Frame';

export type GhAuthStatus =
  | { type: 'waiting'; code: string; url: string }
  | { type: 'success' }
  | { type: 'error'; message: string }
  | { type: 'cancelled' };

export interface GhAuthProps {
  code: string;
  url: string;
  onComplete: (status: GhAuthStatus) => void;
}

export function GhAuth({ code, url, onComplete }: GhAuthProps) {
  const [copied, setCopied] = useState(false);
  const [opened, setOpened] = useState(false);

  useKeyboard((key) => {
    if (key.name === 'escape') {
      onComplete({ type: 'cancelled' });
    }
  });

  // Copy code to clipboard and open URL in browser on mount
  useEffect(() => {
    copyToClipboard(code)
      .then(() => setCopied(true))
      .catch((err: unknown) =>
        log.debug({ err }, 'Failed to copy code to clipboard'),
      );
    open(url)
      .then(() => setOpened(true))
      .catch((err: unknown) =>
        log.debug({ err }, 'Failed to open URL in browser'),
      );
  }, [code, url]);

  return (
    <Frame title="GitHub Authentication">
      <box flexDirection="column" alignItems="center">
        <text fg="#888">
          {opened
            ? 'Opening in your browser:'
            : 'Open this URL in your browser:'}
        </text>
        <text fg="#6bf">{url}</text>

        <box height={1} />

        <text fg="#888">And enter this one-time code:</text>
        <text fg="#0f0"> {code} </text>
        {copied && <text fg="#555">(copied to clipboard)</text>}

        <box height={2} />

        <text fg="#888">
          Waiting for authentication
          <Dots />
        </text>

        <box height={1} />
        <text fg="#555">Press Esc to cancel</text>
      </box>
    </Frame>
  );
}
