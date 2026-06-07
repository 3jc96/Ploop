import React from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors, radius, spacing, typography } from '../theme';
import { ScrollPage } from '../components/ui';
import { useProfileData, ProfileStats } from '../hooks/useProfileData';
import { useAuth } from '../../src/context/AuthContext';

type ProfileScreenProps = {
  username?: string;
  memberSince?: string;
  stats?: ProfileStats;
  email?: string;
};

function StatCell({ value, label }: { value: string | number; label: string }) {
  return (
    <View style={styles.statCell}>
      <Text style={styles.statNum}>{value}</Text>
      <Text style={styles.statLbl}>{label}</Text>
    </View>
  );
}

function SettingRow({
  icon,
  iconBg,
  label,
  onPress,
}: {
  icon: string;
  iconBg: string;
  label: string;
  onPress?: () => void;
}) {
  return (
    <Pressable style={styles.profRow} onPress={onPress}>
      <View style={[styles.profIco, { backgroundColor: iconBg }]}>
        <Text style={{ fontSize: 15 }}>{icon}</Text>
      </View>
      <Text style={styles.profRowLbl}>{label}</Text>
      <Text style={styles.chev}>{'\u203a'}</Text>
    </Pressable>
  );
}

export default function ProfileScreen(props: ProfileScreenProps) {
  const navigation = useNavigation<any>();
  const live = useProfileData();
  const { user, logout } = useAuth();

  if (live.loading && !props.username) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.blue} />
      </View>
    );
  }

  const username = props.username ?? live.username;
  const memberSince = props.memberSince ?? live.memberSince;
  const stats = props.stats ?? live.stats;

  const openSettings = () => Linking.openSettings().catch(() => {});
  const rateApp = () =>
    Linking.openURL('https://apps.apple.com/app/id6759898612?action=write-review').catch(() => {});

  return (
    <ScrollPage style={styles.container}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarEmoji}>{'\ud83d\udeBD'}</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={styles.profName} numberOfLines={1}>
            {username.startsWith('@') ? username : `@${username}`}
          </Text>
          <Text style={styles.profSince}>{memberSince}</Text>
        </View>
      </View>

      <View style={styles.statRow}>
        <StatCell value={stats.reviews} label="Reviews" />
        <View style={styles.statDivider} />
        <StatCell value={stats.checkIns} label="Check-ins" />
        <View style={styles.statDivider} />
        <StatCell value={stats.saved} label="Saved" />
      </View>

      <Text style={styles.sectionLabel}>Settings</Text>
      <View style={styles.section}>
        <SettingRow
          icon={'\ud83d\udd14'}
          iconBg="#ffe4e6"
          label="Notifications"
          onPress={openSettings}
        />
        <SettingRow icon={'\ud83d\udd12'} iconBg="#dbeafe" label="Privacy" onPress={openSettings} />
        <SettingRow
          icon={'\ud83d\udccd'}
          iconBg="#dcfce7"
          label="Location Sharing"
          onPress={openSettings}
        />
        <SettingRow icon={'\u2b50'} iconBg="#fef9c3" label="Rate Ploop" onPress={rateApp} />
      </View>

      {user ? (
        <Pressable style={styles.signOut} onPress={() => logout()}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      ) : (
        <Pressable style={styles.signOut} onPress={() => navigation.navigate('Login')}>
          <Text style={[styles.signOutText, { color: colors.blue }]}>Sign in</Text>
        </Pressable>
      )}

      <View style={{ height: spacing.xl }} />
    </ScrollPage>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.bg2 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg2 },

  header: {
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  avatar: {
    width: 64,
    height: 64,
    backgroundColor: colors.blueLight,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.blue,
  },
  avatarEmoji: { fontSize: 28 },
  headerText: { flex: 1, minWidth: 0 },
  profName: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3, color: colors.label },
  profSince: { fontSize: 13, color: colors.label2, marginTop: 2 },

  statRow: {
    flexDirection: 'row',
    backgroundColor: colors.bg,
    borderRadius: radius.xl,
    margin: spacing.sm,
    overflow: 'hidden',
  },
  statCell: { flex: 1, paddingVertical: 14, paddingHorizontal: 10, alignItems: 'center' },
  statDivider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  statNum: { fontSize: 22, fontWeight: '700', color: colors.label, letterSpacing: -0.5 },
  statLbl: { fontSize: 11, color: colors.label2, marginTop: 2, fontWeight: '500' },

  sectionLabel: {
    ...typography.sectionLabel,
    color: colors.label2,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: 7,
  },
  section: {
    backgroundColor: colors.bg,
    marginHorizontal: spacing.sm,
    borderRadius: radius.xl,
    overflow: 'hidden',
  },
  profRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: spacing.lg,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  profIco: {
    width: 30,
    height: 30,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profRowLbl: { flex: 1, fontSize: 15, fontWeight: '500', color: colors.label },
  chev: { color: colors.label3, fontSize: 20 },

  signOut: {
    margin: spacing.sm,
    marginTop: spacing.lg,
    backgroundColor: colors.bg,
    borderRadius: radius.xl,
    paddingVertical: 14,
    alignItems: 'center',
  },
  signOutText: { fontSize: 15, fontWeight: '600', color: colors.red },
});
