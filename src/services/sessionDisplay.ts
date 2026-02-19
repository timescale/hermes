import type { HermesSession } from './sandbox/types.ts';

export function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `${diffDays}d ago`;
  }
  if (diffHours > 0) {
    return `${diffHours}h ago`;
  }
  if (diffMins > 0) {
    return `${diffMins}m ago`;
  }
  return 'just now';
}

export function getStatusIcon(session: HermesSession): string {
  switch (session.status) {
    case 'running':
      return '●';
    case 'exited':
      return session.exitCode === 0 ? '✓' : '✗';
    case 'stopped':
      return '⏸';
    case 'unknown':
      return '○';
    default:
      return '○';
  }
}

export function getStatusText(session: HermesSession): string {
  if (session.status === 'exited') {
    return session.exitCode === 0 ? 'complete' : `failed (${session.exitCode})`;
  }
  return session.status;
}

export function getStatusColor(session: HermesSession): string {
  switch (session.status) {
    case 'running':
      return 'green';
    case 'exited':
      return session.exitCode === 0 ? 'blue' : 'red';
    case 'stopped':
      return 'yellow';
    case 'unknown':
      return 'gray';
    default:
      return 'gray';
  }
}
