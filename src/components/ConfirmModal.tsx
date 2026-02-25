import { useTheme } from '../stores/themeStore';
import { type Option, OptionsModal } from './OptionsModal';

export interface ConfirmModalProps {
  title: string;
  message: string;
  detail?: string;
  confirmLabel: string;
  confirmColor?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  title,
  message,
  detail,
  confirmLabel,
  confirmColor,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const { theme } = useTheme();
  const options: Option[] = [
    {
      key: 'enter',
      name: confirmLabel,
      onSelect: onConfirm,
      color: confirmColor ?? theme.success,
    },
    {
      key: 'escape',
      name: 'Cancel',
      onSelect: onCancel,
      color: theme.textMuted,
    },
  ];
  return (
    <OptionsModal
      title={title}
      message={message}
      minWidth={40}
      maxWidth={60}
      options={options}
      onCancel={onCancel}
    >
      {detail && (
        <text fg={theme.textMuted} marginTop={1} marginLeft={2} marginRight={2}>
          {detail}
        </text>
      )}
    </OptionsModal>
  );
}
