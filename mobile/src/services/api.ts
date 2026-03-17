import { API_ENDPOINTS } from '../config/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { httpClient, timeouts } from './httpClient';

const AUTH_TIMEOUT_MS = timeouts.auth;

export interface Toilet {
  id: string;
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
  google_place_id?: string;
  cleanliness_score: number | string | null;
  smell_score: number | string | null;
  total_reviews: number;
  has_toilet_paper: boolean;
  has_bidet: boolean;
  has_seat_warmer: boolean;
  has_hand_soap: boolean;
  has_baby_changing?: boolean;
  has_family_room?: boolean;
  number_of_stalls: number;
  toilet_type: 'squat' | 'sit' | 'both';
  pay_to_enter: boolean;
  entry_fee?: number;
  wheelchair_accessible: boolean;
  distance?: number;
  photos?: Array<{ id: string; photo_url: string; uploaded_at: string }>;
  confidence_score?: number;
  last_verified_at?: string;
  last_serviced_at?: string;
  active_reports?: number;
  report_summary?: Array<{ type: string; note?: string | null; created_at: string; expires_at: string }>;
}

export interface CreateToiletData {
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
  google_place_id?: string;
  has_toilet_paper: boolean;
  has_bidet: boolean;
  has_seat_warmer: boolean;
  has_hand_soap: boolean;
  has_baby_changing?: boolean;
  has_family_room?: boolean;
  number_of_stalls: number;
  toilet_type: 'squat' | 'sit' | 'both';
  pay_to_enter: boolean;
  entry_fee?: number;
  wheelchair_accessible: boolean;
  cleanliness_score?: number;
  smell_score?: number;
  /** Set when user is logged in so the backend can record creator */
  created_by?: string;
}

export interface NearbyToiletsParams {
  latitude: number;
  longitude: number;
  radius?: number;
  limit?: number;
  wheelchair_accessible?: boolean;
  free_only?: boolean;
  min_confidence?: number;
  has_bidet?: boolean;
}

export interface DirectionsParams {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  mode?: 'driving' | 'walking' | 'bicycling';
}

export interface DirectionStep {
  travelMode: 'WALK' | 'DRIVE' | 'BICYCLE' | 'TRANSIT' | string;
  instructions?: string;
  distanceMeters?: number;
  distanceText?: string;
  durationSeconds?: number;
  durationText?: string;
  transit?: {
    lineShortName?: string;
    lineName?: string;
    vehicleType?: string;
    agencyName?: string;
    headsign?: string;
    stopCount?: number;
    departureStopName?: string;
    arrivalStopName?: string;
    departureTime?: string;
    arrivalTime?: string;
    departureTimeText?: string;
    arrivalTimeText?: string;
    headwaySeconds?: number;
    waitMinutes?: number;
    color?: string;
    textColor?: string;
  };
}

export const AUTH_TOKEN_KEY = 'ploop.auth.token';

export const getStoredAuthToken = (): Promise<string | null> =>
  AsyncStorage.getItem(AUTH_TOKEN_KEY);

export interface AuthUser {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
}

export interface ToiletReview {
  id: string;
  toilet_id: string;
  cleanliness_score: number | null;
  smell_score: number | null;
  review_text: string | null;
  reviewed_at: string;
  reviewed_by: string | null;
  user_id: string | null;
}

