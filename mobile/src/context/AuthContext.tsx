import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { api, AuthUser, getStoredAuthToken } from '../services/api';
import { getErrorMessage } from '../utils/engagement';

type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
};

type AuthContextValue = AuthState & {
  loginWithGoogle: (payload: { id_token?: string; code?: string; redirect_uri?: string; code_verifier?: string }) => Promise<boolean>;
  loginWithApple: (id_token: string, name?: string) => Promise<boolean>;
  loginWithEmail: (email: string, password: string) => Promise<boolean>;
  registerWithEmail: (email: string, password: string, displayName?: string) => Promise<boolean>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  clearError: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true, error: null });

  const refreshUser = useCallback(async () => {
    const token = await getStoredAuthToken();
    if (!token) {
      setState((s) => ({ ...s, user: null, loading: false }));
      return;
    }
    try {
      const { user } = await api.auth.getMe();
      setState((s) => ({ ...s, user, loading: false, error: null }));
    } catch {
      await api.setAuthToken(null);
      setState((s) => ({ ...s, user: null, loading: false }));
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const loginWithGoogle = useCallback(
    async (payload: { id_token?: string; code?: string; redirect_uri?: string; code_verifier?: string }): Promise<boolean> => {
      setState((s) => ({ ...s, error: null }));
      try {
        await api.auth.loginWithGoogle(payload);
        await refreshUser();
        return true;
      } catch (e: any) {
        if (__DEV__) {
          console.error('[Ploop] Google sign-in error:', e?.response?.data ?? e?.message ?? e);
        }
        let msg = getErrorMessage(e, 'Google sign-in failed');
        if (e?.response?.status === 401 && !msg.includes('GOOGLE') && !msg.includes('Render')) {
          msg += ' Ensure Render has GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET set. Redeploy after changing env.';
        }
        if ((e?.code === 'ECONNABORTED' || /timeout/i.test(e?.message || '')) && !msg.includes('Render')) {
          msg = 'Request timed out. Render free tier may be waking up – try again in 30 seconds.';
        }
        setState((s) => ({ ...s, error: msg }));
        Alert.alert('Sign in failed', msg);
        return false;
      }
    },
    [refreshUser]
  );

  const loginWithApple = useCallback(
    async (id_token: string, name?: string): Promise<boolean> => {
      setState((s) => ({ ...s, error: null }));
      try {
        await api.auth.loginWithApple(id_token, name);
        await refreshUser();
        return true;
      } catch (e: any) {
        const msg = getErrorMessage(e, 'Apple sign-in failed');
        setState((s) => ({ ...s, error: msg }));
        Alert.alert('Sign in failed', msg);
        return false;
      }
    },
    [refreshUser]
  );

  const loginWithEmail = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      setState((s) => ({ ...s, error: null }));
      try {
        await api.auth.loginWithEmail(email, password);
        await refreshUser();
        return true;
      } catch (e: any) {
        let msg = getErrorMessage(e, 'Invalid email or password');
        if (e?.response?.status === 404) {
          msg = 'Email sign-in may not be deployed yet. Try Google or Apple, or use a local backend.';
        }
        setState((s) => ({ ...s, error: msg }));
        Alert.alert('Sign in failed', msg);
        return false;
      }
    },
    [refreshUser]
  );

  const registerWithEmail = useCallback(
    async (email: string, password: string, displayName?: string): Promise<boolean> => {
      setState((s) => ({ ...s, error: null }));
      try {
        await api.auth.register(email, password, displayName);
        await refreshUser();
        return true;
      } catch (e: any) {
        let msg = getErrorMessage(e, 'Registration failed');
        if (e?.response?.status === 404) {
          msg = 'Email sign-up may not be deployed yet. Try Google or Apple, or use a local backend.';
        }
        setState((s) => ({ ...s, error: msg }));
        Alert.alert('Registration failed', msg);
        return false;
      }
    },
    [refreshUser]
  );

  const logout = useCallback(async () => {
    await api.auth.logout();
    setState((s) => ({ ...s, user: null }));
  }, []);

  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null }));
  }, []);

  const value: AuthContextValue = {
    ...state,
    loginWithGoogle,
    loginWithApple,
    loginWithEmail,
    registerWithEmail,
    logout,
    refreshUser,
    clearError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
