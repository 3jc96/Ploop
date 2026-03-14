/**
 * Wraps the real LoginScreen with a dynamic import. We always try to load it so
 * Google/Apple sign-in work when native modules are available. If the module fails
 * (e.g. ExpoWebBrowser missing in some Expo Go builds), we show a fallback.
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

type LoginComponent = React.ComponentType<any>;

export default function LoginScreenWrapper() {
  const navigation = useNavigation();
  const [LoginScreen, setLoginScreen] = useState<LoginComponent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    import('./LoginScreen')
      .then((m) => {
        if (!cancelled && m?.default) setLoginScreen(() => m.default);
      })
      .catch((e) => {
        if (!cancelled) {
          console.warn('Login screen failed to load:', e?.message || e);
          setLoadError(e?.message || 'Sign-in unavailable in this build. Use Continue as guest.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError) {
    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.title}>Sign-in unavailable</Text>
          <Text style={styles.message}>
            Sign-in could not load (missing native module). Use &quot;Continue as guest&quot; or try again in a dev build.
          </Text>
          <Text style={styles.detail}>{loadError}</Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() => (navigation as any).goBack()}
          >
            <Text style={styles.buttonText}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!LoginScreen) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2196F3" />
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  return <LoginScreen />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#333',
    marginBottom: 12,
  },
  message: {
    fontSize: 15,
    color: '#666',
    marginBottom: 8,
    lineHeight: 22,
  },
  detail: {
    fontSize: 12,
    color: '#999',
    fontFamily: 'monospace',
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#2196F3',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
  },
});
