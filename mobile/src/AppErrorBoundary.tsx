import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    if (__DEV__) {
      console.error('AppErrorBoundary caught:', error, errorInfo);
    }
  }

  handleReload = (): void => {
    this.setState({ hasError: false, error: null });
    // Reload only on web. React Native (simulator/device) has no window.location;
    // accessing window.location.reload throws "Cannot read property 'reload' of undefined".
    try {
      const w = typeof globalThis !== 'undefined' ? (globalThis as any) : undefined;
      const location = w?.window?.location ?? w?.location;
      if (typeof location?.reload === 'function') {
        location.reload();
      }
    } catch {
      // ignore
    }
  };

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>
            {this.state.error.message || 'An unexpected error occurred.'}
          </Text>
          {__DEV__ && (
            <Text style={styles.stack} numberOfLines={8}>
              {this.state.error.stack}
            </Text>
          )}
          <Pressable
            onPress={this.handleReload}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          >
            <Text style={styles.buttonText}>Reload app</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#0B1020',
  },
  title: { fontSize: 20, fontWeight: '700', color: '#FFFFFF', marginBottom: 8 },
  message: { fontSize: 14, color: 'rgba(255,255,255,0.8)', textAlign: 'center', marginBottom: 16 },
  stack: { fontSize: 11, color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace', marginBottom: 16 },
  button: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10, backgroundColor: '#1A73E8' },
  buttonPressed: { opacity: 0.9 },
  buttonText: { color: '#FFFFFF', fontWeight: '700' },
});
