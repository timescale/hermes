import type { ReactNode } from 'react';

export interface ModalProps {
  title: string;
  children: ReactNode;
  minWidth?: number;
  maxWidth?: number;
  padding?: number;
  paddingLeft?: number;
  paddingRight?: number;
}

export function Modal({
  title,
  children,
  minWidth = 40,
  maxWidth = 60,
  padding = 2,
  paddingLeft = 3,
  paddingRight = 3,
}: ModalProps) {
  return (
    <box
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <box
        title={title}
        style={{
          border: true,
          borderStyle: 'single',
          padding,
          paddingLeft,
          paddingRight,
          flexDirection: 'column',
          minWidth,
          maxWidth,
          backgroundColor: '#1f232a',
        }}
      >
        {children}
      </box>
    </box>
  );
}
