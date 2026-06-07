import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useProfileData, ProfileData, ProfileStats } from '../hooks/useProfileData';

type ProfileScreenProps = {
  /** Override hook data when embedding in tests or storybook. */
  username?: string;
  memberSince?: string;
  stats?: ProfileStats;
  email?: string;
};

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ProfileContent({
  username,
  memberSince,
  stats,
  email,
  onRefresh,
  refreshing,
}: {
  username: string;
  memberSince: string;
  stats: ProfileStats;
  email: string;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{username.slice(0, 1).toUpperCase()}</Text>
        </View>
        <Text style={styles.username}>{username}</Text>
        <Text style={styles.memberSince}>{memberSince}</Text>
        {email ? <Text style={styles.email}>{email}</Text> : null}
      </View>

      <View style={styles.statsRow}>
        <StatCard label="Reviews" value={stats.reviews} />
        <StatCard label="Check-ins" value={stats.checkIns} />
        <StatCard label="Saved" value={stats.saved} />
      </View>

      {onRefresh ? (
        <Pressable style={styles.refreshButton} onPress={onRefresh} disabled={refreshing}>
          <Text style={styles.refreshText}>{refreshing ? 'Refreshing…' : 'Refresh profile'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function ProfileScreen(props: ProfileScreenProps) {
  const live = useProfileData();

  if (live.loading && !props.username) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  const data: Pick<ProfileData, 'username' | 'memberSince' | 'stats' | 'email'> = {
    username: props.username ?? live.username,
    memberSince: props.memberSince ?? live.memberSince,
    stats: props.stats ?? live.stats,
    email: props.email ?? live.email,
  };

  return (
    <ProfileContent
      username={data.username}
      memberSince={data.memberSince}
      stats={data.stats}
      email={data.email}
      onRefresh={props.username ? undefined : live.refresh}
      refreshing={live.loading}
    />
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
  },
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 28,
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#dbeafe',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: {
    fontSize: 36,
    fontWeight: '700',
    color: '#1d4ed8',
  },
  username: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0f172a',
  },
  memberSince: {
    marginTop: 4,
    fontSize: 14,
    color: '#64748b',
  },
  email: {
    marginTop: 2,
    fontSize: 13,
    color: '#94a3b8',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0f172a',
  },
  statLabel: {
    marginTop: 4,
    fontSize: 12,
    color: '#64748b',
  },
  refreshButton: {
    marginTop: 24,
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#2563eb',
  },
  refreshText: {
    color: '#fff',
    fontWeight: '600',
  },
});
