import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../src/context/AuthContext';
import { api } from '../../src/services/api';

export type ProfileStats = {
  reviews: number;
  checkIns: number;
  saved: number;
};

export type ProfileData = {
  username: string;
  email: string;
  memberSince: string;
  memberSinceDate: Date | null;
  stats: ProfileStats;
  role: string;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

function formatMemberSince(createdAt?: string): { label: string; date: Date | null } {
  if (!createdAt) return { label: 'Member', date: null };
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return { label: 'Member', date: null };
  const label = date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return { label: `Member since ${label}`, date };
}

export function useProfileData(): ProfileData {
  const { user, loading: authLoading, refreshUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileUser, setProfileUser] = useState(user);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await refreshUser();
      const { user: me } = await api.auth.getMe();
      setProfileUser(me);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [refreshUser]);

  useEffect(() => {
    if (user) setProfileUser(user);
  }, [user]);

  useEffect(() => {
    if (!authLoading && user) {
      refresh().catch(() => {});
    }
  }, [authLoading, user?.id]);

  const memberSince = formatMemberSince(profileUser?.created_at);

  return useMemo(
    () => ({
      username: profileUser?.display_name || profileUser?.email?.split('@')[0] || 'Guest',
      email: profileUser?.email ?? '',
      memberSince: memberSince.label,
      memberSinceDate: memberSince.date,
      stats: {
        reviews: profileUser?.review_count ?? 0,
        checkIns: profileUser?.checkin_count ?? 0,
        saved: profileUser?.favorite_count ?? 0,
      },
      role: profileUser?.role ?? 'user',
      loading: authLoading || loading,
      error,
      refresh,
    }),
    [profileUser, memberSince, authLoading, loading, error, refresh]
  );
}
