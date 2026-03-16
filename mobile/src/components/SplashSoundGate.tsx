/**
 * Plays the ploop sound to completion before showing the app.
 * Keeps a splash view visible until the sound finishes.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { playPloopSoundAndWait } from '../utils/ploopSound';

export function SplashSoundGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    playPloopSoundAndWait().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (ready) {
    return <>{children}</>;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>🚽</Text>
      <Text style={styles.title}>Ploop</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  emoji: {
    fontSize: 48,
    marginBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
  },
});
