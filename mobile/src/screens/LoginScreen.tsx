import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Alert,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
} from 'react-native';
import { useNavigation, useRoute, CommonActions } from '@react-navigation/native';
import Constants from 'expo-constants';
import * as AuthSession from 'expo-auth-session';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { getErrorMessage } from '../utils/engagement';

// Use a stable redirect URI so Google Console only needs 2 entries:
// - Web: http://localhost:8081/redirect (explicit path avoids root path ambiguity)
// - Native: Expo auth proxy (https://auth.expo.io/@owner/slug)
function getGoogleRedirectUri(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const origin = window.location.origin;
    const base = origin.startsWith('http://127.0.0.1:')
      ? origin.replace('http://127.0.0.1:', 'http://localhost:')
      : origin;
    return `${base}/redirect`;
  }
  try {
    return AuthSession.getRedirectUrl();
  } catch {
    const owner = (Constants.expoConfig as any)?.owner ?? 'jcrs96';
    const slug = (Constants.expoConfig as any)?.slug ?? 'ploop';
    return `https://auth.expo.io/@${owner}/${slug}`;
  }
}

// Do not require expo-web-browser or expo-apple-authentication at top level:
// in some Expo Go builds the native modules are missing and would crash the module load.

export default function LoginScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const params = (route.params || {}) as { returnTo?: string; pendingScore?: number };
  const returnTo = params.returnTo;
  const pendingScore = params.pendingScore;
  const { user, loading: authLoading, loginWithGoogle, loginWithApple, loginWithEmail, registerWithEmail, logout, error, clearError } = useAuth();
  const { t } = useLanguage();
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailMode, setEmailMode] = useState<'signin' | 'register'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [appleAuth, setAppleAuth] = useState<typeof import('expo-apple-authentication') | null>(null);

  // Load Apple auth only after mount so a missing native module doesn't break the whole screen load
  useEffect(() => {
    let m: typeof import('expo-apple-authentication') | null = null;
    try {
      m = require('expo-apple-authentication');
    } catch {
      // not available
    }
    setAppleAuth(m);
  }, []);

  const redirectUri = getGoogleRedirectUri();
  useEffect(() => {
    if (__DEV__ && redirectUri) {
      console.log('[Ploop] Google redirect URI (add to Google Cloud Console):', redirectUri);
    }
  }, [redirectUri]);
  const clientId =
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ||
    (Constants.expoConfig?.extra as Record<string, unknown>)?.googleClientId ||
    '';
  const discovery = AuthSession.useAutoDiscovery('https://accounts.google.com');
  const [request, , promptAsync] = AuthSession.useAuthRequest(
    {
      clientId,
      redirectUri,
      scopes: ['openid', 'email', 'profile'],
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true,
    },
    discovery
  );

  // Clear stale error when navigating to this screen (Alert already shown by AuthContext)
  useEffect(() => {
    return () => { clearError(); };
  }, [clearError]);

  const handleGoogleSignIn = async () => {
    if (!clientId) {
      Alert.alert(
        'Google Sign-In not configured',
        'To log in as admin: add EXPO_PUBLIC_GOOGLE_CLIENT_ID to Ploop/mobile/.env (same as backend GOOGLE_CLIENT_ID), restart Expo, then reload. See Ploop/ADMIN_LOGIN.md for the full steps.'
      );
      return;
    }
    if (!request || !discovery) {
      Alert.alert(
        'Not ready',
        'Unable to start Google sign-in. Check your connection and try again.'
      );
      return;
    }
    setGoogleLoading(true);
    try {
      // Web: use same-tab redirect to avoid popup blockers. Store code_verifier for when we return.
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const authUrl = request.url ?? (await (request as any).makeAuthUrlAsync(discovery));
        const verifier = (request as any).codeVerifier;
        if (verifier) {
          try {
            window.sessionStorage.setItem('pkce_' + request.state, verifier);
          } catch {
            // sessionStorage may be unavailable in private mode
          }
        }
        window.location.href = authUrl;
        return; // Page will redirect; no need to reset loading
      }

      // Native: use promptAsync (popup or in-app browser)
      let urlToOpen: string | undefined;
      if (redirectUri.startsWith('https://auth.expo.io/') && discovery) {
        const authUrl = request.url ?? (await (request as any).makeAuthUrlAsync(discovery));
        const returnUrl = AuthSession.makeRedirectUri();
        urlToOpen = `${redirectUri}/start?${new URLSearchParams({ authUrl, returnUrl }).toString()}`;
      }
      const result = await promptAsync(urlToOpen ? { url: urlToOpen } : undefined);
      if (result.type === 'success' && result.params?.code) {
        const ok = await loginWithGoogle({
          code: result.params.code,
          redirect_uri: redirectUri,
          code_verifier: request.codeVerifier,
        });
        if (ok) {
          if (returnTo === 'PoopGame' && typeof pendingScore === 'number') {
            (navigation as any).dispatch(CommonActions.reset({
              index: 0,
              routes: [{ name: 'PoopGame', params: { pendingScore } }],
            }));
          } else {
            (navigation as any).dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'Map' }] }));
          }
        }
      }
    } catch (e: any) {
      Alert.alert('Error', getErrorMessage(e, 'Google sign-in failed'));
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    if (!appleAuth) return;
    setAppleLoading(true);
    try {
      const credential = await appleAuth.signInAsync({
        requestedScopes: [
          appleAuth.AppleAuthenticationScope.FULL_NAME,
          appleAuth.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (credential.identityToken) {
        const name =
          credential.fullName?.givenName || credential.fullName?.familyName
            ? [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ')
            : undefined;
        const ok = await loginWithApple(credential.identityToken, name);
        if (ok) {
          if (returnTo === 'PoopGame' && typeof pendingScore === 'number') {
            (navigation as any).dispatch(CommonActions.reset({
              index: 0,
              routes: [{ name: 'PoopGame', params: { pendingScore } }],
            }));
          } else {
            (navigation as any).dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'Map' }] }));
          }
        }
      } else {
        Alert.alert('Sign in', 'Apple did not return an identity token.');
      }
    } catch (e: any) {
      if (e?.code === 'ERR_REQUEST_CANCELED') {
        // user cancelled
        return;
      }
      Alert.alert('Error', getErrorMessage(e, 'Apple sign-in failed'));
    } finally {
      setAppleLoading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
  };

  const handleEmailSubmit = async () => {
    const e = email.trim().toLowerCase();
    const p = password.trim();
    if (!e || !p) {
      Alert.alert('Missing fields', 'Enter email and password.');
      return;
    }
    if (emailMode === 'register' && p.length < 8) {
      Alert.alert('Password too short', 'Use at least 8 characters.');
      return;
    }
    setEmailLoading(true);
    try {
      const ok = emailMode === 'register'
        ? await registerWithEmail(e, p, displayName.trim() || undefined)
        : await loginWithEmail(e, p);
      if (ok) {
        if (returnTo === 'PoopGame' && typeof pendingScore === 'number') {
          (navigation as any).dispatch(CommonActions.reset({
            index: 0,
            routes: [{ name: 'PoopGame', params: { pendingScore } }],
          }));
        } else {
          (navigation as any).dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'Map' }] }));
        }
      }
    } finally {
      setEmailLoading(false);
    }
  };

  if (authLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2196F3" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  if (user) {
    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.title}>Signed in</Text>
          <Text style={styles.email}>{user.display_name || user.email}</Text>
          {user.role === 'admin' && (
            <View style={styles.adminBadge}>
              <Text style={styles.adminText}>Admin</Text>
            </View>
          )}
          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
            <Text style={styles.logoutButtonText}>Sign out</Text>
          </TouchableOpacity>
        </View>
        {(navigation as any).canGoBack?.() ? (
          <TouchableOpacity style={styles.backButton} onPress={() => (navigation as any).goBack()}>
            <Text style={styles.backButtonText}>Back</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => (navigation as any).dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'Map' }] }))}
          >
            <Text style={styles.backButtonText}>{t('continueToApp')}</Text>
          </TouchableOpacity>
        )}
      </View>
      );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.title}>{t('createAccountOrSignIn')}</Text>
        <Text style={styles.subtitle}>{t('useGoogleAppleEmail')}</Text>

        <View style={styles.emailForm}>
          <TouchableOpacity
            style={styles.emailModeToggle}
            onPress={() => setEmailMode((m) => (m === 'signin' ? 'register' : 'signin'))}
          >
            <Text style={[styles.emailModeText, emailMode === 'signin' && styles.emailModeTextActive]}>
              {t('signIn')}
            </Text>
            <Text style={[styles.emailModeText, emailMode === 'register' && styles.emailModeTextActive]}>
              {t('createAccount')}
            </Text>
          </TouchableOpacity>
          <TextInput
            style={styles.emailInput}
            placeholder={t('email')}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {emailMode === 'register' && (
            <TextInput
              style={styles.emailInput}
              placeholder={t('nameOptional')}
              value={displayName}
              onChangeText={setDisplayName}
              autoCapitalize="words"
            />
          )}
          <TextInput
            style={styles.emailInput}
            placeholder={emailMode === 'register' ? t('passwordMin8') : t('password')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          <TouchableOpacity
            style={[styles.button, styles.emailSubmitButton]}
            onPress={handleEmailSubmit}
            disabled={emailLoading}
          >
            {emailLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.emailSubmitText}>
                {emailMode === 'register' ? t('createAccount') : t('signInWithEmail')}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.orDivider}>{t('orDivider')}</Text>


        {__DEV__ && redirectUri ? (
          <>
            <Text style={styles.redirectUriHint}>If redirect_uri_mismatch: add this in Google Cloud → Credentials → OAuth client → Authorized redirect URIs:</Text>
            <Text style={styles.redirectUriValue} selectable>{redirectUri}</Text>
          </>
        ) : null}
        <TouchableOpacity
          style={[styles.button, styles.googleButton]}
          onPress={handleGoogleSignIn}
          disabled={googleLoading}
        >
          {googleLoading ? (
            <ActivityIndicator color="#333" />
          ) : (
            <Text style={styles.googleButtonText}>{t('signInWithGoogle')}</Text>
          )}
        </TouchableOpacity>

        {Platform.OS === 'ios' && appleAuth && (() => {
          const AppleBtn = appleAuth.AppleAuthenticationButton;
          return (
            <AppleBtn
              buttonType={appleAuth.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={appleAuth.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={8}
              style={styles.appleButton}
              onPress={handleAppleSignIn}
              disabled={appleLoading}
            />
          );
        })()}
        {Platform.OS === 'ios' && appleLoading && (
          <ActivityIndicator style={styles.appleLoader} color="#fff" />
        )}

        <TouchableOpacity
          style={[styles.button, styles.guestButton]}
          onPress={() => (navigation as any).dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'Map' }] }))}
        >
          <Text style={styles.guestButtonText}>Continue as guest</Text>
        </TouchableOpacity>
      </View>
      </ScrollView>
      {(navigation as any).canGoBack?.() ? (
        <TouchableOpacity style={styles.backButton} onPress={() => (navigation as any).goBack()}>
          <Text style={styles.backButtonText}>Cancel</Text>
        </TouchableOpacity>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 24,
  },
  emailForm: {
    marginBottom: 20,
  },
  emailModeToggle: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 12,
  },
  emailModeText: {
    fontSize: 15,
    color: '#888',
  },
  emailModeTextActive: {
    color: '#2196F3',
    fontWeight: '600',
  },
  emailInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 10,
    backgroundColor: '#fff',
  },
  emailSubmitButton: {
    backgroundColor: '#2196F3',
    marginTop: 4,
  },
  emailSubmitText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  orDivider: {
    textAlign: 'center',
    color: '#999',
    fontSize: 14,
    marginBottom: 16,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
    color: '#333',
  },
  subtitle: {
    fontSize: 15,
    color: '#666',
    marginBottom: 24,
  },
  redirectUriHint: {
    fontSize: 11,
    color: '#888',
    marginBottom: 4,
  },
  redirectUriValue: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: '#2196F3',
    marginBottom: 12,
  },
  email: {
    fontSize: 16,
    color: '#333',
    marginBottom: 8,
  },
  adminBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#2196F3',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 16,
  },
  adminText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  button: {
    height: 48,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  googleButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  googleButtonText: {
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
  },
  appleButton: {
    width: '100%',
    height: 48,
    marginBottom: 12,
  },
  appleLoader: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 24,
  },
  guestButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#2196F3',
    marginTop: 8,
  },
  guestButtonText: {
    fontSize: 16,
    color: '#2196F3',
    fontWeight: '500',
  },
  logoutButton: {
    backgroundColor: '#f44336',
    height: 48,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  logoutButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  backButton: {
    padding: 16,
    alignItems: 'center',
  },
  backButtonText: {
    fontSize: 16,
    color: '#2196F3',
  },
});