export const api = {
  _deviceId: null as string | null,

  getAuthHeaders: async (): Promise<{ Authorization?: string }> => {
    const token = await AsyncStorage.getItem(AUTH_TOKEN_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  },

  setAuthToken: async (token: string | null): Promise<void> => {
    if (token) await AsyncStorage.setItem(AUTH_TOKEN_KEY, token);
    else await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
  },

  ensureDeviceId: async (): Promise<string> => {
    if (api._deviceId) return api._deviceId;
    const key = 'device.id.v1';
    const existing = await AsyncStorage.getItem(key);
    if (existing) {
      api._deviceId = existing;
      return existing;
    }
    const generated = `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    await AsyncStorage.setItem(key, generated);
    api._deviceId = generated;
    return generated;
  },

  withDeviceHeaders: async () => {
    const deviceId = await api.ensureDeviceId();
    return { headers: { 'X-Ploop-Device-Id': deviceId } };
  },

  // Get nearby toilets (normalize response so toilets is always an array)
  getNearbyToilets: async (params: NearbyToiletsParams): Promise<{ toilets: Toilet[]; count: number }> => {
    const response = await httpClient.get(API_ENDPOINTS.toilets, { params });
    const data = response?.data ?? {};
    const toilets = Array.isArray(data.toilets) ? data.toilets : [];
    return { toilets, count: typeof data.count === 'number' ? data.count : toilets.length };
  },

  // Get toilet by ID
  getToilet: async (id: string): Promise<Toilet> => {
    const response = await httpClient.get(`${API_ENDPOINTS.toilets}/${id}`);
    return response.data;
  },

  // Check for duplicates
  checkDuplicate: async (data: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
    excludeId?: string;
  }): Promise<{ isDuplicate: boolean; duplicateId?: string; reason?: string }> => {
    const response = await httpClient.post(API_ENDPOINTS.checkDuplicate, data);
    return response.data;
  },

  // Create new toilet
  createToilet: async (data: CreateToiletData): Promise<Toilet> => {
    const response = await httpClient.post(API_ENDPOINTS.toilets, data);
    return response.data;
  },

  // Get a toilet by Google Place ID (for POI-tap consistency)
  getToiletByPlaceId: async (placeId: string): Promise<Toilet | null> => {
    try {
      const response = await httpClient.get(API_ENDPOINTS.toiletByPlace(placeId));
      return response.data;
    } catch (e: any) {
      if (e?.response?.status === 404) return null;
      throw e;
    }
  },

  // Update toilet – only send fields the backend PUT accepts so validation doesn't return 400
  updateToilet: async (id: string, data: Partial<CreateToiletData>): Promise<Toilet> => {
    const allowed = [
      'name', 'address', 'latitude', 'longitude', 'google_place_id',
      'has_toilet_paper', 'has_bidet', 'has_seat_warmer', 'has_hand_soap',
      'has_baby_changing', 'has_family_room',
      'number_of_stalls', 'toilet_type', 'pay_to_enter', 'entry_fee', 'wheelchair_accessible',
    ] as const;
    const payload: Record<string, unknown> = {};
    for (const key of allowed) {
      const v = (data as Record<string, unknown>)[key];
      if (v !== undefined && v !== null) payload[key] = v;
    }
    if (payload.name === '') delete payload.name;
    const response = await httpClient.put(`${API_ENDPOINTS.toilets}/${id}`, payload);
    return response.data;
  },

  // Upload photo
  uploadPhoto: async (toiletId: string, photoUri: string): Promise<any> => {
    const formData = new FormData();
    formData.append('photo', {
      uri: photoUri,
      type: 'image/jpeg',
      name: 'photo.jpg',
    } as any);

    const response = await httpClient.post(API_ENDPOINTS.uploadPhoto(toiletId), formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  // Add review (sends auth header when logged in so review is linked to user)
  addReview: async (toiletId: string, data: {
    cleanliness_score?: number;
    smell_score?: number;
    review_text?: string;
  }): Promise<any> => {
    const auth = await api.getAuthHeaders();
    const response = await httpClient.post(API_ENDPOINTS.addReview(toiletId), data, { headers: auth });
    return response.data;
  },

  getToiletReviews: async (toiletId: string): Promise<{ reviews: ToiletReview[] }> => {
    const response = await httpClient.get(API_ENDPOINTS.toiletReviews(toiletId));
    return response.data;
  },

  updateReview: async (
    toiletId: string,
    reviewId: string,
    data: { cleanliness_score?: number; smell_score?: number; review_text?: string }
  ): Promise<{ review: ToiletReview; toilet: Toilet }> => {
    const auth = await api.getAuthHeaders();
    const response = await httpClient.patch(API_ENDPOINTS.updateReview(toiletId, reviewId), data, {
      headers: auth,
    });
    return response.data;
  },

  deleteReview: async (toiletId: string, reviewId: string): Promise<{ ok: boolean; toilet: Toilet }> => {
    const auth = await api.getAuthHeaders();
    const response = await httpClient.delete(API_ENDPOINTS.deleteReview(toiletId, reviewId), {
      headers: auth,
    });
    return response.data;
  },

  markServiced: async (toiletId: string): Promise<{ toilet: Toilet; message: string }> => {
    const auth = await api.getAuthHeaders();
    const response = await httpClient.post(API_ENDPOINTS.markServiced(toiletId), {}, { headers: auth });
    return response.data;
  },

  auth: {
    loginWithGoogle: async (payload: { id_token?: string; code?: string; redirect_uri?: string; code_verifier?: string }): Promise<{ token: string; user: AuthUser }> => {
      const response = await httpClient.post(API_ENDPOINTS.authGoogle, payload, { timeout: AUTH_TIMEOUT_MS });
      const { token, user } = response.data;
      await api.setAuthToken(token);
      return { token, user };
    },
    loginWithApple: async (id_token: string, name?: string): Promise<{ token: string; user: AuthUser }> => {
      const response = await httpClient.post(API_ENDPOINTS.authApple, { id_token, name }, { timeout: AUTH_TIMEOUT_MS });
      const { token, user } = response.data;
      await api.setAuthToken(token);
      return { token, user };
    },
    register: async (email: string, password: string, displayName?: string): Promise<{ token: string; user: AuthUser }> => {
      const response = await httpClient.post(
        API_ENDPOINTS.authRegister,
        { email, password, display_name: displayName },
        { timeout: AUTH_TIMEOUT_MS }
      );
      const { token, user } = response.data;
      await api.setAuthToken(token);
      return { token, user };
    },
    loginWithEmail: async (email: string, password: string): Promise<{ token: string; user: AuthUser }> => {
      const response = await httpClient.post(
        API_ENDPOINTS.authLogin,
        { email, password },
        { timeout: AUTH_TIMEOUT_MS }
      );
      const { token, user } = response.data;
      await api.setAuthToken(token);
      return { token, user };
    },
    getMe: async (): Promise<{ user: AuthUser }> => {
      const auth = await api.getAuthHeaders();
      const response = await httpClient.get(API_ENDPOINTS.authMe, { headers: auth });
      return response.data;
    },
    logout: async (): Promise<void> => {
      await api.setAuthToken(null);
    },
  },

  admin: {
    getDashboard: async (params?: { from?: string; to?: string; groupBy?: 'day' | 'week' | 'month' }): Promise<{
      from: string;
      to: string;
      groupBy: string;
      totals: { users: number; toilets: number; reviews: number; favorites: number; uniqueDevices?: number };
      inRange: { reviews: number; toilets: number; users: number; uniqueDevices?: number };
      series: {
        reviews: Array<{ period: string; count: number }>;
        toilets: Array<{ period: string; count: number }>;
        users: Array<{ period: string; count: number }>;
        devices?: Array<{ period: string; count: number }>;
      };
      topToilets: Array<{ id: string; name: string; address?: string; total_reviews: number; cleanliness_score?: number; smell_score?: number }>;
      eventsByType: Array<{ event: string; count: number }>;
    }> => {
      const auth = await api.getAuthHeaders();
      const response = await httpClient.get(API_ENDPOINTS.adminDashboard, { params: params || {}, headers: auth });
      return response.data;
    },
    getReviews: async (params?: { limit?: number; offset?: number }): Promise<{ reviews: any[]; total: number }> => {
      const auth = await api.getAuthHeaders();
      const response = await httpClient.get(API_ENDPOINTS.adminReviews, { params: params || {}, headers: auth });
      return response.data;
    },
    updateReview: async (
      reviewId: string,
      data: { cleanliness_score?: number; smell_score?: number; review_text?: string; reviewed_by?: string; toilet_name?: string }
    ): Promise<{ review: any }> => {
      const auth = await api.getAuthHeaders();
      const response = await httpClient.patch(API_ENDPOINTS.adminUpdateReview(reviewId), data, { headers: auth });
      return response.data;
    },
    deleteReview: async (reviewId: string): Promise<{ ok: boolean; deleted: string }> => {
      const auth = await api.getAuthHeaders();
      const response = await httpClient.delete(API_ENDPOINTS.adminDeleteReview(reviewId), { headers: auth });
      return response.data;
    },
    registerPushToken: async (token: string): Promise<{ ok: boolean }> => {
      const auth = await api.getAuthHeaders();
      const response = await httpClient.post(API_ENDPOINTS.adminRegisterPushToken, { token }, { headers: auth });
      return response.data;
    },
  },

  // Submit suggestion (40 chars max, sent to admin email + push)
  submitSuggestion: async (text: string): Promise<{ id: string; ok: boolean }> => {
    const cfg = await api.withDeviceHeaders();
    const auth = await api.getAuthHeaders();
    const response = await httpClient.post(API_ENDPOINTS.suggestions, { text: text.trim().slice(0, 40) }, {
      ...cfg,
      headers: { ...cfg.headers, ...auth },
    });
    return response.data;
  },

  // Submit a quick report (closed/busy/etc)
  submitReport: async (
    toiletId: string,
    data: { type: 'closed' | 'out_of_order' | 'no_access' | 'gross' | 'busy' | 'needs_cleaning'; note?: string }
  ): Promise<any> => {
    const cfg = await api.withDeviceHeaders();
    const response = await httpClient.post(API_ENDPOINTS.reports(toiletId), data, cfg);
    return response.data;
  },

  // List active reports for a toilet
  getReports: async (toiletId: string): Promise<{ toiletId: string; reports: Array<{ report_type: string; count: number; last_at: string }> }> => {
    const response = await httpClient.get(API_ENDPOINTS.reports(toiletId));
    return response.data;
  },

  // Community hints
  getHints: async (toiletId: string): Promise<{ toiletId: string; hints: Array<{ id: string; hint_text: string; created_at: string }> }> => {
    const response = await httpClient.get(API_ENDPOINTS.hints(toiletId));
    return response.data;
  },

  addHint: async (toiletId: string, text: string): Promise<{ hint: { id: string; hint_text: string; created_at: string } }> => {
    const cfg = await api.withDeviceHeaders();
    const response = await httpClient.post(API_ENDPOINTS.hints(toiletId), { text }, cfg);
    return response.data;
  },

  // Favorites (normalize so favorites is always an array)
  listFavorites: async (): Promise<{ favorites: Toilet[] }> => {
    const cfg = await api.withDeviceHeaders();
    const response = await httpClient.get(API_ENDPOINTS.favorites, cfg);
    const data = response?.data ?? {};
    const favorites = Array.isArray(data.favorites) ? data.favorites : [];
    return { favorites };
  },

  favoriteToilet: async (toiletId: string): Promise<{ ok: true }> => {
    const cfg = await api.withDeviceHeaders();
    const response = await httpClient.post(API_ENDPOINTS.favoriteToilet(toiletId), {}, cfg);
    return response.data;
  },

  unfavoriteToilet: async (toiletId: string): Promise<{ ok: true }> => {
    const cfg = await api.withDeviceHeaders();
    const response = await httpClient.delete(API_ENDPOINTS.favoriteToilet(toiletId), cfg);
    return response.data;
  },

  // Analytics (best-effort)
  track: async (event: string, payload?: any): Promise<void> => {
    try {
      const deviceId = await api.ensureDeviceId();
      await httpClient.post(API_ENDPOINTS.analytics, { event, payload, deviceId });
    } catch {
      // ignore analytics failures
    }
  },

  // Local-only engagement stats (for badges/retention without login)
  bumpLocalMetric: async (key: 'reviews' | 'reports' | 'favorites', delta = 1): Promise<void> => {
    try {
      const k = `stats.${key}.v1`;
      const raw = await AsyncStorage.getItem(k);
      const cur = raw ? parseInt(raw, 10) || 0 : 0;
      await AsyncStorage.setItem(k, String(Math.max(0, cur + delta)));
    } catch {
      // ignore
    }
  },

  getLocalMetrics: async (): Promise<{ reviews: number; reports: number; favorites: number }> => {
    const read = async (k: string) => {
      try {
        const raw = await AsyncStorage.getItem(k);
        return raw ? parseInt(raw, 10) || 0 : 0;
      } catch {
        return 0;
      }
    };
    const [reviews, reports, favorites] = await Promise.all([
      read('stats.reviews.v1'),
      read('stats.reports.v1'),
      read('stats.favorites.v1'),
    ]);
    return { reviews, reports, favorites };
  },

  // Poop game
  submitPoopGameScore: async (score: number, displayName?: string): Promise<{ id: string; score: number; display_name: string }> => {
    const cfg = await api.withDeviceHeaders();
    const auth = await api.getAuthHeaders();
    const response = await httpClient.post(
      API_ENDPOINTS.poopGameScores,
      { score, display_name: displayName },
      { headers: { ...cfg.headers, ...auth } }
    );
    return response.data;
  },
  getPoopGameLeaderboard: async (limit = 50): Promise<{ scores: Array<{ score: number; display_name: string; created_at: string }> }> => {
    const response = await httpClient.get(API_ENDPOINTS.poopGameScores, { params: { limit } });
    return response.data;
  },

  // Search toilet names (for autocomplete)
  searchNames: async (params: {
    query: string;
    latitude?: number;
    longitude?: number;
    radius?: number;
    limit?: number;
  }): Promise<{ suggestions: Array<Toilet & { similarity: number; distance?: number }> }> => {
    const response = await httpClient.get(`${API_ENDPOINTS.toilets}/search-names`, { params });
    return response.data;
  },

  // Search landmarks
  searchLandmarks: async (params: {
    query?: string;
    latitude?: number;
    longitude?: number;
  }): Promise<{ landmarks: Array<{
    id: string;
    name: string;
    address: string;
    latitude: number;
    longitude: number;
    types?: string[];
  }> }> => {
    const response = await httpClient.get(API_ENDPOINTS.landmarks, { params });
    return response.data;
  },

  // Get landmark/place details by Google placeId (most accurate for POI taps)
  // Shorter timeout: fail fast so POI sheet shows basic info when backend unreachable.
  getLandmarkDetails: async (placeId: string): Promise<{
    id: string;
    name: string;
    address: string;
    latitude: number;
    longitude: number;
    googleRating?: number;
    googleReviewCount?: number;
    openNow?: boolean;
    weekdayText?: string[];
    googleReviews?: Array<{
      author: string;
      rating: number;
      text: string;
      time: number;
      relativeTime: string;
    }>;
  }> => {
    const response = await httpClient.get(API_ENDPOINTS.landmarkDetails(placeId), { timeout: timeouts.poi });
    const data = response.data;
    if (__DEV__) {
      console.log('[Ploop] getLandmarkDetails', placeId, '→', { name: data?.name, address: data?.address ? '✓' : '✗', hasRating: !!data?.googleRating });
    }
    return data;
  },

  // Get location details (for tap-to-review)
  getLocationDetails: async (params: {
    latitude: number;
    longitude: number;
  }): Promise<{
    location: {
      latitude: number;
      longitude: number;
      address: string;
    };
    place?: {
      placeId: string;
      name: string;
      address: string;
      googleRating?: number;
      googleReviewCount?: number;
      googleReviews?: Array<{
        author: string;
        rating: number;
        text: string;
        time: number;
        relativeTime: string;
      }>;
    };
  }> => {
    const response = await httpClient.get(API_ENDPOINTS.locationDetails, { params, timeout: timeouts.poi });
    const data = response.data;
    if (__DEV__) {
      const locAddr = data?.location?.address;
      const placeAddr = data?.place?.address;
      console.log('[Ploop] getLocationDetails', params, '→', {
        locationAddress: locAddr ? (locAddr.includes('Location at') ? 'coords' : '✓') : '✗',
        placeAddress: placeAddr ? '✓' : (data?.place ? '✗' : 'no place'),
      });
    }
    return data;
  },

  /** Probe backend connectivity. Use before critical flows or on retry. */
  checkHealth: async (timeoutMs = 5000): Promise<boolean> => {
    try {
      const res = await httpClient.get('/health', { timeout: timeoutMs });
      return res?.status === 200;
    } catch {
      return false;
    }
  },

  // Get directions between two points (returns encoded polyline)
  getDirections: async (params: DirectionsParams): Promise<{
    polyline: string;
    distanceText?: string;
    durationText?: string;
    transitFareText?: string;
    steps?: DirectionStep[];
  }> => {
    const response = await httpClient.get(API_ENDPOINTS.directions, { params });
    return response.data;
  },
};

