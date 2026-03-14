/**
 * Shown when user lands on /redirect?code=...&state=... (web same-tab OAuth flow).
 * Exchanges the code with the backend and navigates to Map, or shows error.
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { useNavigation, CommonActions } from '@react-navigation/native';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../config/api';

function getWebRedirectUri(): string {
  if (typeof window === 'undefined') return '';
  const origin = window.location.origin;
  const base = origin.startsWith('http://127.0.0.1:')
    ? origin.replace('http://127.0.0.1:', 'http://localhost:')
    : origin;
  return `${base}/redirect`;
}

export default function RedirectScreen() {
  const navigation = useNavigation();
  const { refreshUser } = useAuth();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');

    if (!code || !state) {
      setStatus('error');
      setErrorMsg('Invalid redirect. Please try signing in again.');
      return;
    }

    const redirectUri = getWebRedirectUri();
    if (!redirectUri || !redirectUri.startsWith('http')) {
      setStatus('error');
      setErrorMsg(
        'Could not determine redirect URI. Add this URL to Google Cloud Console → Credentials → OAuth client → Authorized redirect URIs: ' +
          (typeof window !== 'undefined' ? `${window.location.origin}/redirect` : 'your-app-origin/redirect')
      );
      return;
    }

    let codeVerifier: string | null = null;
    try {
      codeVerifier = window.sessionStorage.getItem('pkce_' + state);
      if (codeVerifier) window.sessionStorage.removeItem('pkce_' + state);
    } catch {
      // sessionStorage may be unavailable
    }

    if (!codeVerifier) {
      setStatus('error');
      setErrorMsg('Session expired. Please try signing in again from the login page.');
      return;
    }

    api.auth
      .loginWithGoogle({ code, redirect_uri: redirectUri, code_verifier: codeVerifier })
      .then(() => refreshUser())
      .then(() => {
        setStatus('success');
        // Clear URL first so linking doesn't re-parse and override our navigation
        window.history.replaceState({}, '', '/map');
        try {
          (navigation as any).dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'Map' }] }));
        } catch {
          window.location.href = '/map';
        }
      })
      .catch((e: any) => {
        console.error('[Ploop] Google code exchange failed:', e);
        setStatus('error');
        let msg = e?.response?.data?.error ?? e?.message ?? 'Sign-in failed.';
        if (msg.includes('timeout') || msg.includes('exceeded')) {
          msg = 'Request timed out. Render free tier may be waking up – try again in 30 seconds.';
        } else if (msg.includes('redirect_uri')) {
          msg += ` Add this exact URL to Google Cloud Console → Credentials → OAuth client → Authorized redirect URIs: ${redirectUri}`;
        } else if (e?.response?.status === 401) {
          msg += ' Check Render env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET must match your OAuth client. Redeploy after changing env.';
        }
        setErrorMsg(String(msg));
      });
  }, [navigation, refreshUser]);

  const goToLogin = () => {
    try {
      (navigation as any).dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'Login' }] }));
    } catch {
      window.location.href = '/login';
    }
  };

  const goHome = () => {
    try {
      (navigation as any).dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'Map' }] }));
    } catch {
      window.location.href = '/';
    }
  };

  if (status === 'loading') {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#2196F3" />
        <Text style={styles.text}>Completing sign-in…</Text>
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={styles.container}>
        <Text style={styles.errorTitle}>Sign-in failed</Text>
        <Text style={styles.errorMsg}>{errorMsg}</Text>
        <Text style={styles.apiUrl}>API: {API_BASE_URL}</Text>
        <TouchableOpacity style={styles.button} onPress={goToLogin}>
          <Text style={styles.buttonText}>Try again</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.secondaryButton]} onPress={goHome}>
          <Text style={styles.secondaryButtonText}>Go home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // success: brief flash before navigation
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#2196F3" />
      <Text style={styles.text}>Redirecting…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    padding: 24,
  },
  text: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#333',
    marginBottom: 12,
  },
  errorMsg: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    marginBottom: 12,
  },
  apiUrl: {
    fontSize: 12,
    color: '#999',
    fontFamily: 'monospace',
    marginBottom: 24,
  },
  button: {
    backgroundColor: '#2196F3',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 8,
    marginBottom: 12,
    minWidth: 200,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#2196F3',
  },
  secondaryButtonText: {
    color: '#2196F3',
    fontSize: 16,
    fontWeight: '500',
  },
});
