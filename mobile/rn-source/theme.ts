/**
 * Ploop design system — ported from the high-fidelity prototype
 * (ploop-app-prototype-2.html). Single source of truth for colors,
 * spacing, radii, and type used by all rn-source screens.
 */

export const colors = {
  blue: '#3b52e8',
  blueDark: '#2a40d4',
  blueLight: '#eef1ff',
  navy: '#0c1445',
  gold: '#d97706',
  goldLight: '#fef9ee',
  green: '#22c55e',
  red: '#ef4444',
  redLight: '#fef2f2',

  // iOS system layer
  bg: '#ffffff',
  bg2: '#f2f2f7',
  label: '#000000',
  label2: 'rgba(60,60,67,0.6)',
  label3: 'rgba(60,60,67,0.3)',
  separator: 'rgba(60,60,67,0.2)',
  fill: 'rgba(120,120,128,0.12)',

  star: '#f59e0b',
  white: '#ffffff',

  // tag colors
  tagFreeBg: '#dcfce7',
  tagFreeText: '#15803d',
};

export const radius = {
  sm: 5,
  md: 8,
  lg: 11,
  xl: 13,
  pill: 9999,
  card: 16,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
};

export const typography = {
  navTitle: { fontSize: 17, fontWeight: '600' as const, letterSpacing: -0.2 },
  largeTitle: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.5 },
  title: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.4 },
  cardTitle: { fontSize: 18, fontWeight: '700' as const, letterSpacing: -0.2 },
  body: { fontSize: 15, fontWeight: '400' as const },
  bodyStrong: { fontSize: 15, fontWeight: '600' as const, letterSpacing: -0.2 },
  meta: { fontSize: 13, fontWeight: '400' as const },
  caption: { fontSize: 12, fontWeight: '500' as const },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700' as const,
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
  },
};

export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.13,
    shadowRadius: 14,
    elevation: 3,
  },
  pin: {
    shadowColor: colors.blue,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 4,
  },
};

export const theme = { colors, radius, spacing, typography, shadow };
export type Theme = typeof theme;
