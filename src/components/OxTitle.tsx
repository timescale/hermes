import { useWindowSize } from '../hooks/useWindowSize';
import { useTheme } from '../stores/themeStore';

const TITLE_PADDING = 4;

// Solid block characters get the main bright color
const SOLID_CHARS = new Set(['█', '▀', '▄', '▌', '▐', '░', '▒', '▓']);

// Block-letter "OX" text (always shown)
const OX_TEXT = [
  ' ██████╗ ██╗  ██╗',
  '██╔═══██╗╚██╗██╔╝',
  '██║   ██║ ╚███╔╝ ',
  '██║   ██║ ██╔██╗ ',
  '╚██████╔╝██╔╝ ██╗',
  ' ╚═════╝ ╚═╝  ╚═╝',
];

// Line-art ox animal (shown when wide enough), padded to same height as OX_TEXT
const OX_ANIMAL = [
  '',
  '\\|/          (__)',
  '     `\\------(oo)',
  '       ||    (__)',
  '       ||w--||     \\|/',
  '  \\|/',
];

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

const OX_TEXT_SEGMENTS = linesToSegments(OX_TEXT);
const OX_TEXT_WIDTH = getMaxLineLength(OX_TEXT);
const OX_ANIMAL_SEGMENTS = linesToSegments(OX_ANIMAL);
const OX_ANIMAL_WIDTH = getMaxLineLength(OX_ANIMAL);
const ANIMAL_GAP = 3;
const WIDE_TITLE_WIDTH = OX_TEXT_WIDTH + ANIMAL_GAP + OX_ANIMAL_WIDTH;

type Segments = { text: string; type: CharType }[][];

function SegmentRows({
  segments,
  theme,
  keyPrefix,
}: {
  segments: Segments;
  theme: { text: string; textMuted: string };
  keyPrefix: string;
}) {
  return segments.map((rowSegments) => {
    const rowKey = rowSegments
      .map((segment) => `${segment.type}:${segment.text}`)
      .join('|');
    let segmentOffset = 0;

    return (
      <box flexDirection="row" key={`${keyPrefix}-row-${rowKey}`}>
        {rowSegments.map((segment) => {
          const fg =
            segment.type === 'solid'
              ? theme.text
              : segment.type === 'outline'
                ? theme.textMuted
                : undefined;
          const segmentKey = `${keyPrefix}-seg-${rowKey}-${segment.type}-${segmentOffset}`;
          segmentOffset += segment.text.length;
          return (
            <text key={segmentKey} fg={fg}>
              {segment.text}
            </text>
          );
        })}
      </box>
    );
  });
}

/**
 * Responsive ASCII art title for "ox".
 * Always shows block-letter "OX" text.
 * When the terminal is wide enough, also shows a line-art ox animal to the right.
 */
export function OxTitle() {
  const { theme } = useTheme();
  const { columns } = useWindowSize();

  const containerWidth = Math.max(columns - TITLE_PADDING, 0);
  const isWideTitle = containerWidth >= WIDE_TITLE_WIDTH;

  return (
    <box marginBottom={2} width="100%" alignItems="center">
      <box flexDirection="row" alignItems="flex-start">
        <box flexDirection="column">
          <SegmentRows
            segments={OX_TEXT_SEGMENTS}
            theme={theme}
            keyPrefix="text"
          />
        </box>
        {isWideTitle && (
          <box flexDirection="column" marginLeft={ANIMAL_GAP}>
            <SegmentRows
              segments={OX_ANIMAL_SEGMENTS}
              theme={theme}
              keyPrefix="animal"
            />
          </box>
        )}
      </box>
    </box>
  );
}
