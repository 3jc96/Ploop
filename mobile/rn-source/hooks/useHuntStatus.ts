import { useCallback, useEffect, useState } from 'react';
import { api } from '../../src/services/api';

export type HuntStatus = {
  active: boolean;
  daysUntilStart: number | null;
  goldenToiletsRemaining: Record<string, number> | null;
  startsAt: string | null;
  endsAt: string | null;
};

export function useHuntStatus() {
  const [status, setStatus] = useState<HuntStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.hunt.getStatus();
      setStatus(data);
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

  return { status, loading, error, reload: load, totalRemaining };
}
