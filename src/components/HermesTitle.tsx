import { useEffect, useState } from 'react';

const TITLE_SOLID_COLOR = '#d0d0d0';
const TITLE_OUTLINE_COLOR = '#5c5c5c';
const TITLE_MAX_WIDTH = 76;
const TITLE_PADDING = 4;

// Solid block characters get the main bright color
const SOLID_CHARS = new Set(['█', '▀', '▄', '▌', '▐', '░', '▒', '▓']);

const HERMES_TITLE_WIDE = [
  '██╗  ██╗███████╗██████╗ ███╗   ███╗███████╗███████╗',
  '██║  ██║██╔════╝██╔══██╗████╗ ████║██╔════╝██╔════╝',
  '███████║█████╗  ██████╔╝██╔████╔██║█████╗  ███████╗',
  '██╔══██║██╔══╝  ██╔══██╗██║╚██╔╝██║██╔══╝  ╚════██║',
  '██║  ██║███████╗██║  ██║██║ ╚═╝ ██║███████╗███████║',
  '╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝╚══════╝',
];

const HERMES_TITLE_NARROW = `
▄  ▄ ▄▄▄▄ ▄▄▄  ▄   ▄ ▄▄▄▄ ▄▄▄▄
█▄▄█ █▄▄  █▄▄▀ █▀▄▀█ █▄▄  ▀▄▄ 
█  █ █▄▄▄ █ ▀▄ █   █ █▄▄▄ ▄▄▄▀
`.trim();

type CharType = 'solid' | 'outline' | 'space';

function getCharType(char: string): CharType {
  if (char === ' ') return 'space';
  return SOLID_CHARS.has(char) ? 'solid' : 'outline';
}

function getMaxLineLength(lines: string[]) {
  return lines.reduce((max, line) => Math.max(max, line.length), 0);
}

// Parse lines into segments grouped by character type for efficient rendering
function linesToSegments(lines: string[]) {
  return lines.map((line) => {
    const segments: { text: string; type: CharType }[] = [];
    let currentType: CharType = 'space';
    let buffer = '';

    for (const char of line) {
      const charType = getCharType(char);
      if (charType !== currentType) {
        if (buffer.length > 0) {
          segments.push({ text: buffer, type: currentType });
        }
        currentType = charType;
        buffer = char;
      } else {
        buffer += char;
      }
    }

    if (buffer.length > 0) {
      segments.push({ text: buffer, type: currentType });
    }

    return segments;
  });
}

const HERMES_TITLE_WIDE_SEGMENTS = linesToSegments(HERMES_TITLE_WIDE);
const HERMES_TITLE_WIDE_WIDTH = getMaxLineLength(HERMES_TITLE_WIDE);

/**
 * Responsive ASCII art title for "hermes".
 * Switches between wide and narrow versions based on terminal width.
 */
export function HermesTitle() {
  const [columns, setColumns] = useState(() => process.stdout.columns ?? 80);

  useEffect(() => {
    const handleResize = () => {
      setColumns(process.stdout.columns ?? 80);
    };

    process.stdout.on('resize', handleResize);
    return () => {
      process.stdout.off('resize', handleResize);
    };
  }, []);

  const containerWidth = Math.min(
    Math.max(columns - TITLE_PADDING, 0),
    TITLE_MAX_WIDTH,
  );
  const isWideTitle = containerWidth >= HERMES_TITLE_WIDE_WIDTH + 10;

  return (
    <box marginBottom={2} width="100%" alignItems="center">
      {isWideTitle ? (
        <box flexDirection="column" alignItems="center">
          {HERMES_TITLE_WIDE_SEGMENTS.map((segments) => {
            const rowKey = segments
              .map((segment) => `${segment.type}:${segment.text}`)
              .join('|');
            let segmentOffset = 0;

            return (
              <box flexDirection="row" key={`title-row-${rowKey}`}>
                {segments.map((segment) => {
                  const fg =
                    segment.type === 'solid'
                      ? TITLE_SOLID_COLOR
                      : segment.type === 'outline'
                        ? TITLE_OUTLINE_COLOR
                        : undefined;
                  const segmentKey = `title-segment-${rowKey}-${segment.type}-${segmentOffset}`;
                  segmentOffset += segment.text.length;
                  return (
                    <text key={segmentKey} fg={fg}>
                      {segment.text}
                    </text>
                  );
                })}
              </box>
            );
          })}
        </box>
      ) : (
        <text fg={TITLE_SOLID_COLOR}>{HERMES_TITLE_NARROW}</text>
      )}
    </box>
  );
}
