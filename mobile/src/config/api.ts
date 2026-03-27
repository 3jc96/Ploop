// API configuration
//
// Backend port is configurable via EXPO_PUBLIC_PLOOP_API_URL (e.g. http://192.168.0.2:8082).
// Default port 8082 when not specified. For development, derive the host dynamically from
// the Expo dev server host so it works on iOS Simulator, Android Emulator, and physical devices.
import Constants from 'expo-constants';
import { NativeModules, Platform } from 'react-native';

const DEFAULT_PORT = '8082';

function getPortFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  } catch {
    return DEFAULT_PORT;
  }
}

function isTunnelHost(host: string): boolean {
  return /\.(exp\.direct|ngrok|trycloudflare)\b/i.test(host) || host.includes('ngrok');
}

function getDevBackendBaseUrl(port: string): string {
  // Android emulator: use 10.0.2.2 to reach host (LAN IP often unreachable from emulator NAT)
  if (Platform.OS === 'android' && (process as any).env?.EXPO_PUBLIC_PLOOP_ANDROID_EMULATOR === 'true') {
    return `http://10.0.2.2:${port}`;
  }
  // Prefer Expo dev server host (e.g. "192.168.1.25:8081", "localhost:8081").
  // Do NOT use tunnel host (exp.direct, ngrok) for the API — backend runs on your Mac, not the tunnel.
  const rawHostUri =
    Constants.expoConfig?.hostUri ??
    (Constants as any).debuggerHost ??
    (Constants as any).manifest?.hostUri ??
    (Constants as any).manifest2?.extra?.expoClient?.hostUri;

  const hostFromExpo = typeof rawHostUri === 'string' ? rawHostUri.split('/')[0]?.split(':')[0] : undefined;

  if (hostFromExpo && !isTunnelHost(hostFromExpo)) {
    return `http://${hostFromExpo}:${port}`;
  }

  // Fallback: parse the JS bundle URL (LAN IP; avoid using tunnel URL for backend).
  const scriptUrl = (NativeModules as any)?.SourceCode?.scriptURL as string | undefined;
  if (typeof scriptUrl === 'string' && scriptUrl.startsWith('http')) {
    try {
      const url = new URL(scriptUrl);
      if (url.hostname && !isTunnelHost(url.hostname)) return `http://${url.hostname}:${port}`;
    } catch {
      // ignore
    }
  }

  // Fallbacks if Expo host is not available
  if (Platform.OS === 'android') {
    return `http://10.0.2.2:${port}`;
  }

  return `http://localhost:${port}`;
}

// When using tunnel or on a physical device, set EXPO_PUBLIC_PLOOP_API_URL to your Mac's LAN IP (e.g. http://192.168.1.5:8082).
// Phone and Mac must be on the same Wi‑Fi; backend must be running (npm run start:backend from Ploop).
const raw = typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_PLOOP_API_URL : undefined;
let explicitApiUrl = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : undefined;
const backendPort = explicitApiUrl ? getPortFromUrl(explicitApiUrl) : DEFAULT_PORT;

// Get Expo host early to detect simulator vs physical device
const hostUri =
  Constants.expoConfig?.hostUri ??
  (Constants as any).debuggerHost ??
  (Constants as any).manifest?.hostUri ??
  (Constants as any).manifest2?.extra?.expoClient?.hostUri;
const hostFromExpo = typeof hostUri === 'string' ? hostUri.split('/')[0]?.split(':')[0] : undefined;
const isSimulator = hostFromExpo === 'localhost' || hostFromExpo === '127.0.0.1';

// EXPO_PUBLIC_PLOOP_USE_LOCALHOST: only use localhost when we're in simulator (bundle from localhost).
// On physical device, localhost = the phone itself (wrong). Use LAN IP from explicitApiUrl instead.
if (__DEV__ && (process as any).env?.EXPO_PUBLIC_PLOOP_USE_LOCALHOST === 'true' && isSimulator) {
  explicitApiUrl = `http://localhost:${backendPort}`;
  if (__DEV__) console.log(`[Ploop] Simulator: using localhost:${backendPort}`);
}

