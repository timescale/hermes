import { useKeyboard } from '@opentui/react';
import { useState } from 'react';
import { Modal } from './Modal';

export interface PromptModalProps {
  title: string;
  message: string;
  placeholder?: string;
  onSubmit: (prompt: string) => void;
  onCancel: () => void;
}

export function PromptModal({
  title,
  message,
  placeholder,
  onSubmit,
  onCancel,
}: PromptModalProps) {
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    const trimmed = prompt.trim();
    if (!trimmed) {
      setError('Prompt is required.');
      return;
    }
    onSubmit(trimmed);
  };

  useKeyboard((key) => {
    if (key.name === 'escape') {
      onCancel();
    } else if (key.name === 'return') {
      handleSubmit();
    }
  });

  return (
    <Modal title={title} minWidth={50} maxWidth={80}>
      <text style={{ marginBottom: 1 }}>{message}</text>
      <input
        focused
        value={prompt}
        placeholder={placeholder ?? 'Enter prompt...'}
        onInput={(value) => {
          setPrompt(value);
          if (error) setError(null);
        }}
        style={{
          backgroundColor: '#333333',
          textColor: '#ffffff',
        }}
      />
      {error && <text style={{ fg: '#ff6b6b', marginTop: 1 }}>{error}</text>}
      <box style={{ marginTop: 1, justifyContent: 'flex-end', gap: 2 }}>
        <text>
          [<span fg="#51cf66">Enter</span>] Resume
        </text>
        <text>
          [<span fg="#888888">Esc</span>] Cancel
        </text>
      </box>
    </Modal>
  );
}
