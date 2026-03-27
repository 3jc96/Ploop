import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
  Switch,
  TextInput,
  Platform,
  Pressable,
  Linking,
  Modal,
  Share,
  Alert,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Notifications from 'expo-notifications';
import { useNavigation, CommonActions } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { getErrorMessage } from '../utils/engagement';
import { confirmAsync, showAlert } from '../utils/alert';
import {
  hasAdminPin,
  setAdminPin,
  verifyAdminPin,
  isBiometricAvailable,
  authenticateWithBiometric,
} from '../utils/adminLock';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_HEIGHT = 160;
const BAR_GAP = 4;

type Tab = 'overview' | 'moderation' | 'users' | 'diagnostics' | 'hunt';
type GroupBy = 'day' | 'week' | 'month';
type RangePreset = '7d' | '30d' | '90d';

function formatPeriod(period: string | unknown, groupBy: string): string {
  if (period == null) return '';
  const d = new Date(String(period));
  if (isNaN(d.getTime())) return String(period);
  if (groupBy === 'month') return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  if (groupBy === 'week') return `W${Math.ceil(d.getDate() / 7)} ${d.toLocaleDateString(undefined, { month: 'short' })}`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function BarChart({
  data,
  labelKey,
  valueKey,
  color,
  formatLabel,
  title,
  onBarPress,
  groupBy = 'day',
}: {
  data: Array<{ [k: string]: any }>;
  labelKey: string;
  valueKey: string;
  color: string;
  formatLabel?: (v: any) => string;
  title?: string;
  onBarPress?: (d: any, v: number) => void;
  groupBy?: string;
}) {
  const max = Math.max(1, ...data.map((d) => Number(d[valueKey]) || 0));
  const [touchedBar, setTouchedBar] = useState<number | null>(null);
  const displayData = data.slice(-14);
  const touchedData = touchedBar != null ? displayData[touchedBar] : null;
  const touchedValue = touchedData ? Number(touchedData[valueKey]) || 0 : 0;
  return (
    <View style={styles.chartContainer}>
      {title ? <Text style={styles.chartTitle}>{title}</Text> : null}
      {touchedBar != null && touchedData && (
        <View style={styles.chartTooltip}>
          <Text style={styles.chartTooltipLabel}>
            {formatLabel ? formatLabel(touchedData[labelKey]) : String(touchedData[labelKey])}
          </Text>
          <Text style={styles.chartTooltipValue}>{touchedValue}</Text>
        </View>
      )}
      {displayData.map((d, i) => {
        const v = Number(d[valueKey]) || 0;
        const pct = max ? (v / max) * 100 : 0;
        const isTouched = touchedBar === i;
        return (
          <Pressable
            key={i}
            style={[styles.barRow, isTouched && styles.barRowTouched]}
            onPress={() => {
              setTouchedBar((prev) => (prev === i ? null : i));
              onBarPress?.(d, v);
            }}
          >
            <Text style={styles.barLabel} numberOfLines={1}>
              {formatLabel ? formatLabel(d[labelKey]) : String(d[labelKey])}
            </Text>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: color }]} />
            </View>
            <Text style={[styles.barValue, isTouched && styles.barValueTouched]}>{v}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function MiniLineChart({ data, color, valueKey }: { data: Array<{ [k: string]: any }>; color: string; labelKey: string; valueKey: string }) {
  const max = Math.max(1, ...data.map((d) => Number(d[valueKey]) || 0));
  const points = data.slice(-14).map((d) => ({ y: max ? (Number(d[valueKey]) || 0) / max : 0 }));
  const barWidth = Math.max(4, (SCREEN_WIDTH - 80) / 2 / Math.max(1, points.length) - 2);
  const barMaxHeight = 60;
  return (
    <View style={styles.miniLineChart}>
      {points.map((p, i) => (
        <View
          key={i}
          style={[
            styles.miniLineBar,
            {
              width: barWidth,
              height: Math.max(3, p.y * barMaxHeight),
              backgroundColor: color,
            },
          ]}
        />
      ))}
    </View>
  );
}

export default function AdminScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [diagnostics, setDiagnostics] = useState<{ summary: any[]; recent: any[] } | null>(null);
  const [crashReports, setCrashReports] = useState<any[]>([]);
  const [rangePreset, setRangePreset] = useState<RangePreset>('30d');
  const [groupBy, setGroupBy] = useState<GroupBy>('day');
  const [dashboard, setDashboard] = useState<any>(null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [reviewsTotal, setReviewsTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showEventsChart, setShowEventsChart] = useState(true);
  const [showTopToilets, setShowTopToilets] = useState(true);
  const [expandedReviewId, setExpandedReviewId] = useState<string | null>(null);
  const [editingReview, setEditingReview] = useState<any | null>(null);
  const [editCleanliness, setEditCleanliness] = useState<string>('');
  const [editSmell, setEditSmell] = useState<string>('');
  const [editReviewText, setEditReviewText] = useState<string>('');
  const [editReviewedBy, setEditReviewedBy] = useState<string>('');
  const [editToiletName, setEditToiletName] = useState<string>('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Users tab
  const [usersList, setUsersList] = useState<any[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersOffset, setUsersOffset] = useState(0);
  const [usersSearch, setUsersSearch] = useState('');
  const [usersSearchInput, setUsersSearchInput] = useState('');
  const [exportingCsv, setExportingCsv] = useState(false);
  const USERS_PAGE_SIZE = 50;

  // Hunt tab
  const [huntData, setHuntData] = useState<any>(null);
  const [huntCheckins, setHuntCheckins] = useState<any[]>([]);
  const [huntCheckinsTotal, setHuntCheckinsTotal] = useState(0);
  const [huntLoading, setHuntLoading] = useState(false);
  const [huntActionBusy, setHuntActionBusy] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<any | null>(null);
  const [exportingHunt, setExportingHunt] = useState(false);
  const [huntDuration, setHuntDuration] = useState('21');

  // Admin lock: PIN + Face ID / Touch ID
  const [pinStatus, setPinStatus] = useState<'loading' | 'none' | 'set'>('loading');
  const [unlocked, setUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinError, setPinError] = useState('');
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  const isAdmin = user?.role === 'admin';

  const goBack = useCallback(() => {
    const nav = navigation as any;
    if (nav.canGoBack?.()) {
      nav.goBack();
    } else {
      nav.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'Map' }] }));
    }
  }, [navigation]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    hasAdminPin().then((has) => {
      if (!cancelled) setPinStatus(has ? 'set' : 'none');
    });
    isBiometricAvailable().then((ok) => {
      if (!cancelled) setBiometricAvailable(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin || pinStatus !== 'set' || unlocked) return;
    let cancelled = false;
    authenticateWithBiometric().then((success) => {
      if (!cancelled && success) setUnlocked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, pinStatus, unlocked]);

  const getDateRange = useCallback((): { from: string; to: string } => {
    const to = new Date();
    const from = new Date();
    if (rangePreset === '7d') from.setDate(from.getDate() - 7);
    else if (rangePreset === '30d') from.setDate(from.getDate() - 30);
    else from.setDate(from.getDate() - 90);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [rangePreset]);

  const loadDashboard = useCallback(async () => {
    if (!isAdmin) return;
    const { from, to } = getDateRange();
    try {
      const data = await api.admin.getDashboard({ from, to, groupBy });
      setDashboard(data);
    } catch (e) {
      console.error(e);
      setDashboard(null);
    }
  }, [isAdmin, getDateRange, groupBy]);

  const [reviewsOffset, setReviewsOffset] = useState(0);
  const REVIEWS_PAGE_SIZE = 100;

  const loadReviews = useCallback(async (append = false) => {
    if (!isAdmin) return;
    const offset = append ? reviewsOffset : 0;
    try {
      const data = await api.admin.getReviews({ limit: REVIEWS_PAGE_SIZE, offset });
      if (append) {
        setReviews((prev) => [...prev, ...data.reviews]);
      } else {
        setReviews(data.reviews);
      }
      setReviewsTotal(data.total);
      setReviewsOffset(append ? offset + data.reviews.length : data.reviews.length);
    } catch (e) {
      console.error(e);
      if (!append) setReviews([]);
    }
  }, [isAdmin, reviewsOffset]);

  const loadDiagnostics = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const data = await api.admin.getDiagnostics({ limit: 100 });
      setDiagnostics(data);
    } catch (e) {
      console.error(e);
      setDiagnostics(null);
    }
  }, [isAdmin]);

  const loadCrashReports = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const data = await api.admin.getCrashReports({ limit: 50 });
      setCrashReports(data.crashReports || []);
    } catch (e) {
      console.error(e);
      setCrashReports([]);
    }
  }, [isAdmin]);

  const loadUsers = useCallback(async (append = false) => {
    if (!isAdmin) return;
    const offset = append ? usersOffset : 0;
    try {
      const data = await api.admin.getUsers({ limit: USERS_PAGE_SIZE, offset, search: usersSearch || undefined });
      if (append) {
        setUsersList((prev) => [...prev, ...data.users]);
      } else {
        setUsersList(data.users);
      }
      setUsersTotal(data.total);
      setUsersOffset(append ? offset + data.users.length : data.users.length);
    } catch (e) {
      console.error(e);
      if (!append) setUsersList([]);
    }
  }, [isAdmin, usersOffset, usersSearch]);

  const handleExportCsv = useCallback(async () => {
    setExportingCsv(true);
    try {
      const csv = await api.admin.getUsersCsv(usersSearch || undefined);
      const filename = `ploop-users-${new Date().toISOString().slice(0, 10)}.csv`;
      const fileUri = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' });
      } else {
        Alert.alert('Exported', `CSV saved to ${fileUri}`);
      }
    } catch (e: any) {
      showAlert('Export failed', getErrorMessage(e, 'Could not export users'));
    } finally {
      setExportingCsv(false);
    }
  }, [usersSearch]);

  const loadHuntDashboard = useCallback(async () => {
    setHuntLoading(true);
    try {
      const [dash, checkinRes] = await Promise.all([
        api.hunt.admin.getDashboard(),
        api.hunt.admin.getCheckins({ limit: 100 }),
      ]);
      setHuntData(dash);
      setHuntCheckins(checkinRes.checkins);
      setHuntCheckinsTotal(checkinRes.total);
    } catch (e: any) {
      showAlert('Hunt error', getErrorMessage(e));
    } finally {
      setHuntLoading(false);
    }
  }, []);

  const huntAction = useCallback(async (label: string, fn: () => Promise<any>) => {
    setHuntActionBusy(label);
    try {
      await fn();
      await loadHuntDashboard();
    } catch (e: any) {
      Alert.alert('Error', getErrorMessage(e));
    } finally {
      setHuntActionBusy(null);
    }
  }, [loadHuntDashboard]);

  const exportHuntCsv = useCallback(async () => {
    setExportingHunt(true);
    try {
      const csv = await api.hunt.admin.exportCsv();
      const FS = FileSystem as any;
      const path = `${FS.cacheDirectory}ploop-golden-hunt.csv`;
      await FS.writeAsStringAsync(path, csv, { encoding: 'utf8' });
      await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: 'Export Golden Hunt Check-ins' });
    } catch (e: any) {
      Alert.alert('Export failed', getErrorMessage(e));
    } finally {
      setExportingHunt(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const tasks = [loadDashboard(), loadReviews()];
    if (tab === 'diagnostics') {
      tasks.push(loadDiagnostics(), loadCrashReports());
    }
    if (tab === 'users') {
      tasks.push(loadUsers());
    }
    if (tab === 'hunt') {
      tasks.push(loadHuntDashboard());
    }
    await Promise.all(tasks);
    setRefreshing(false);
  }, [loadDashboard, loadReviews, loadDiagnostics, loadCrashReports, loadUsers, loadHuntDashboard, tab]);

  useEffect(() => {
    if (!isAdmin) return;
    setLoading(true);
    loadDashboard().then(() => setLoading(false));
  }, [isAdmin, loadDashboard, rangePreset, groupBy]);

  useEffect(() => {
    if (!isAdmin || tab !== 'moderation') return;
    setReviewsOffset(0);
    loadReviews(false);
  }, [isAdmin, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isAdmin || tab !== 'diagnostics') return;
    loadDiagnostics();
    loadCrashReports();
  }, [isAdmin, tab, loadDiagnostics, loadCrashReports]);

  useEffect(() => {
    if (!isAdmin || tab !== 'users') return;
    setUsersOffset(0);
    loadUsers();
  }, [isAdmin, tab, usersSearch]);

  useEffect(() => {
    if (!isAdmin || tab !== 'hunt') return;
    loadHuntDashboard();
    const interval = setInterval(loadHuntDashboard, 30_000);
    return () => clearInterval(interval);
  }, [isAdmin, tab, loadHuntDashboard]);

  // Register push token for suggestion notifications (native only)
  useEffect(() => {
    if (!isAdmin || !unlocked || Platform.OS === 'web') return;
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Notifications.requestPermissionsAsync();
        if (cancelled || status !== 'granted') return;
        const tokenData = await Notifications.getExpoPushTokenAsync({
          projectId: '1a68d0eb-38ca-4355-8647-ecae49131430',
        });
        const token = tokenData?.data;
        if (cancelled || !token) return;
        await api.admin.registerPushToken(token);
      } catch (e) {
        if (!cancelled) console.warn('[Admin] Push token registration failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin, unlocked]);

  const handleEditReview = (r: any) => {
    setEditingReview(r);
    setEditToiletName(r.toilet_name ?? '');
    setEditCleanliness(String(r.cleanliness_score ?? ''));
    setEditSmell(String(r.smell_score ?? ''));
    setEditReviewText(r.review_text ?? '');
    setEditReviewedBy(r.reviewed_by ?? r.user_display_name ?? r.user_email ?? '');
  };

  const handleSaveEdit = async () => {
    if (!editingReview) return;
    const cleanliness = editCleanliness ? parseInt(editCleanliness, 10) : undefined;
    const smell = editSmell ? parseInt(editSmell, 10) : undefined;
    if ((cleanliness !== undefined && (cleanliness < 1 || cleanliness > 5)) ||
        (smell !== undefined && (smell < 1 || smell > 5))) {
      showAlert('Error', 'Scores must be 1–5.');
      return;
    }
    const payload: { cleanliness_score?: number; smell_score?: number; review_text?: string; reviewed_by?: string; toilet_name?: string } = {};
    if (cleanliness !== undefined) payload.cleanliness_score = cleanliness;
    if (smell !== undefined) payload.smell_score = smell;
    payload.review_text = editReviewText.trim();
    payload.reviewed_by = editReviewedBy.trim();
    if (editToiletName.trim()) payload.toilet_name = editToiletName.trim();
    setSavingEdit(true);
    try {
      await api.admin.updateReview(editingReview.id, payload);
      setEditingReview(null);
      loadReviews();
      if (dashboard) loadDashboard();
    } catch (e: any) {
      let msg = getErrorMessage(e, 'Failed to update review.');
      if (e?.response?.status === 404) {
        msg += ' If using the cloud backend (Render), redeploy it so it includes the PATCH route.';
      }
      showAlert('Error', msg);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteReview = async (id: string, toiletName: string) => {
    const ok = await confirmAsync('Remove review', `Delete this review for "${toiletName}"?`, {
      confirmText: 'Delete',
      cancelText: 'Cancel',
    });
    if (!ok) return;
    try {
      await api.admin.deleteReview(id);
      loadReviews();
      if (dashboard) loadDashboard();
    } catch (e: any) {
      showAlert('Error', getErrorMessage(e, 'Failed to delete review.'));
    }
  };

  if (!user) {
    return (
      <View style={styles.centered}>
        <Text style={styles.unauthorized}>Sign in required</Text>
        <Text style={styles.unauthorizedSub}>Sign in with an admin account to continue.</Text>
        <TouchableOpacity
          style={styles.signInBtn}
          onPress={() => (navigation as any).navigate('Login')}
        >
          <Text style={styles.signInBtnText}>Sign in</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backBtn} onPress={() => goBack()}>
          <Text style={styles.backBtnText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!isAdmin) {
    return (
      <View style={styles.centered}>
        <Text style={styles.unauthorized}>Admin access only</Text>
        <Text style={styles.unauthorizedSub}>Sign in with an admin account to continue.</Text>
        <TouchableOpacity
          style={styles.signInBtn}
          onPress={() => (navigation as any).navigate('Login')}
        >
          <Text style={styles.signInBtnText}>Sign in</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backBtn} onPress={() => goBack()}>
          <Text style={styles.backBtnText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (pinStatus === 'loading') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#6366f1" />
        <Text style={styles.unauthorized}>Loading…</Text>
      </View>
    );
  }

  if (pinStatus === 'none') {
    const handleSetPin = async () => {
      setPinError('');
      if (pinInput.length !== 4 || !/^\d{4}$/.test(pinInput)) {
        setPinError('Enter 4 digits');
        return;
      }
      if (pinInput !== pinConfirm) {
        setPinError('PINs do not match');
        return;
      }
      try {
        await setAdminPin(pinInput);
        setPinStatus('set');
        setUnlocked(true);
      } catch (e: any) {
        setPinError(getErrorMessage(e, 'Could not save PIN'));
      }
    };
    return (
      <View style={styles.unlockContainer}>
        <TouchableOpacity style={styles.backBtn} onPress={() => goBack()}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.unlockTitle}>Set Admin PIN</Text>
        <Text style={styles.unlockSubtitle}>Enter a 4-digit PIN to protect Admin. You can use this or Face ID to unlock.</Text>
        <TextInput
          style={styles.pinInput}
          placeholder="••••"
          value={pinInput}
          onChangeText={(t) => { setPinInput(t.replace(/\D/g, '').slice(0, 4)); setPinError(''); }}
          keyboardType="number-pad"
          maxLength={4}
          secureTextEntry
        />
        <TextInput
          style={styles.pinInput}
          placeholder="Confirm PIN"
          value={pinConfirm}
          onChangeText={(t) => { setPinConfirm(t.replace(/\D/g, '').slice(0, 4)); setPinError(''); }}
          keyboardType="number-pad"
          maxLength={4}
          secureTextEntry
        />
        {pinError ? <Text style={styles.pinError}>{pinError}</Text> : null}
        <TouchableOpacity style={styles.unlockButton} onPress={handleSetPin}>
          <Text style={styles.unlockButtonText}>Set PIN</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (pinStatus === 'set' && !unlocked) {
    const handleUnlock = async () => {
      setPinError('');
      if (pinInput.length !== 4) {
        setPinError('Enter 4 digits');
        return;
      }
      const ok = await verifyAdminPin(pinInput);
      if (ok) setUnlocked(true);
      else setPinError('Wrong PIN');
    };
    const handleFaceId = async () => {
      setPinError('');
      const ok = await authenticateWithBiometric();
      if (ok) setUnlocked(true);
      else setPinError('Authentication failed');
    };
    return (
      <View style={styles.unlockContainer}>
        <TouchableOpacity style={styles.backBtn} onPress={() => goBack()}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.unlockTitle}>Unlock Admin</Text>
        {biometricAvailable && (
          <TouchableOpacity style={styles.unlockButton} onPress={handleFaceId}>
            <Text style={styles.unlockButtonText}>{Platform.OS === 'ios' ? 'Face ID' : 'Biometric'}</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.unlockSubtitle}>Or enter your 4-digit PIN</Text>
        <TextInput
          style={styles.pinInput}
          placeholder="••••"
          value={pinInput}
          onChangeText={(t) => { setPinInput(t.replace(/\D/g, '').slice(0, 4)); setPinError(''); }}
          keyboardType="number-pad"
          maxLength={4}
          secureTextEntry
        />
        {pinError ? <Text style={styles.pinError}>{pinError}</Text> : null}
        <TouchableOpacity style={[styles.unlockButton, styles.unlockButtonSecondary]} onPress={handleUnlock}>
          <Text style={styles.unlockButtonText}>Unlock</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => goBack()} style={styles.headerBack}>
          <Text style={styles.headerBackText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Admin</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs} contentContainerStyle={styles.tabsContent}>
        <TouchableOpacity
          style={[styles.tab, tab === 'overview' && styles.tabActive]}
          onPress={() => setTab('overview')}
        >
          <Text style={[styles.tabText, tab === 'overview' && styles.tabTextActive]}>Overview</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'moderation' && styles.tabActive]}
          onPress={() => setTab('moderation')}
        >
          <Text style={[styles.tabText, tab === 'moderation' && styles.tabTextActive]}>Moderation</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'users' && styles.tabActive]}
          onPress={() => setTab('users')}
        >
          <Text style={[styles.tabText, tab === 'users' && styles.tabTextActive]}>Users</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'diagnostics' && styles.tabActive]}
          onPress={() => setTab('diagnostics')}
        >
          <Text style={[styles.tabText, tab === 'diagnostics' && styles.tabTextActive]}>Diagnostics</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'hunt' && styles.tabActive]}
          onPress={() => setTab('hunt')}
        >
          <Text style={[styles.tabText, tab === 'hunt' && styles.tabTextActive]}>🚽 Hunt</Text>
        </TouchableOpacity>
      </ScrollView>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#6366f1" />
        }
      >
        {tab === 'overview' && (
          <>
            <View style={styles.filters}>
              <Text style={styles.filterLabel}>Range</Text>
              <View style={styles.filterChips}>
                {(['7d', '30d', '90d'] as const).map((p) => (
                  <TouchableOpacity
                    key={p}
                    style={[styles.chip, rangePreset === p && styles.chipActive]}
                    onPress={() => setRangePreset(p)}
                  >
                    <Text style={[styles.chipText, rangePreset === p && styles.chipTextActive]}>{p}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[styles.filterLabel, { marginTop: 12 }]}>Group by</Text>
              <View style={styles.filterChips}>
                {(['day', 'week', 'month'] as const).map((g) => (
                  <TouchableOpacity
                    key={g}
                    style={[styles.chip, groupBy === g && styles.chipActive]}
                    onPress={() => setGroupBy(g)}
                  >
                    <Text style={[styles.chipText, groupBy === g && styles.chipTextActive]}>{g}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {loading && !dashboard ? (
              <ActivityIndicator size="large" color="#6366f1" style={styles.loader} />
            ) : dashboard ? (
              <>
                <View style={styles.cards}>
                  <View style={[styles.card, { backgroundColor: '#6366f1' }]}>
                    <Text style={styles.cardValue}>{dashboard.totals?.reviews ?? 0}</Text>
                    <Text style={styles.cardLabel}>Reviews</Text>
                  </View>
                  <View style={[styles.card, { backgroundColor: '#22c55e' }]}>
                    <Text style={styles.cardValue}>{dashboard.totals?.toilets ?? 0}</Text>
                    <Text style={styles.cardLabel}>Toilets</Text>
                  </View>
                  <View style={[styles.card, { backgroundColor: '#8b5cf6' }]}>
                    <Text style={styles.cardValue}>{dashboard.totals?.uniqueDevices ?? 0}</Text>
                    <Text style={styles.cardLabel}>Active devices</Text>
                  </View>
                  <View style={[styles.card, { backgroundColor: '#f59e0b' }]}>
                    <Text style={styles.cardValue}>{dashboard.totals?.users ?? 0}</Text>
                    <Text style={styles.cardLabel}>Accounts</Text>
                  </View>
                  <View style={[styles.card, { backgroundColor: '#ec4899' }]}>
                    <Text style={styles.cardValue}>{dashboard.totals?.favorites ?? 0}</Text>
                    <Text style={styles.cardLabel}>Saves</Text>
                  </View>
                  <View style={[styles.card, { backgroundColor: '#06b6d4' }]}>
                    <Text style={styles.cardValue}>{dashboard.totals?.totalEvents ?? 0}</Text>
                    <Text style={styles.cardLabel}>Events</Text>
                  </View>
                </View>

                <View style={styles.metricsExplain}>
                  <Text style={styles.metricsExplainTitle}>How we count users</Text>
                  <Text style={styles.metricsExplainText}>
                    • <Text style={styles.metricsExplainBold}>Active devices</Text> = unique app instances that sent events (no sign-in required). Best proxy for "real users."
                  </Text>
                  <Text style={styles.metricsExplainText}>
                    • <Text style={styles.metricsExplainBold}>Accounts</Text> = users who signed in with Google/Apple.
                  </Text>
                  <Text style={styles.metricsExplainText}>
                    • <Text style={styles.metricsExplainBold}>Events</Text> = total analytics events (toilet_selected, reviews, etc.). Measures engagement.
                  </Text>
                  <Text style={styles.metricsExplainText}>
                    • Downloads = not tracked (use App Store Connect / Play Console for store data).
                  </Text>
                </View>

                <Text style={styles.sectionTitle}>In selected range</Text>
                <View style={styles.rangeRow}>
                  <Text style={styles.rangeText}>Reviews: {dashboard.inRange?.reviews ?? 0}</Text>
                  <Text style={styles.rangeText}>Toilets: {dashboard.inRange?.toilets ?? 0}</Text>
                  <Text style={styles.rangeText}>Devices: {dashboard.inRange?.uniqueDevices ?? 0}</Text>
                  <Text style={styles.rangeText}>Accounts: {dashboard.inRange?.users ?? 0}</Text>
                  <Text style={styles.rangeText}>Events: {dashboard.inRange?.totalEvents ?? 0}</Text>
                </View>

                {dashboard.series?.reviews?.length > 0 && (
                  <BarChart
                    data={dashboard.series.reviews}
                    labelKey="period"
                    valueKey="count"
                    color="#6366f1"
                    formatLabel={(p) => formatPeriod(p, groupBy)}
                    title="Reviews over time (tap bar for details)"
                    groupBy={groupBy}
                  />
                )}

                {dashboard.series?.devices?.length > 0 && (
                  <BarChart
                    data={dashboard.series.devices}
                    labelKey="period"
                    valueKey="count"
                    color="#8b5cf6"
                    formatLabel={(p) => formatPeriod(p, 'day')}
                    title="Active devices per day (tap bar for details)"
                    groupBy="day"
                  />
                )}

                {dashboard.series?.reviews?.length > 0 && dashboard.series?.devices?.length > 0 && (
                  <View style={styles.comboChartSection}>
                    <Text style={styles.chartTitle}>Trend comparison (reviews vs devices)</Text>
                    <View style={styles.comboChartRow}>
                      <View style={styles.comboChartCol}>
                        <Text style={styles.comboChartLabel}>Reviews</Text>
                        <MiniLineChart data={dashboard.series.reviews} color="#6366f1" labelKey="period" valueKey="count" />
                      </View>
                      <View style={styles.comboChartCol}>
                        <Text style={styles.comboChartLabel}>Devices</Text>
                        <MiniLineChart data={dashboard.series.devices} color="#8b5cf6" labelKey="period" valueKey="count" />
                      </View>
                    </View>
                  </View>
                )}

                {showEventsChart && dashboard.eventsByType?.length > 0 && (
                  <>
                    <View style={styles.sectionRow}>
                      <Text style={styles.sectionTitle}>Events (toggle)</Text>
                      <Switch value={showEventsChart} onValueChange={setShowEventsChart} />
                    </View>
                    <BarChart
                      data={dashboard.eventsByType}
                      labelKey="event"
                      valueKey="count"
                      color="#8b5cf6"
                      formatLabel={(e) => { const s = String(e ?? ''); return s.length > 20 ? s.slice(0, 18) + '…' : s; }}
                    />
                  </>
                )}
                {!showEventsChart && (
                  <View style={styles.sectionRow}>
                    <Text style={styles.sectionTitle}>Events (toggle)</Text>
                    <Switch value={showEventsChart} onValueChange={setShowEventsChart} />
                  </View>
                )}

                {showTopToilets && dashboard.topToilets?.length > 0 && (
                  <>
                    <View style={styles.sectionRow}>
                      <Text style={styles.sectionTitle}>Top toilets by reviews</Text>
                      <Switch value={showTopToilets} onValueChange={setShowTopToilets} />
                    </View>
                    <View style={styles.topList}>
                      {dashboard.topToilets.slice(0, 8).map((t: any, i: number) => (
                        <View key={t.id} style={styles.topItem}>
                          <Text style={styles.topRank}>#{i + 1}</Text>
                          <View style={styles.topInfo}>
                            <Text style={styles.topName} numberOfLines={1}>{t.name}</Text>
                            <Text style={styles.topMeta}>{t.total_reviews} reviews · Clean {(Number(t?.cleanliness_score) || 0).toFixed(1)}/5</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  </>
                )}
                {!showTopToilets && (
                  <View style={styles.sectionRow}>
                    <Text style={styles.sectionTitle}>Top toilets (toggle)</Text>
                    <Switch value={showTopToilets} onValueChange={setShowTopToilets} />
                  </View>
                )}
              </>
            ) : (
              <Text style={styles.empty}>No dashboard data</Text>
            )}
          </>
        )}

        {tab === 'moderation' && (
          <>
            <Text style={styles.sectionTitle}>Recent reviews ({reviewsTotal})</Text>
            {reviews.length === 0 && !refreshing ? (
              <Text style={styles.empty}>No reviews to moderate</Text>
            ) : (
              <>
              {reviews.map((r) => {
                const isExpanded = expandedReviewId === r.id;
                return (
                  <View key={r.id} style={styles.reviewCard}>
                    <Pressable
                      onPress={() => setExpandedReviewId(isExpanded ? null : r.id)}
                      style={styles.reviewHeader}
                    >
                      <View style={styles.reviewHeaderContent}>
                        <Text style={styles.reviewToilet} numberOfLines={1}>{r.toilet_name}</Text>
                        <Text style={styles.reviewMeta}>
                          {r.cleanliness_score ?? '–'}/5 clean · {r.smell_score ?? '–'}/5 smell
                        </Text>
                      </View>
                      <Text style={styles.expandIcon}>{isExpanded ? '▼' : '▶'}</Text>
                    </Pressable>
                    {isExpanded && (
                      <View style={styles.reviewDetails}>
                        <Text style={styles.reviewDetailSection}>Review details</Text>
                        {r.toilet_address ? (
                          <Text style={styles.reviewDetailRow}>📍 {r.toilet_address}</Text>
                        ) : null}
                        {r.review_text ? (
                          <Text style={styles.reviewBodyFull}>"{r.review_text}"</Text>
                        ) : (
                          <Text style={styles.reviewDetailMuted}>No comment</Text>
                        )}
                        <Text style={styles.reviewDetailRow}>
                          By: {r.reviewed_by || r.user_display_name || r.user_email || 'Anonymous'}
                        </Text>
                        {r.user_email && (
                          <Text style={styles.reviewDetailRow}>Email: {r.user_email}</Text>
                        )}
                        <Text style={styles.reviewDetailRow}>
                          Toilet: {r.toilet_name} {r.toilet_total_reviews != null ? `(${r.toilet_total_reviews} reviews)` : ''}
                        </Text>
                        <Text style={styles.reviewDetailMuted}>ID: {r.id}</Text>
                        {r.toilet_id && (r.latitude != null && r.longitude != null) ? (
                          <TouchableOpacity
                            style={styles.mapLinkBtn}
                            onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${r.latitude},${r.longitude}`)}
                          >
                            <Text style={styles.mapLinkBtnText}>Open in Maps</Text>
                          </TouchableOpacity>
                        ) : null}
                        <Text style={styles.reviewDate}>{new Date(r.reviewed_at).toLocaleString()}</Text>
                      </View>
                    )}
                    {!isExpanded && (r.review_text || r.reviewed_by) && (
                      <Text style={styles.reviewBody} numberOfLines={2}>
                        {r.review_text || `By ${r.reviewed_by || r.user_display_name || r.user_email || 'Anonymous'}`}
                      </Text>
                    )}
                    {!isExpanded && <Text style={styles.reviewDate}>{new Date(r.reviewed_at).toLocaleString()}</Text>}
                    <View style={styles.reviewActions}>
                      <TouchableOpacity
                        style={styles.editBtn}
                        onPress={() => handleEditReview(r)}
                      >
                        <Text style={styles.editBtnText}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.deleteBtn}
                        onPress={() => handleDeleteReview(r.id, r.toilet_name)}
                      >
                        <Text style={styles.deleteBtnText}>Remove</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
              {reviews.length < reviewsTotal && reviewsTotal > 0 && (
                <TouchableOpacity
                  style={styles.loadMoreBtn}
                  onPress={() => loadReviews(true)}
                >
                  <Text style={styles.loadMoreBtnText}>Load more ({reviewsTotal - reviews.length} remaining)</Text>
                </TouchableOpacity>
              )}
              </>
            )}
          </>
        )}

        {tab === 'users' && (
          <>
            <View style={styles.usersSearchRow}>
              <TextInput
                style={styles.usersSearchInput}
                placeholder="Search by email or name…"
                placeholderTextColor="#94a3b8"
                value={usersSearchInput}
                onChangeText={setUsersSearchInput}
                onSubmitEditing={() => { setUsersOffset(0); setUsersSearch(usersSearchInput.trim()); }}
                returnKeyType="search"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={styles.usersSearchBtn}
                onPress={() => { setUsersOffset(0); setUsersSearch(usersSearchInput.trim()); }}
              >
                <Text style={styles.usersSearchBtnText}>Search</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.usersHeaderRow}>
              <Text style={styles.usersCount}>{usersTotal} user{usersTotal !== 1 ? 's' : ''}</Text>
              <TouchableOpacity
                style={[styles.csvBtn, exportingCsv && { opacity: 0.6 }]}
                onPress={handleExportCsv}
                disabled={exportingCsv}
              >
                {exportingCsv ? (
                  <ActivityIndicator size="small" color="#6366f1" />
                ) : (
                  <Text style={styles.csvBtnText}>Export CSV</Text>
                )}
              </TouchableOpacity>
            </View>
            {usersList.length === 0 && !loading ? (
              <Text style={styles.empty}>No users found</Text>
            ) : (
              usersList.map((u: any) => (
                <View key={u.id} style={styles.userCard}>
                  <View style={styles.userCardTop}>
                    <View style={styles.userInfo}>
                      <Text style={styles.userName} numberOfLines={1}>
                        {u.display_name || '(no name)'}
                      </Text>
                      <Text style={styles.userEmail} numberOfLines={1}>{u.email}</Text>
                    </View>
                    <View style={styles.userBadges}>
                      <View style={[styles.providerBadge, u.provider === 'google' && styles.providerGoogle, u.provider === 'apple' && styles.providerApple]}>
                        <Text style={styles.providerBadgeText}>
                          {u.provider === 'google' ? 'Google' : u.provider === 'apple' ? 'Apple' : 'Email'}
                        </Text>
                      </View>
                      {u.role === 'admin' && (
                        <View style={styles.adminBadge}>
                          <Text style={styles.adminBadgeText}>Admin</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <View style={styles.userCardBottom}>
                    <Text style={styles.userMeta}>
                      {u.review_count} review{u.review_count !== 1 ? 's' : ''}
                    </Text>
                    <Text style={styles.userMeta}>
                      Joined {new Date(u.created_at).toLocaleDateString()}
                    </Text>
                  </View>
                </View>
              ))
            )}
            {usersList.length < usersTotal && (
              <TouchableOpacity style={styles.loadMoreBtn} onPress={() => loadUsers(true)}>
                <Text style={styles.loadMoreBtnText}>Load more ({usersTotal - usersList.length} remaining)</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {tab === 'diagnostics' && (
          <>
            <Text style={styles.sectionTitle}>Load diagnostics (last 7 days)</Text>
            <Text style={styles.hintText}>Android vs iOS timing: perm=permission, loc=location, api=backend.</Text>
            {diagnostics?.summary?.length > 0 ? (
              <View style={styles.diagSummary}>
                {diagnostics.summary.map((s: any, i: number) => (
                  <View key={i} style={styles.diagCard}>
                    <Text style={styles.diagPlatform}>{s.platform}</Text>
                    <Text style={styles.diagStat}>{`n=${s.count ?? 0}`}</Text>
                    <Text style={styles.diagStat}>perm avg: {s.avg_perm_ms ?? '–'}ms</Text>
                    <Text style={styles.diagStat}>loc avg: {s.avg_loc_ms ?? '–'}ms</Text>
                    <Text style={styles.diagStat}>api avg: {s.avg_api_ms ?? '–'}ms</Text>
                    <Text style={[styles.diagStat, styles.diagTotal]}>total avg: {s.avg_total_ms ?? '–'}ms</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.empty}>No load diagnostics yet. Open the app on devices to collect data.</Text>
            )}
            <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Recent load events</Text>
            {diagnostics?.recent?.length > 0 ? (
              <View style={styles.diagRecent}>
                {diagnostics.recent.slice(0, 20).map((r: any) => (
                  <View key={r.id} style={styles.diagRow}>
                    <Text style={styles.diagRowPlatform}>{r.platform}</Text>
                    <Text style={styles.diagRowValues}>
                      {`total=${r.total_ms ?? '–'}ms · loc=${r.location_source ?? '–'} · api=${r.api_ms ?? '–'}ms`}
                    </Text>
                    <Text style={styles.diagRowDate}>{new Date(r.created_at).toLocaleString()}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.empty}>No recent events</Text>
            )}

            <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Crash reports</Text>
            {crashReports.length > 0 ? (
              <View style={styles.crashList}>
                {crashReports.map((c: any) => (
                  <View key={c.id} style={styles.crashCard}>
                    <Text style={styles.crashMessage} numberOfLines={2}>{c.error_message}</Text>
                    <Text style={styles.crashMeta}>{c.platform ?? '?'} · v{c.app_version ?? '?'}</Text>
                    <Text style={styles.crashDate}>{new Date(c.created_at).toLocaleString()}</Text>
                    {c.error_stack ? (
                      <Text style={styles.crashStack} numberOfLines={4}>{c.error_stack}</Text>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.empty}>No crash reports</Text>
            )}
          </>
        )}

        {tab === 'hunt' && (
          <>
            {huntLoading && !huntData ? (
              <ActivityIndicator style={{ marginTop: 40 }} color="#6366f1" />
            ) : (
              <>
                {/* ── Status banner ── */}
                <View style={styles.huntBanner}>
                  {huntData?.hunt ? (
                    <>
                      <View style={styles.huntBannerRow}>
                        <View style={[
                          styles.huntStatusBadge,
                          huntData.hunt.active ? styles.huntBadgeActive
                            : huntData.hunt.isPaused ? styles.huntBadgePaused
                            : styles.huntBadgeInactive,
                        ]}>
                          <Text style={styles.huntStatusBadgeText}>
                            {huntData.hunt.active ? 'ACTIVE' : huntData.hunt.isPaused ? 'PAUSED' : 'ENDED'}
                          </Text>
                        </View>
                        <Text style={styles.huntBannerMonth}>{huntData.hunt.monthKey}</Text>
                        {huntLoading && <ActivityIndicator size="small" color="#6366f1" style={{ marginLeft: 8 }} />}
                      </View>
                      <Text style={styles.huntBannerDates}>
                        {new Date(huntData.hunt.startsAt).toLocaleDateString()} – {new Date(huntData.hunt.endsAt).toLocaleDateString()}
                      </Text>
                      <Text style={styles.huntBannerProgress}>
                        {huntData.totalFound}/{huntData.totalToilets} toilets found across {huntData.cities?.length ?? 0} cities
                      </Text>
                    </>
                  ) : (
                    <Text style={styles.huntBannerDates}>
                      No hunt yet.{huntData?.nextHuntAt ? ` Next: ${new Date(huntData.nextHuntAt).toLocaleDateString()}` : ''}
                    </Text>
                  )}
                </View>

                {/* ── Controls ── */}
                <View style={styles.huntControls}>
                  {huntData?.hunt?.active && (
                    <TouchableOpacity
                      style={[styles.huntBtn, styles.huntBtnWarn]}
                      disabled={!!huntActionBusy}
                      onPress={() => confirmAsync('Pause Hunt', 'Pause the hunt? Users cannot check in while paused.').then(ok => { if (ok) huntAction('pause', () => api.hunt.admin.pause(huntData.hunt.id)); })}
                    >
                      <Text style={styles.huntBtnText}>{huntActionBusy === 'pause' ? '…' : 'Pause'}</Text>
                    </TouchableOpacity>
                  )}
                  {huntData?.hunt?.isPaused && (
                    <TouchableOpacity
                      style={[styles.huntBtn, styles.huntBtnGreen]}
                      disabled={!!huntActionBusy}
                      onPress={() => huntAction('resume', () => api.hunt.admin.resume(huntData.hunt.id))}
                    >
                      <Text style={styles.huntBtnText}>{huntActionBusy === 'resume' ? '…' : 'Resume'}</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[styles.huntBtn, styles.huntBtnPrimary]}
                    disabled={!!huntActionBusy}
                    onPress={() => confirmAsync('Send Notification', 'Send the 1-week hunt notification to all users now?').then(ok => { if (ok) huntAction('notify', () => api.hunt.admin.notify()); })}
                  >
                    <Text style={styles.huntBtnText}>{huntActionBusy === 'notify' ? '…' : 'Notify Users'}</Text>
                  </TouchableOpacity>
                  {huntData?.hunt && (
                    <TouchableOpacity
                      style={[styles.huntBtn, { backgroundColor: '#0ea5e9', alignSelf: 'stretch' }]}
                      disabled={!!huntActionBusy}
                      onPress={() => huntAction('syncCities', () => api.hunt.admin.syncCities()).then(() => loadHuntDashboard())}
                    >
                      <Text style={styles.huntBtnText}>{huntActionBusy === 'syncCities' ? '…' : 'Sync Missing Cities'}</Text>
                    </TouchableOpacity>
                  )}
                  {!huntData?.hunt?.active && !huntData?.hunt?.isPaused && (
                    <View style={styles.huntStartRow}>
                      <TextInput
                        style={styles.huntDurationInput}
                        value={huntDuration}
                        onChangeText={setHuntDuration}
                        keyboardType="numeric"
                        placeholder="Days"
                        maxLength={2}
                      />
                      <TouchableOpacity
                        style={[styles.huntBtn, styles.huntBtnGold]}
                        disabled={!!huntActionBusy}
                        onPress={() => confirmAsync('Start Hunt Now', `Start a ${parseInt(huntDuration, 10) || 21}-day hunt immediately?`).then(ok => { if (ok) huntAction('start', () => api.hunt.admin.start(parseInt(huntDuration, 10) || 21)); })}
                      >
                        <Text style={styles.huntBtnText}>{huntActionBusy === 'start' ? '…' : 'Start Hunt Now'}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>

                {/* ── City progress ── */}
                {(huntData?.cities?.length ?? 0) > 0 && (
                  <>
                    <Text style={styles.sectionTitle}>City Progress</Text>
                    <Text style={styles.hintText}>Tap a city to view golden toilets and re-roll.</Text>
                    <View style={styles.huntCityGrid}>
                      {huntData.cities.map((c: any) => (
                        <TouchableOpacity
                          key={c.city}
                          style={styles.huntCityCard}
                          onPress={() => setSelectedCity(c)}
                        >
                          <Text style={styles.huntCityName}>{c.city}</Text>
                          {(c.isPaused || c.isEnded) && (
                            <Text style={{ fontSize: 10, fontWeight: '700', color: c.isEnded ? '#ef4444' : '#f59e0b', marginBottom: 2 }}>
                              {c.isEnded ? 'ENDED' : 'PAUSED'}
                            </Text>
                          )}
                          <Text style={styles.huntCityCount}>
                            {c.found}/{c.total} found
                          </Text>
                          <View style={styles.huntProgressBar}>
                            <View style={[styles.huntProgressFill, { width: `${(c.found / Math.max(c.total, 1)) * 100}%` as any }]} />
                          </View>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}

                {/* ── Check-ins ── */}
                <View style={styles.huntCheckinHeader}>
                  <Text style={styles.sectionTitle}>Check-ins ({huntCheckinsTotal})</Text>
                  <TouchableOpacity
                    style={[styles.huntBtn, styles.huntBtnPrimary, { marginBottom: 0 }]}
                    disabled={exportingHunt}
                    onPress={exportHuntCsv}
                  >
                    <Text style={styles.huntBtnText}>{exportingHunt ? 'Exporting…' : 'Export CSV'}</Text>
                  </TouchableOpacity>
                </View>

                {huntCheckins.length === 0 ? (
                  <Text style={styles.empty}>No check-ins yet.</Text>
                ) : (
                  <View style={styles.huntCheckinList}>
                    {huntCheckins.map((ci: any) => (
                      <View key={ci.id} style={styles.huntCheckinRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.huntCheckinName}>{ci.user_name || '(anonymous)'}</Text>
                          <Text style={styles.huntCheckinEmail}>{ci.user_email || ci.device_id?.slice(0, 12) + '…'}</Text>
                          <Text style={styles.huntCheckinMeta}>{ci.city} · {ci.toilet_name}</Text>
                          <Text style={styles.huntCheckinDate}>{new Date(ci.checked_in_at).toLocaleString()}</Text>
                        </View>
                        <TouchableOpacity
                          style={[styles.huntVoucherBtn, ci.voucher_sent && styles.huntVoucherBtnSent]}
                          onPress={async () => {
                            try {
                              await api.hunt.admin.markVoucher(ci.id, !ci.voucher_sent);
                              setHuntCheckins(prev => prev.map(x => x.id === ci.id ? { ...x, voucher_sent: !ci.voucher_sent } : x));
                            } catch (e: any) {
                              Alert.alert('Error', getErrorMessage(e));
                            }
                          }}
                        >
                          <Text style={styles.huntVoucherBtnText}>{ci.voucher_sent ? '✓ Sent' : 'Voucher'}</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}
          </>
        )}
      </ScrollView>

      {/* ── City detail modal ── */}
      <Modal visible={!!selectedCity} transparent animationType="slide" onRequestClose={() => setSelectedCity(null)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSelectedCity(null)} />
          <View style={[styles.modalContent, { maxHeight: '80%' }]} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>{selectedCity?.city}</Text>
            <Text style={styles.huntCityCount}>{selectedCity?.found}/{selectedCity?.total} found</Text>
            <ScrollView style={{ marginTop: 12, marginBottom: 12 }}>
              {selectedCity?.toilets?.map((t: any) => (
                <TouchableOpacity
                  key={t.goldenToiletId}
                  style={styles.huntToiletRow}
                  onPress={() => {
                    setSelectedCity(null);
                    (navigation as any).navigate('ToiletDetails', { toiletId: t.toiletId });
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.huntToiletName, { textDecorationLine: 'underline' }]}>{t.name}</Text>
                    <Text style={styles.huntToiletStatus}>
                      {t.isFound ? `✓ Found ${t.foundAt ? new Date(t.foundAt).toLocaleDateString() : ''}` : '○ Not yet found'} · {t.checkinCount} check-in{t.checkinCount !== 1 ? 's' : ''}
                    </Text>
                  </View>
                  <Text style={{ color: '#94a3b8', fontSize: 16 }}>›</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {huntData?.hunt?.id && (
              <View style={[styles.huntControls, { marginBottom: 4 }]}>
                {!selectedCity?.isEnded && (
                  selectedCity?.isPaused ? (
                    <TouchableOpacity
                      style={[styles.huntBtn, styles.huntBtnGreen]}
                      disabled={!!huntActionBusy}
                      onPress={() => huntAction('resumeCity', () => api.hunt.admin.resumeCity(huntData.hunt.id, selectedCity.city)).then(() => setSelectedCity(null))}
                    >
                      <Text style={styles.huntBtnText}>{huntActionBusy === 'resumeCity' ? '…' : `Resume ${selectedCity?.city}`}</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[styles.huntBtn, styles.huntBtnWarn]}
                      disabled={!!huntActionBusy}
                      onPress={() => confirmAsync('Pause City', `Pause the hunt in ${selectedCity?.city}? Users cannot check in here while paused.`).then(ok => { if (ok) huntAction('pauseCity', () => api.hunt.admin.pauseCity(huntData.hunt.id, selectedCity.city)).then(() => setSelectedCity(null)); })}
                    >
                      <Text style={styles.huntBtnText}>{huntActionBusy === 'pauseCity' ? '…' : `Pause ${selectedCity?.city}`}</Text>
                    </TouchableOpacity>
                  )
                )}
                {!selectedCity?.isEnded && (
                  <TouchableOpacity
                    style={[styles.huntBtn, { backgroundColor: '#ef4444' }]}
                    disabled={!!huntActionBusy}
                    onPress={() => confirmAsync('End City Hunt', `End the hunt permanently in ${selectedCity?.city}? This cannot be undone.`).then(ok => { if (ok) huntAction('endCity', () => api.hunt.admin.endCity(huntData.hunt.id, selectedCity.city)).then(() => setSelectedCity(null)); })}
                  >
                    <Text style={styles.huntBtnText}>{huntActionBusy === 'endCity' ? '…' : `End ${selectedCity?.city}`}</Text>
                  </TouchableOpacity>
                )}
                {selectedCity?.isEnded && (
                  <Text style={{ color: '#ef4444', fontWeight: '700', fontSize: 13, paddingVertical: 9 }}>Hunt ended in this city</Text>
                )}
                <TouchableOpacity
                  style={[styles.huntBtn, styles.huntBtnWarn]}
                  disabled={!!huntActionBusy}
                  onPress={() => {
                    confirmAsync('Re-roll City', `Replace the 3 golden toilets in ${selectedCity?.city}? Existing check-ins are kept.`)
                      .then(ok => {
                        if (!ok) return;
                        huntAction('reroll', () => api.hunt.admin.reroll(huntData.hunt.id, selectedCity.city))
                          .then(() => setSelectedCity(null));
                      });
                  }}
                >
                  <Text style={styles.huntBtnText}>{huntActionBusy === 'reroll' ? '…' : `Re-roll ${selectedCity?.city}`}</Text>
                </TouchableOpacity>
              </View>
            )}
            <TouchableOpacity style={[styles.huntBtn, { backgroundColor: '#eee' }]} onPress={() => setSelectedCity(null)}>
              <Text style={[styles.huntBtnText, { color: '#333' }]}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={!!editingReview} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !savingEdit && setEditingReview(null)} />
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
          <Text style={styles.modalTitle}>Edit review</Text>
          {editingReview && (
            <>
              <Text style={styles.editLabel}>Toilet name</Text>
              <TextInput
                style={styles.editInput}
                value={editToiletName}
                onChangeText={setEditToiletName}
                placeholder="e.g. Tiong Bahru Market"
              />
              <Text style={styles.editLabel}>Cleanliness (1–5)</Text>
              <TextInput
                style={styles.editInput}
                value={editCleanliness}
                onChangeText={setEditCleanliness}
                placeholder="e.g. 4"
                keyboardType="number-pad"
              />
              <Text style={styles.editLabel}>Smell (1–5)</Text>
              <TextInput
                style={styles.editInput}
                value={editSmell}
                onChangeText={setEditSmell}
                placeholder="e.g. 3"
                keyboardType="number-pad"
              />
              <Text style={styles.editLabel}>Comment</Text>
              <TextInput
                style={[styles.editInput, styles.editInputMultiline]}
                value={editReviewText}
                onChangeText={setEditReviewText}
                placeholder="Optional review text"
                multiline
              />
              <Text style={styles.editLabel}>Reviewed by</Text>
              <TextInput
                style={styles.editInput}
                value={editReviewedBy}
                onChangeText={setEditReviewedBy}
                placeholder="Display name"
              />
            </>
          )}
          <View style={styles.modalActions}>
            <TouchableOpacity
              style={styles.modalCancelBtn}
              onPress={() => !savingEdit && setEditingReview(null)}
              disabled={savingEdit}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalSaveBtn, savingEdit && styles.modalSaveBtnDisabled]}
              onPress={handleSaveEdit}
              disabled={savingEdit}
            >
              {savingEdit ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.modalSaveText}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  unauthorized: { fontSize: 18, color: '#64748b', marginBottom: 8 },
  unauthorizedSub: { fontSize: 14, color: '#94a3b8', marginBottom: 24 },
  signInBtn: {
    paddingVertical: 14,
    paddingHorizontal: 32,
    backgroundColor: '#6366f1',
    borderRadius: 10,
    marginBottom: 12,
  },
  signInBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  headerBack: { marginRight: 12 },
  headerBackText: { fontSize: 16, color: '#6366f1', fontWeight: '600' },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  tabs: { backgroundColor: '#fff', paddingBottom: 8, maxHeight: 52 },
  tabsContent: { paddingHorizontal: 16, flexDirection: 'row' },
  tab: { paddingVertical: 10, paddingHorizontal: 20, marginRight: 8, borderRadius: 8 },
  tabActive: { backgroundColor: '#6366f1' },
  tabText: { fontSize: 15, color: '#64748b', fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  loader: { marginVertical: 40 },
  filters: { marginBottom: 20 },
  filterLabel: { fontSize: 12, fontWeight: '700', color: '#64748b', marginBottom: 8 },
  filterChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#e2e8f0' },
  chipActive: { backgroundColor: '#6366f1' },
  chipText: { fontSize: 14, color: '#475569', fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  card: { width: (SCREEN_WIDTH - 16 * 2 - 10) / 2, padding: 16, borderRadius: 12 },
  cardValue: { fontSize: 28, fontWeight: '800', color: '#fff' },
  cardLabel: { fontSize: 12, color: 'rgba(255,255,255,0.9)', marginTop: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a', marginBottom: 12 },
  metricHint: { fontSize: 11, color: '#94a3b8', marginBottom: 8, fontStyle: 'italic' },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  rangeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginBottom: 20 },
  rangeText: { fontSize: 14, color: '#475569' },
  chartContainer: { marginBottom: 24 },
  chartTitle: { fontSize: 12, color: '#94a3b8', marginBottom: 8 },
  chartTooltip: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 12,
    alignSelf: 'flex-start',
  },
  chartTooltipLabel: { fontSize: 12, color: '#94a3b8' },
  chartTooltipValue: { fontSize: 18, fontWeight: '800', color: '#fff', marginTop: 2 },
  metricsExplain: {
    backgroundColor: '#f1f5f9',
    padding: 14,
    borderRadius: 10,
    marginBottom: 20,
    borderLeftWidth: 4,
    borderLeftColor: '#6366f1',
  },
  metricsExplainTitle: { fontSize: 13, fontWeight: '700', color: '#334155', marginBottom: 8 },
  metricsExplainText: { fontSize: 12, color: '#64748b', marginBottom: 6, lineHeight: 18 },
  metricsExplainBold: { fontWeight: '700', color: '#475569' },
  miniLineChart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 70,
    gap: 2,
  },
  miniLineBar: { borderRadius: 2 },
  comboChartSection: { marginBottom: 24 },
  comboChartRow: { flexDirection: 'row', gap: 16 },
  comboChartCol: { flex: 1 },
  comboChartLabel: { fontSize: 11, color: '#94a3b8', marginBottom: 6 },
  barRow: { flexDirection: 'row', alignItems: 'center', marginBottom: BAR_GAP, paddingVertical: 2 },
  barRowTouched: { backgroundColor: 'rgba(99,102,241,0.1)', borderRadius: 4 },
  barValueTouched: { fontWeight: '800', color: '#6366f1' },
  barLabel: { width: 56, fontSize: 10, color: '#64748b' },
  barTrack: { flex: 1, height: 20, backgroundColor: '#e2e8f0', borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  barValue: { width: 28, fontSize: 11, color: '#475569', textAlign: 'right' },
  topList: { marginBottom: 24 },
  topItem: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: '#fff', borderRadius: 8, marginBottom: 8 },
  topRank: { fontSize: 14, fontWeight: '800', color: '#6366f1', width: 28 },
  topInfo: { flex: 1 },
  topName: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  topMeta: { fontSize: 12, color: '#64748b', marginTop: 2 },
  reviewCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  reviewHeaderContent: { flex: 1 },
  reviewToilet: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  reviewMeta: { fontSize: 12, color: '#6366f1', marginTop: 2 },
  reviewBody: { fontSize: 13, color: '#475569', marginBottom: 6 },
  reviewBodyFull: { fontSize: 13, color: '#475569', marginBottom: 8 },
  reviewDetails: { backgroundColor: '#f8fafc', padding: 12, borderRadius: 8, marginBottom: 10 },
  reviewDetailSection: { fontSize: 13, fontWeight: '700', color: '#334155', marginBottom: 8 },
  reviewDetailRow: { fontSize: 12, color: '#64748b', marginBottom: 4 },
  reviewDetailMuted: { fontSize: 11, color: '#94a3b8', marginBottom: 4 },
  expandIcon: { fontSize: 12, color: '#94a3b8', marginLeft: 8 },
  mapLinkBtn: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#e0e7ff', borderRadius: 6, marginTop: 6 },
  mapLinkBtnText: { fontSize: 12, color: '#6366f1', fontWeight: '600' },
  reviewDate: { fontSize: 11, color: '#94a3b8', marginBottom: 10 },
  reviewActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  editBtn: { paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#e0e7ff', borderRadius: 6 },
  editBtnText: { fontSize: 13, color: '#6366f1', fontWeight: '600' },
  deleteBtn: { paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#fef2f2', borderRadius: 6 },
  deleteBtnText: { fontSize: 13, color: '#dc2626', fontWeight: '600' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalContent: { backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 400 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginBottom: 4 },
  modalSubtitle: { fontSize: 14, color: '#64748b', marginBottom: 16 },
  editLabel: { fontSize: 12, fontWeight: '600', color: '#475569', marginBottom: 4, marginTop: 8 },
  editInput: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 12, fontSize: 16 },
  editInputMultiline: { minHeight: 60, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 20, justifyContent: 'flex-end' },
  modalCancelBtn: { paddingVertical: 12, paddingHorizontal: 20 },
  modalCancelText: { fontSize: 16, color: '#64748b', fontWeight: '600' },
  modalSaveBtn: { paddingVertical: 12, paddingHorizontal: 24, backgroundColor: '#6366f1', borderRadius: 8 },
  modalSaveBtnDisabled: { opacity: 0.7 },
  modalSaveText: { fontSize: 16, color: '#fff', fontWeight: '600' },
  empty: { fontSize: 14, color: '#94a3b8', textAlign: 'center', marginVertical: 24 },
  hintText: { fontSize: 12, color: '#94a3b8', marginBottom: 12 },
  diagSummary: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 20 },
  diagCard: {
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    minWidth: 140,
  },
  diagPlatform: { fontSize: 14, fontWeight: '700', color: '#6366f1', marginBottom: 6 },
  diagStat: { fontSize: 12, color: '#64748b', marginBottom: 2 },
  diagTotal: { fontWeight: '600', color: '#334155', marginTop: 4 },
  diagRecent: { marginBottom: 20 },
  diagRow: {
    backgroundColor: '#fff',
    padding: 10,
    borderRadius: 8,
    marginBottom: 6,
    borderLeftWidth: 4,
    borderLeftColor: '#e2e8f0',
  },
  diagRowPlatform: { fontSize: 12, fontWeight: '600', color: '#6366f1' },
  diagRowValues: { fontSize: 11, color: '#64748b', marginTop: 2 },
  diagRowDate: { fontSize: 10, color: '#94a3b8', marginTop: 4 },
  crashList: { marginBottom: 24 },
  crashCard: {
    backgroundColor: '#fef2f2',
    padding: 12,
    borderRadius: 8,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderLeftColor: '#dc2626',
  },
  crashMessage: { fontSize: 13, fontWeight: '600', color: '#991b1b' },
  crashMeta: { fontSize: 11, color: '#b91c1c', marginTop: 4 },
  crashDate: { fontSize: 10, color: '#94a3b8', marginTop: 2 },
  crashStack: { fontSize: 10, fontFamily: 'monospace', color: '#64748b', marginTop: 8 },
  loadMoreBtn: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    backgroundColor: '#e2e8f0',
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  loadMoreBtnText: { fontSize: 14, color: '#475569', fontWeight: '600' },
  backBtn: { paddingVertical: 12, paddingHorizontal: 24, backgroundColor: '#6366f1', borderRadius: 8 },
  backBtnText: { color: '#fff', fontWeight: '600' },
  unlockContainer: { flex: 1, padding: 24, paddingTop: 56 },
  unlockTitle: { fontSize: 22, fontWeight: '700', color: '#0f172a', marginBottom: 8 },
  unlockSubtitle: { fontSize: 14, color: '#64748b', marginBottom: 16 },
  pinInput: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    padding: 14,
    fontSize: 18,
    marginBottom: 12,
    minWidth: 120,
  },
  pinError: { fontSize: 14, color: '#dc2626', marginBottom: 12 },
  unlockButton: { backgroundColor: '#6366f1', paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  unlockButtonSecondary: { backgroundColor: '#64748b', marginTop: 4 },
  unlockButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  usersSearchRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  usersSearchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    backgroundColor: '#fff',
    color: '#0f172a',
  },
  usersSearchBtn: { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#6366f1', borderRadius: 8, justifyContent: 'center' },
  usersSearchBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  usersHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  usersCount: { fontSize: 14, color: '#64748b', fontWeight: '600' },
  csvBtn: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#e0e7ff', borderRadius: 8 },
  csvBtnText: { fontSize: 13, color: '#6366f1', fontWeight: '700' },
  userCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  userCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  userInfo: { flex: 1, marginRight: 8 },
  userName: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  userEmail: { fontSize: 13, color: '#6366f1', marginTop: 2 },
  userBadges: { flexDirection: 'row', gap: 6, flexShrink: 0 },
  providerBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: '#e2e8f0' },
  providerGoogle: { backgroundColor: '#fef3c7' },
  providerApple: { backgroundColor: '#e2e8f0' },
  providerBadgeText: { fontSize: 11, fontWeight: '600', color: '#475569' },
  adminBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: '#fef2f2' },
  adminBadgeText: { fontSize: 11, fontWeight: '700', color: '#dc2626' },
  userCardBottom: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  userMeta: { fontSize: 12, color: '#94a3b8' },

  // Hunt tab
  huntBanner: { backgroundColor: '#1a1a2e', borderRadius: 12, padding: 16, marginBottom: 12 },
  huntBannerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  huntStatusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginRight: 10 },
  huntBadgeActive: { backgroundColor: '#22c55e' },
  huntBadgePaused: { backgroundColor: '#f59e0b' },
  huntBadgeInactive: { backgroundColor: '#64748b' },
  huntStatusBadgeText: { fontSize: 11, fontWeight: '800', color: '#fff', letterSpacing: 1 },
  huntBannerMonth: { fontSize: 16, fontWeight: '700', color: '#fff' },
  huntBannerDates: { fontSize: 13, color: '#94a3b8', marginBottom: 2 },
  huntBannerProgress: { fontSize: 14, color: '#e2e8f0', marginTop: 4 },
  huntControls: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  huntBtn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8, marginBottom: 4 },
  huntBtnPrimary: { backgroundColor: '#6366f1' },
  huntBtnWarn: { backgroundColor: '#f59e0b' },
  huntBtnGreen: { backgroundColor: '#22c55e' },
  huntBtnGold: { backgroundColor: '#d97706', flex: 1 },
  huntBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  huntStartRow: { flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%', marginTop: 4 },
  huntDurationInput: { width: 56, borderWidth: 1, borderColor: '#475569', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, color: '#e2e8f0', fontSize: 13, textAlign: 'center', backgroundColor: '#1e293b' },
  huntCityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  huntCityCard: {
    width: (SCREEN_WIDTH - 48 - 10) / 2,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  huntCityName: { fontSize: 13, fontWeight: '700', color: '#1e293b', marginBottom: 2 },
  huntCityCount: { fontSize: 12, color: '#64748b', marginBottom: 6 },
  huntProgressBar: { height: 6, backgroundColor: '#e2e8f0', borderRadius: 3, overflow: 'hidden' },
  huntProgressFill: { height: 6, backgroundColor: '#FFD700', borderRadius: 3 },
  huntCheckinHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  huntCheckinList: { gap: 8, marginBottom: 24 },
  huntCheckinRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  huntCheckinName: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  huntCheckinEmail: { fontSize: 12, color: '#6366f1', marginBottom: 2 },
  huntCheckinMeta: { fontSize: 12, color: '#64748b' },
  huntCheckinDate: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  huntVoucherBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7, backgroundColor: '#e2e8f0', minWidth: 68, alignItems: 'center' },
  huntVoucherBtnSent: { backgroundColor: '#dcfce7' },
  huntVoucherBtnText: { fontSize: 12, fontWeight: '700', color: '#374151' },
  huntToiletRow: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  huntToiletName: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  huntToiletStatus: { fontSize: 12, color: '#64748b', marginTop: 2 },
});
