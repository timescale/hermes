import { useKeyboard } from '@opentui/react';
import { Dots } from './Dots';

export interface LoadingProps {
  title?: string;
  message?: string;
  detail?: string;
  onCancel?: () => void;
}

export function Loading({
  title = 'Loading',
  message = 'Please wait',
  detail,
  onCancel,
}: LoadingProps) {
  useKeyboard((key) => {
    if (onCancel && key.name === 'escape') {
      onCancel();
    }
  });

  return (
    <box flexDirection="column" padding={1} flexGrow={1}>
      <box
        title={title}
        border={!!title}
        borderStyle="single"
        padding={1}
        flexDirection="column"
        flexGrow={1}
        alignItems="center"
        justifyContent="center"
      >
        <text fg="#eee">
          {message}
          <Dots />
        </text>
        {detail ? (
          <text fg="#888" marginTop={1}>
            {detail}
          </text>
        ) : null}
        {onCancel ? (
          <text fg="#555" marginTop={1}>
            Press Esc to cancel
          </text>
        ) : null}
      </box>
    </box>
  );
}
