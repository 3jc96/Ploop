/**
 * Catches Gaode/Amap native module errors (e.g. NATIVE_MODULE_UNAVAILABLE in Expo Go)
 * and falls back to rendering the Google Maps fallback instead of crashing.
 */
import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback: ReactNode;
  onFallback?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

function isGaodeModuleError(error: Error | null): boolean {
  if (!error) return false;
  const msg = (error?.message ?? '') + (error?.stack ?? '');
  // Catch any native module / Amap SDK error so the map always has a Google fallback.
  return (
    msg.includes('NATIVE_MODULE_UNAVAILABLE') ||
    msg.includes('高德地图错误') ||
    msg.includes('ExpoGaodeMap') ||
    msg.includes('AMapModule') ||
    msg.includes('expo-gaode-map') ||
    // Generic "null/undefined is not an object" from uninitialised native modules
    /null is not an object.*Expo/i.test(msg) ||
    /undefined is not an object.*Expo/i.test(msg) ||
    msg.includes('NativeModule') ||
    msg.includes('native module')
  );
}

export class AmapErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, _errorInfo: ErrorInfo): void {
    if (isGaodeModuleError(error)) {
      this.props.onFallback?.();
    }
    if (__DEV__) {
      console.warn('AmapErrorBoundary: Gaode module unavailable, falling back to Google Maps:', error?.message);
    }
  }

  render(): ReactNode {
    if (this.state.hasError && isGaodeModuleError(this.state.error)) {
      return this.props.fallback;
    }
    if (this.state.hasError) {
      throw this.state.error;
    }
    return this.props.children;
  }
}
