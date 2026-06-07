/**
 * Shared design-system primitives for rn-source screens.
 * Mirrors the components in the Ploop HTML prototype.
 */
import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing, typography, shadow } from '../theme';

/* ── NavBar ─────────────────────────────────────────────── */
export function NavBar({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.nbar, { paddingTop: insets.top, height: 48 + insets.top }]}>
      <View style={styles.nbarSide}>
        {onBack ? (
          <Pressable onPress={onBack} hitSlop={8} style={styles.backBtn}>
            <Text style={styles.backChevron}>‹</Text>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.nbarTitle} numberOfLines={1}>
        {title}
      </Text>
      <View style={[styles.nbarSide, styles.nbarRight]}>{right}</View>
    </View>
  );
}

/* ── Card ───────────────────────────────────────────────── */
export function Card({
  children,
  style,
  title,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  title?: string;
}) {
  return (
    <View style={[styles.card, style]}>
      {title ? <Text style={styles.cardTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

/* ── SectionLabel ───────────────────────────────────────── */
export function SectionLabel({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[styles.sectionLabel, style]}>{children}</Text>;
}

/* ── Stars ──────────────────────────────────────────────── */
export function Stars({ value, size = 12 }: { value: number | null; size?: number }) {
  const v = value ?? 0;
  return (
    <View style={styles.starsRow}>
      {[0, 1, 2, 3, 4].map((i) => {
        const filled = v >= i + 1;
        const half = !filled && v > i + 0.25;
        return (
          <Text
            key={i}
            style={{
              fontSize: size,
              color: filled || half ? colors.star : colors.label3,
              opacity: half ? 0.5 : 1,
            }}
          >
            ★
          </Text>
        );
      })}
    </View>
  );
}

/* ── Tag / Pill ─────────────────────────────────────────── */
export function Tag({ label, variant = 'accent' }: { label: string; variant?: 'free' | 'accent' }) {
  const isFree = variant === 'free';
  return (
    <View style={[styles.tag, isFree ? styles.tagFree : styles.tagAccent]}>
      <Text style={[styles.tagText, { color: isFree ? colors.tagFreeText : colors.blue }]}>
        {label}
      </Text>
    </View>
  );
}

export function Pill({ label }: { label: string }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

/* ── Chip (filter) ──────────────────────────────────────── */
export function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipOn]}>
      <Text style={[styles.chipText, active && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

/* ── Buttons ────────────────────────────────────────────── */
export function PrimaryButton({
  label,
  onPress,
  disabled,
  style,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.btnPrimary, style, (pressed || disabled) && { opacity: 0.85 }]}
    >
      <Text style={styles.btnPrimaryText}>{label}</Text>
    </Pressable>
  );
}

export function DangerButton({
  label,
  onPress,
  filled,
  style,
}: {
  label: string;
  onPress?: () => void;
  filled?: boolean;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        filled ? styles.btnSendDanger : styles.btnSos,
        style,
        pressed && { opacity: 0.8 },
      ]}
    >
      <Text style={filled ? styles.btnSendDangerText : styles.btnSosText}>{label}</Text>
    </Pressable>
  );
}

/* ── ScrollPage ─────────────────────────────────────────── */
export function ScrollPage({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <ScrollView style={[styles.scroll, style]} showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  nbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  nbarSide: { width: 64, justifyContent: 'center' },
  nbarRight: { alignItems: 'flex-end' },
  nbarTitle: { flex: 1, textAlign: 'center', ...typography.navTitle, color: colors.label },
  backBtn: { flexDirection: 'row', alignItems: 'center' },
  backChevron: { color: colors.blue, fontSize: 28, lineHeight: 30, marginRight: 2, marginTop: -2 },
  backText: { color: colors.blue, fontSize: 17 },

  card: { backgroundColor: colors.bg, padding: spacing.lg, marginTop: spacing.sm },
  cardTitle: { ...typography.cardTitle, color: colors.label, marginBottom: 14 },

  sectionLabel: {
    ...typography.sectionLabel,
    color: colors.label2,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: 7,
  },

  starsRow: { flexDirection: 'row', gap: 1 },

  tag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm },
  tagFree: { backgroundColor: colors.tagFreeBg },
  tagAccent: { backgroundColor: colors.blueLight },
  tagText: { fontSize: 11, fontWeight: '600' },

  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: colors.fill,
    borderRadius: radius.pill,
  },
  pillText: { fontSize: 13, fontWeight: '500', color: colors.label2 },

  chip: {
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.fill,
  },
  chipOn: { backgroundColor: colors.blue },
  chipText: { fontSize: 13, fontWeight: '500', color: colors.label },
  chipTextOn: { color: colors.white },

  btnPrimary: {
    backgroundColor: colors.blue,
    borderRadius: radius.xl,
    padding: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: { color: colors.white, fontSize: 16, fontWeight: '600' },

  btnSos: {
    backgroundColor: colors.redLight,
    borderColor: '#fecaca',
    borderWidth: 1.5,
    borderRadius: radius.xl,
    padding: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSosText: { color: colors.red, fontSize: 16, fontWeight: '700' },

  btnSendDanger: {
    backgroundColor: colors.red,
    borderRadius: radius.xl,
    padding: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSendDangerText: { color: colors.white, fontSize: 16, fontWeight: '700' },

  scroll: { flex: 1 },
});
