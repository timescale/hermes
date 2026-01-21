import { useKeyboard } from '@opentui/react';
import { Modal } from './Modal';

export interface ResumeModalProps {
  title: string;
  message: string;
  onInteractive: () => void;
  onDetached: () => void;
  onCancel: () => void;
}

export function ResumeModal({
  title,
  message,
  onInteractive,
  onDetached,
  onCancel,
}: ResumeModalProps) {
  useKeyboard((key) => {
    if (key.name === 'escape') {
      onCancel();
    } else if (key.name === 'return' || key.raw === 'i') {
      onInteractive();
    } else if (key.raw === 'd') {
      onDetached();
    }
  });

  return (
    <Modal title={title} minWidth={44} maxWidth={70}>
      <text style={{ marginBottom: 1 }}>{message}</text>
      <text style={{ fg: '#888888' }}>
        Interactive resumes in the terminal. Detached runs in the background.
      </text>
      <box style={{ marginTop: 1, justifyContent: 'flex-end', gap: 2 }}>
        <text>
          [<span fg="#51cf66">Enter/i</span>] Interactive
        </text>
        <text>
          [<span fg="#339af0">d</span>] Detached
        </text>
        <text>
          [<span fg="#888888">Esc</span>] Cancel
        </text>
      </box>
    </Modal>
  );
}
