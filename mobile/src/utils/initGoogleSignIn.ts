/**
 * Configures native Google Sign-In for Android.
 * Only runs on Android; iOS/web use expo-auth-session.
 * Requires a development build – skip entirely in Expo Go to avoid crashes.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';

const WEB_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ||
  '765592890788-6e8s1b0ugc544krdfiosv0lv9cg2ket5.apps.googleusercontent.com';

export function initGoogleSignIn(): void {
  if (Platform.OS !== 'android') return;
  if (Constants.appOwnership === 'expo') return; // Expo Go – native module not available
  try {
    const mod = require('@react-native-google-signin/google-signin');
    const GoogleSignin = mod?.GoogleSignin ?? mod?.default?.GoogleSignin;
    if (GoogleSignin) {
      GoogleSignin.configure({
        webClientId: WEB_CLIENT_ID,
        offlineAccess: true,
      });
    }
  } catch {
    // Module not available – will use expo-auth-session fallback
  }
}