// Web on localhost: only override to localhost when user is using a local backend (localhost/LAN IP).
// Do NOT override when user has a remote URL (e.g. https://ploop-api.onrender.com) – keep that.
if (__DEV__ && Platform.OS === 'web' && typeof window !== 'undefined') {
  const host = window.location.hostname;
  const isLocalDev = host === 'localhost' || host === '127.0.0.1';
  const explicitIsLocal =
    explicitApiUrl &&
    (explicitApiUrl.includes('localhost') ||
      explicitApiUrl.includes('127.0.0.1') ||
      /^https?:\/\/(\d+\.\d+\.\d+\.\d+)/.test(explicitApiUrl));
  if (isLocalDev && explicitIsLocal) {
    explicitApiUrl = `http://localhost:${backendPort}`;
  }
}

// Fallback: iOS Simulator with bundle from localhost but explicitApiUrl is LAN IP – use localhost.
if (__DEV__ && Platform.OS === 'ios' && explicitApiUrl && isSimulator) {
  const explicitIsLanIp = !explicitApiUrl.includes('localhost') && !explicitApiUrl.includes('127.0.0.1');
  if (explicitIsLanIp) {
    explicitApiUrl = `http://localhost:${backendPort}`;
  }
}

const RENDER_API_URL = 'https://ploop-api.onrender.com';

function isLocalOrDevUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.startsWith('192.168.') ||
      host.startsWith('10.0.2.') ||
      host.startsWith('10.') // 10.x.x.x = private, often dev
    );
  } catch {
    return false;
  }
}

let apiBaseUrl = __DEV__
  ? (explicitApiUrl || getDevBackendBaseUrl(backendPort))
  : (explicitApiUrl || RENDER_API_URL);

// PRODUCTION SAFEGUARD: Store builds must never use localhost/LAN. Force production API.
if (!__DEV__ && isLocalOrDevUrl(apiBaseUrl)) {
  apiBaseUrl = RENDER_API_URL;
}

// Android emulator (dev only): LAN IP often unreachable; use 10.0.2.2 when env set
if (__DEV__ && Platform.OS === 'android' && (process as any).env?.EXPO_PUBLIC_PLOOP_ANDROID_EMULATOR === 'true') {
  if (apiBaseUrl.includes('192.168.')) {
    apiBaseUrl = `http://10.0.2.2:${backendPort}`;
    console.log('[Ploop] Android emulator: using 10.0.2.2 for API');
  }
}

export const API_BASE_URL = apiBaseUrl;

if (__DEV__) {
  console.log('[Ploop] API base URL:', API_BASE_URL);
}

