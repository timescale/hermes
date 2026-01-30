import { useTheme } from '../stores/themeStore.ts';

interface Props {
  keyList: readonly [string, string][];
  compact?: boolean;
}

export function HotkeysBar({ keyList, compact }: Props) {
  const { theme } = useTheme();

  return (
    <box flexDirection="row" justifyContent="flex-end" gap={2}>
      {keyList.map(([key, action]) => (
        <box
          key={key}
          flexDirection="row"
          gap={key.length === 1 && compact ? 0 : 1}
        >
          <text fg={theme.text}>{key}</text>
          <text fg={theme.textMuted}>{action}</text>
        </box>
      ))}
    </box>
  );
}
