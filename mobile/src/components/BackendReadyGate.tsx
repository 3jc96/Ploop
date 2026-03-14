/**
 * Blocks the app from rendering until the backend is reachable.
 * Prevents MapScreen and other screens from firing requests before Render has woken up.
 */
import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { api } from '../services/api';
import { getOxymoronicTagline } from '../utils/engagement';

const HEALTH_TIMEOUT_MS = 8000;
const PROGRESS_INTERVAL_MS = 150;
const PROGRESS_CAP = 95; // Stop at 95% until health succeeds

type Status = 'checking' | 'ready' | 'failed';

export function BackendReadyGate({ children }: { children: React.ReactNode }) {
  const [tagline] = useState(() => getOxymoronicTagline());
  const [status, setStatus] = useState<Status>('checking');
  const [attempts, setAttempts] = useState(0);
  const [progress, setProgress] = useState(0);
  const startTimeRef = useRef<number>(0);

  const runHealthCheck = async () => {
    setStatus('checking');
    setAttempts((a) => a + 1);
    setProgress(0);
    startTimeRef.current = Date.now();

    const ok = await api.checkHealth(HEALTH_TIMEOUT_MS);
    if (ok) {
      setProgress(100);
      setStatus('ready');
    } else {
      setStatus('failed');
    }
  };

  useEffect(() => {
    runHealthCheck();
  }, []);

  // Simulate progress over time (0 → 95% over timeout)
  useEffect(() => {
    if (status !== 'checking') return;
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const pct = Math.min(PROGRESS_CAP, Math.round((elapsed / HEALTH_TIMEOUT_MS) * PROGRESS_CAP));
      setProgress(pct);
    }, PROGRESS_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [status]);

  if (status === 'ready') {
    return <>{children}</>;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>🚽</Text>
      <Text style={styles.title}>Ploop</Text>
      {status === 'checking' ? (
        <>
          <Text style={styles.message}>
            {attempts > 1 ? `Connecting… (attempt ${attempts})` : 'Better than you think, closer than you thought!'}
          </Text>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${progress}%` }]} />
          </View>
          <Text style={styles.percent}>{progress}%</Text>
          <Text style={styles.hint}>{tagline}</Text>
        </>
      ) : (
        <>
          <Text style={styles.message}>Could not reach Ploop</Text>
          <Text style={styles.hint}>
            The server may still be starting. Tap below to try again.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
            onPress={runHealthCheck}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </Pressable>
        </>
      )}
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
  emoji: {
    fontSize: 48,
    marginBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
    marginBottom: 24,
  },
  message: {
    fontSize: 16,
    color: '#555',
    textAlign: 'center',
    marginBottom: 8,
  },
  barTrack: {
    width: 220,
    height: 8,
    backgroundColor: '#e2e8f0',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  barFill: {
    height: '100%',
    backgroundColor: '#2196F3',
    borderRadius: 4,
  },
  percent: {
    fontSize: 14,
    color: '#888',
    marginBottom: 12,
  },
  hint: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 24,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: '#2196F3',
    borderRadius: 8,
  },
  retryButtonPressed: {
    opacity: 0.8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
