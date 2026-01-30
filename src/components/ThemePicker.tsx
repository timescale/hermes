// ============================================================================
// Theme Picker - Modal for selecting themes with live preview
// ============================================================================

import { useMemo, useRef } from 'react';
import { useTheme } from '../stores/themeStore.ts';
import { FilterableSelector } from './FilterableSelector.tsx';

interface ThemePickerProps {
  onClose: () => void;
}

export function ThemePicker({ onClose }: ThemePickerProps) {
  const { themeName, setTheme, getThemeNames } = useTheme();
  const themeNames = useMemo(() => getThemeNames(), [getThemeNames]);

  // Store original theme for cancel/restore
  const originalTheme = useRef(themeName);

  // Build options for FilterableSelector
  const options = useMemo(
    () =>
      themeNames.map((name) => ({
        name,
        description: name === originalTheme.current ? '(current)' : '',
        value: name,
      })),
    [themeNames],
  );

  // Find initial index of current theme
  const initialIndex = useMemo(
    () => Math.max(0, themeNames.indexOf(themeName)),
    [themeNames, themeName],
  );

  return (
    <FilterableSelector
      title="Theme"
      description="Select a theme"
      options={options}
      initialIndex={initialIndex}
      onSelect={(value) => {
        if (value) setTheme(value);
        onClose();
      }}
      onCancel={() => {
        // Restore original theme
        setTheme(originalTheme.current);
        onClose();
      }}
      onPreview={(value) => {
        if (value) setTheme(value);
      }}
    />
  );
}
