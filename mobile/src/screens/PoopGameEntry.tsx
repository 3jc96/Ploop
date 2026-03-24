/**
 * Gate for PoopGame: the game bundle loads only after the user is signed in.
 * Guests who open this route are sent to Login with returnTo PoopGame.
 */
import React, { Suspense, useEffect } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';

const PoopGameScreen = React.lazy(() => import('./PoopGameScreen'));

function Fallback() {
  return (
    <View style={styles.centered}>
      <ActivityIndicator size="large" />
    </View>
  );
}

export default function PoopGameEntry() {
  const { user, loading } = useAuth();
  const navigation = useNavigation();

  useEffect(() => {
    if (!loading && !user) {
      (navigation as any).replace('Login', { returnTo: 'PoopGame' });
    }
  }, [loading, user, navigation]);

  if (loading) return <Fallback />;
  if (!user) return <Fallback />;

  return (
    <Suspense fallback={<Fallback />}>
      <PoopGameScreen />
    </Suspense>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
