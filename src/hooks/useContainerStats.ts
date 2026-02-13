import { useEffect, useState } from 'react';
import { type ContainerStats, getContainerStats } from '../services/docker';
import { log } from '../services/logger';

/** Polling interval for container stats (1 second) */
const STATS_POLL_INTERVAL = 1000;

/**
 * Hook that polls `docker stats` every second for the given running container IDs.
 * Returns a Map<containerId, ContainerStats>.
 * Only fetches when there are running container IDs provided.
 *
 * Important: callers must pass a stable (memoized) array reference to avoid
 * restarting the polling interval on every render.
 */
export function useContainerStats(
  containerIds: string[],
): Map<string, ContainerStats> {
  const [stats, setStats] = useState<Map<string, ContainerStats>>(
    () => new Map(),
  );

  useEffect(() => {
    if (containerIds.length === 0) {
      setStats(new Map());
      return;
    }

    log.debug({ containerIds }, 'Starting container stats polling');
    let cancelled = false;

    const fetchStats = async () => {
      if (cancelled) return;
      const result = await getContainerStats(containerIds);
      if (!cancelled) {
        log.trace(
          { statsCount: result.size, containerCount: containerIds.length },
          'Container stats update',
        );
        setStats(result);
      }
    };

    // Fetch immediately, then poll
    fetchStats();
    const interval = setInterval(fetchStats, STATS_POLL_INTERVAL);

    return () => {
      log.debug('Stopping container stats polling');
      cancelled = true;
      clearInterval(interval);
    };
  }, [containerIds]);

  return stats;
}
