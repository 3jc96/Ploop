import { useCallback, useEffect, useState } from 'react';
import { api } from '../../src/services/api';

export type HuntStatus = {
  active: boolean;
  daysUntilStart: number | null;
  goldenToiletsRemaining: Record<string, number> | null;
  startsAt: string | null;
  endsAt: string | null;
};

export type LeaderboardEntry = {
  rank: number;
  displayName: string;
  found: number;
  lastFoundAt: string;
};

export type HuntProgress = {
  found: number;
  totalGolden: number | null;
  rank: number | null;
  percentile: number | null;
  totalHunters?: number;
};

export function useHuntStatus() {
  const [status, setStatus] = useState<HuntStatus | null>(null);
  const [leaders, setLeaders] = useState<LeaderboardEntry[]>([]);
  const [progress, setProgress] = useState<HuntProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusData, leaderData, progressData] = await Promise.all([
        api.hunt.getStatus(),
        api.hunt.getLeaderboard({ limit: 20 }).catch(() => ({ scope: 'current', leaders: [] })),
        api.hunt.getMyProgress().catch(() => null),
      ]);
      setStatus(statusData);
      setLeaders(leaderData.leaders ?? []);
      setProgress(progressData);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load hunt status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totalRemaining = status?.goldenToiletsRemaining
    ? Object.values(status.goldenToiletsRemaining).reduce((a, b) => a + b, 0)
    : 0;

  return { status, leaders, progress, loading, error, reload: load, totalRemaining };
}