export const API_ENDPOINTS = {
  toilets: `${API_BASE_URL}/api/toilets`,
  superToiletOfTheDay: `${API_BASE_URL}/api/toilets/super-toilet-of-the-day`,
  toiletByPlace: (placeId: string) => `${API_BASE_URL}/api/toilets/by-place/${encodeURIComponent(placeId)}`,
  checkDuplicate: `${API_BASE_URL}/api/toilets/check-duplicate`,
  searchNames: `${API_BASE_URL}/api/toilets/search-names`,
  uploadPhoto: (toiletId: string) => `${API_BASE_URL}/api/toilets/${toiletId}/photo`,
  addReview: (toiletId: string) => `${API_BASE_URL}/api/toilets/${toiletId}/review`,
  markServiced: (toiletId: string) => `${API_BASE_URL}/api/toilets/${toiletId}/serviced`,
  landmarks: `${API_BASE_URL}/api/landmarks/search`,
  landmarkDetails: (placeId: string) => `${API_BASE_URL}/api/landmarks/${placeId}`,
  locationDetails: `${API_BASE_URL}/api/landmarks/location/details`,
  directions: `${API_BASE_URL}/api/directions`,
  reports: (toiletId: string) => `${API_BASE_URL}/api/reports/${toiletId}`,
  favorites: `${API_BASE_URL}/api/favorites`,
  favoriteToilet: (toiletId: string) => `${API_BASE_URL}/api/favorites/${toiletId}`,
  analytics: `${API_BASE_URL}/api/analytics`,
  hints: (toiletId: string) => `${API_BASE_URL}/api/hints/${toiletId}`,
  // Auth
  authGoogle: `${API_BASE_URL}/api/auth/google`,
  authApple: `${API_BASE_URL}/api/auth/apple`,
  authRegister: `${API_BASE_URL}/api/auth/register`,
  authLogin: `${API_BASE_URL}/api/auth/login`,
  authMe: `${API_BASE_URL}/api/auth/me`,
  // Reviews (own)
  toiletReviews: (toiletId: string) => `${API_BASE_URL}/api/toilets/${toiletId}/reviews`,
  updateReview: (toiletId: string, reviewId: string) =>
    `${API_BASE_URL}/api/toilets/${toiletId}/reviews/${reviewId}`,
  deleteReview: (toiletId: string, reviewId: string) =>
    `${API_BASE_URL}/api/toilets/${toiletId}/reviews/${reviewId}`,
  // Admin
  adminDashboard: `${API_BASE_URL}/api/admin/analytics/dashboard`,
  adminReviews: `${API_BASE_URL}/api/admin/reviews`,
  adminUpdateReview: (id: string) => `${API_BASE_URL}/api/admin/reviews/${id}`,
  adminDeleteReview: (id: string) => `${API_BASE_URL}/api/admin/reviews/${id}`,
  adminUsers: `${API_BASE_URL}/api/admin/users`,
  // Poop game
  poopGameScores: `${API_BASE_URL}/api/poop-game/scores`,
  // Suggestions (40 chars, sent to admin)
  suggestions: `${API_BASE_URL}/api/suggestions`,
  adminRegisterPushToken: `${API_BASE_URL}/api/admin/register-push-token`,
  // Golden Toilet Hunt
  huntStatus: `${API_BASE_URL}/api/hunt/status`,
  huntRegisterPushToken: `${API_BASE_URL}/api/hunt/register-push-token`,
  // Hunt admin
  huntAdminDashboard: `${API_BASE_URL}/api/admin/hunt/dashboard`,
  huntAdminPause: (huntId: string) => `${API_BASE_URL}/api/admin/hunt/${huntId}/pause`,
  huntAdminResume: (huntId: string) => `${API_BASE_URL}/api/admin/hunt/${huntId}/resume`,
  huntAdminReroll: (huntId: string, city: string) => `${API_BASE_URL}/api/admin/hunt/${huntId}/reroll/${encodeURIComponent(city)}`,
  huntAdminStart: `${API_BASE_URL}/api/admin/hunt/start`,
  huntAdminNotify: `${API_BASE_URL}/api/admin/hunt/notify`,
  huntAdminCheckins: `${API_BASE_URL}/api/admin/hunt/checkins`,
  huntAdminVoucher: (checkinId: string) => `${API_BASE_URL}/api/admin/hunt/checkins/${checkinId}/voucher`,
  huntAdminExport: `${API_BASE_URL}/api/admin/hunt/checkins/export`,
  huntAdminSyncCities: `${API_BASE_URL}/api/admin/hunt/sync-cities`,
  huntAdminCityPause: (huntId: string, city: string) => `${API_BASE_URL}/api/admin/hunt/${huntId}/cities/${encodeURIComponent(city)}/pause`,
  huntAdminCityResume: (huntId: string, city: string) => `${API_BASE_URL}/api/admin/hunt/${huntId}/cities/${encodeURIComponent(city)}/resume`,
  huntAdminCityEnd: (huntId: string, city: string) => `${API_BASE_URL}/api/admin/hunt/${huntId}/cities/${encodeURIComponent(city)}/end`,
  adminDiagnostics: `${API_BASE_URL}/api/admin/diagnostics`,
  adminCrashReports: `${API_BASE_URL}/api/admin/crash-reports`,
  diagnostics: `${API_BASE_URL}/api/diagnostics`,
  crashReports: `${API_BASE_URL}/api/crash-reports`,
};

