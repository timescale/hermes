// ============================================================================
// Slash Command Popover - Shows available slash commands as user types
// ============================================================================

import type { BoxRenderable } from '@opentui/core';
import { flushSync, useKeyboard } from '@opentui/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SlashCommand } from '../services/slashCommands.ts';
import { useTheme } from '../stores/themeStore.ts';
import { EmptyBorder } from './PromptScreen.tsx';

interface SlashCommandPopoverProps {
  /** The current query (text after the "/") */
  query: string;

  /** Available slash commands to show */
  commands: SlashCommand[];

  /** Called when a command is selected */
  onSelect: (command: SlashCommand) => void;

  /** Called when the popover should close without selection */
  onCancel: () => void;

  /** Anchor element to position relative to */
  anchor: BoxRenderable | null;
}

export function SlashCommandPopover({
  query,
  commands,
  onSelect,
  onCancel,
  anchor,
}: SlashCommandPopoverProps) {
  const { theme } = useTheme();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const lastQueryRef = useRef(query);
  const [position, setPosition] = useState({ x: 0, y: 0, width: 0 });

  // Filter commands based on query
  const lowerQuery = query.toLowerCase();
  const filteredCommands = commands.filter(
    (cmd) =>
      cmd.name.toLowerCase().includes(lowerQuery) ||
      cmd.description.toLowerCase().includes(lowerQuery),
  );

  // Calculate max command name length for padding
  const maxNameLength = useMemo(() => {
    const max = Math.max(...filteredCommands.map((cmd) => cmd.name.length + 1)); // +1 for "/"
    return max > 0 ? max : 8;
  }, [filteredCommands]);

  // Reset selection when query changes (without useEffect)
  if (query !== lastQueryRef.current) {
    lastQueryRef.current = query;
    if (selectedIndex !== 0) {
      setSelectedIndex(0);
    }
  }

  // Calculate height based on number of commands
  const height = filteredCommands.length > 0 ? filteredCommands.length : 1;

  // Update position from anchor - use absolute coordinates
  useEffect(() => {
    if (!anchor) return;

    const updatePosition = () => {
      setPosition({
        x: anchor.x,
        y: anchor.y,
        width: anchor.width,
      });
    };

    // Initial position
    updatePosition();

    // Poll for position changes (anchor might move)
    const interval = setInterval(updatePosition, 50);
    return () => clearInterval(interval);
  }, [anchor]);

  // Clamp selected index
  const clampedIndex = Math.min(
    selectedIndex,
    Math.max(0, filteredCommands.length - 1),
  );

  useKeyboard((key) => {
    if (key.name === 'escape') {
      onCancel();
      return;
    }

    if (key.name === 'up') {
      flushSync(() => setSelectedIndex(Math.max(0, selectedIndex - 1)));
      return;
    }

    if (key.name === 'down') {
      flushSync(() =>
        setSelectedIndex(
          Math.min(filteredCommands.length - 1, selectedIndex + 1),
        ),
      );
      return;
    }

    if (key.name === 'return' && filteredCommands.length > 0) {
      const command = filteredCommands[clampedIndex];
      if (command) {
        onSelect(command);
      }
      return;
    }

    if (key.name === 'tab' && filteredCommands.length > 0) {
      const command = filteredCommands[clampedIndex];
      if (command) {
        onSelect(command);
      }
      return;
    }
  });

  const handleItemClick = (index: number) => {
    const command = filteredCommands[index];
    if (command) {
      onSelect(command);
    }
  };

  // Helper to get foreground color for selected items (contrast with primary)
  const selectedFg = theme.background;

  if (filteredCommands.length === 0) {
    return (
      <box
        position="absolute"
        top={position.y - 1}
        left={position.x}
        width={position.width}
        zIndex={100}
        border={['left']}
        borderColor={theme.borderSubtle}
        customBorderChars={{
          ...EmptyBorder,
          vertical: '\u2503',
          bottomLeft: '\u2579',
        }}
      >
        <box backgroundColor={theme.backgroundElement} paddingLeft={1}>
          <text fg={theme.textMuted}>No matching items</text>
        </box>
      </box>
    );
  }

  return (
    <box
      position="absolute"
      top={position.y - height}
      left={position.x}
      width={position.width}
      zIndex={100}
      flexDirection="column"
      border={['left']}
      borderColor={theme.borderSubtle}
      customBorderChars={{
        ...EmptyBorder,
        vertical: '\u2503',
        bottomLeft: '\u2579',
      }}
    >
      {filteredCommands.map((cmd, index) => {
        const isSelected = index === clampedIndex;
        const bgColor = isSelected ? theme.primary : theme.backgroundElement;
        const cmdColor = isSelected ? selectedFg : theme.text;
        const descColor = isSelected ? selectedFg : theme.textMuted;
        const paddedName = `/${cmd.name}`.padEnd(maxNameLength + 2);

        return (
          <box
            key={cmd.name}
            flexDirection="row"
            backgroundColor={bgColor}
            paddingLeft={1}
            paddingRight={1}
            onMouseDown={() => handleItemClick(index)}
            onMouseOver={() => setSelectedIndex(index)}
          >
            <text fg={cmdColor} flexShrink={0}>
              {paddedName}
            </text>
            <text fg={descColor} wrapMode="none">
              {cmd.description}
            </text>
          </box>
        );
      })}
    </box>
  );
}
