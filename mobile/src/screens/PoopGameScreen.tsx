/**
 * Poop Game – Catch falling poop with a toilet. Speed increases as you catch more.
 * Game over after 3 missed poops. Global leaderboard. Prompts toilet review by location.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  PanResponder,
  ActivityIndicator,
  Alert,
  ScrollView,
  TextInput,
  Platform,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as Location from 'expo-location';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { hapticSuccess } from '../utils/engagement';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GAME_WIDTH = Math.min(SCREEN_WIDTH - 32, 360);
const GAME_HEIGHT = 480;

const TOILET_WIDTH = 80;

/** Strip email from display_name (e.g. "Joel (a@b.com)" → "Joel") for scoreboard privacy. */
function displayNameForScoreboard(name: string | null | undefined): string {
  const n = (name || '').trim();
  if (!n) return 'Anonymous';
  const parenIdx = n.indexOf(' (');
  if (parenIdx > 0 && n.endsWith(')')) return n.slice(0, parenIdx).trim();
  return n;
}
const TOILET_HEIGHT = 50;
const POOP_SIZE = 28;
const BASE_FALL_SPEED = 4;
const SPEED_INCREMENT = 0.2;
const SPAWN_INTERVAL_BASE_MS = 600;
const SPAWN_INTERVAL_MIN_MS = 350;
const SPAWN_INTERVAL_DECREASE_PER_SCORE = 20;
const MAX_MISSES = 3;
const TOILET_TOP = GAME_HEIGHT - TOILET_HEIGHT - 20;

type GameState = 'idle' | 'playing' | 'gameover';

interface PoopItem {
  id: number;
  x: number;
  y: number;
}

export default function PoopGameScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { user } = useAuth();
  const [gameState, setGameState] = useState<GameState>('idle');
  const [score, setScore] = useState(0);
  const [misses, setMisses] = useState(0);
  const [poops, setPoops] = useState<PoopItem[]>([]);
  const [toiletX, setToiletX] = useState(GAME_WIDTH / 2 - TOILET_WIDTH / 2);
  const [leaderboard, setLeaderboard] = useState<Array<{ score: number; display_name: string }>>([]);
  const [submitting, setSubmitting] = useState(false);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);
  const [scoreName, setScoreName] = useState('');
  const [scoreSubmitted, setScoreSubmitted] = useState(false);
  const pendingScoreRef = useRef<number | null>(null);

  const poopIdCounter = useRef(0);
  const fallSpeed = useRef(BASE_FALL_SPEED);
  const gameLoopRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const spawnTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toiletStartX = useRef(0);
  const scoreRef = useRef(0);
  const missesRef = useRef(0);
  scoreRef.current = score;
  missesRef.current = misses;

  const loadLeaderboard = useCallback(async () => {
    try {
      setLoadingLeaderboard(true);
      const { scores } = await api.getPoopGameLeaderboard(20);
      setLeaderboard(scores || []);
    } catch {
      setLeaderboard([]);
    } finally {
      setLoadingLeaderboard(false);
    }
  }, []);

  useEffect(() => {
    loadLeaderboard();
  }, [loadLeaderboard]);

  const pendingScore = (route.params as any)?.pendingScore as number | undefined;
  useEffect(() => {
    if (user && typeof pendingScore === 'number' && pendingScore >= 0) {
      submitScore(pendingScore, user.display_name || 'Anonymous');
      (navigation as any).setParams({ pendingScore: undefined });
    }
  }, [user, pendingScore, submitScore, navigation]);

  const startGame = useCallback(() => {
    gameOverRef.current = false;
    setGameState('playing');
    setScore(0);
    setMisses(0);
    setPoops([]);
    fallSpeed.current = BASE_FALL_SPEED;
  }, []);

  const gameOverRef = useRef(false);
  const lastGameScoreRef = useRef<number>(0);

  const submitScore = useCallback(async (finalScore: number, displayName?: string) => {
    try {
      setSubmitting(true);
      await api.submitPoopGameScore(finalScore, displayName);
      hapticSuccess();
      setScoreSubmitted(true);
      loadLeaderboard();
    } catch (e: any) {
      if (__DEV__) console.error('[PoopGame] Failed to submit score:', e?.response?.data || e?.message);
      const msg = e?.response?.data?.error || e?.response?.status === 409
        ? (e?.response?.data?.error ?? 'That name is already on the leaderboard. Choose a different name.')
        : 'Your score was ' + finalScore + '. Enter your name below or sign in to save it.';
      Alert.alert(
        e?.response?.status === 409 ? 'Name already taken' : 'Could not reach server to record the score',
        msg
      );
    } finally {
      setSubmitting(false);
    }
  }, [loadLeaderboard]);

  const endGame = useCallback((finalScore: number) => {
    if (gameOverRef.current) return;
    gameOverRef.current = true;
    lastGameScoreRef.current = finalScore;
    setGameState('gameover');
    setScoreSubmitted(false);
    if (spawnTimeoutRef.current) {
      clearTimeout(spawnTimeoutRef.current);
      spawnTimeoutRef.current = null;
    }
    if (gameLoopRef.current) {
      cancelAnimationFrame(gameLoopRef.current);
      gameLoopRef.current = null;
    }

    if (user) {
      submitScore(finalScore, user.display_name || 'Anonymous');
    }
  }, [user, submitScore]);

  const promptReviewByLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location needed', 'Enable location to review a toilet near you.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = loc.coords;
      const { toilets } = await api.getNearbyToilets({
        latitude,
        longitude,
        radius: 500,
        limit: 1,
      });
      const nearest = toilets?.[0];
      if (nearest) {
        (navigation as any).navigate('LocationReview', {
          latitude: nearest.latitude,
          longitude: nearest.longitude,
          placeName: nearest.name,
          placeAddress: nearest.address,
          placeId: nearest.google_place_id,
        });
      } else {
        (navigation as any).navigate('LocationReview', {
          latitude,
          longitude,
        });
      }
    } catch (e) {
      Alert.alert('Error', 'Could not find a toilet near you. Try again later.');
    }
  }, [navigation]);

  const toiletXRef = useRef(toiletX);
  toiletXRef.current = toiletX;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        toiletStartX.current = toiletXRef.current;
      },
      onPanResponderMove: (_, gestureState) => {
        let x = toiletStartX.current + gestureState.dx;
        x = Math.max(0, Math.min(GAME_WIDTH - TOILET_WIDTH, x));
        setToiletX(x);
      },
    })
  ).current;

  // Game loop
  useEffect(() => {
    if (gameState !== 'playing') return;

    const scheduleNextSpawn = () => {
      const s = scoreRef.current;
      const delay = Math.max(
        SPAWN_INTERVAL_MIN_MS,
        SPAWN_INTERVAL_BASE_MS - s * SPAWN_INTERVAL_DECREASE_PER_SCORE
      );
      spawnTimeoutRef.current = setTimeout(() => {
        const x = Math.random() * (GAME_WIDTH - POOP_SIZE);
        setPoops((prev) => [...prev, { id: poopIdCounter.current++, x, y: 0 }]);
        scheduleNextSpawn();
      }, delay);
    };

    const x = Math.random() * (GAME_WIDTH - POOP_SIZE);
    setPoops((prev) => [...prev, { id: poopIdCounter.current++, x, y: 0 }]);
    scheduleNextSpawn();

    const loop = () => {
      const tx = toiletXRef.current;
      setPoops((prev) => {
        const nextPoops: PoopItem[] = [];
        let newScore = 0;
        let newMisses = 0;

        for (const p of prev) {
          const newY = p.y + fallSpeed.current;
          if (newY + POOP_SIZE < TOILET_TOP) {
            nextPoops.push({ ...p, y: newY });
          } else if (newY <= GAME_HEIGHT) {
            const poopCenterX = p.x + POOP_SIZE / 2;
            const caught = poopCenterX >= tx && poopCenterX <= tx + TOILET_WIDTH;
            if (caught) {
              newScore++;
              fallSpeed.current = BASE_FALL_SPEED + (scoreRef.current + newScore) * SPEED_INCREMENT;
            } else {
              newMisses++;
            }
          } else {
            newMisses++;
          }
        }

        if (newScore > 0) setScore((s) => s + newScore);
        if (newMisses > 0) {
          setMisses((m) => {
            const next = m + newMisses;
            if (next >= MAX_MISSES) {
              endGame(scoreRef.current + newScore);
            }
            return next;
          });
        }
        return nextPoops;
      });

      gameLoopRef.current = requestAnimationFrame(loop);
    };

    gameLoopRef.current = requestAnimationFrame(loop);
    return () => {
      if (spawnTimeoutRef.current) clearTimeout(spawnTimeoutRef.current);
      if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
    };
  }, [gameState, endGame]);

  if (gameState === 'idle') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>💩 Catch the Poop</Text>
        <Text style={styles.subtitle}>Drag the toilet to catch falling poop. Don't miss 3!</Text>
        <TouchableOpacity style={styles.playBtn} onPress={startGame}>
          <Text style={styles.playBtnText}>Play</Text>
        </TouchableOpacity>
        <View style={styles.leaderboardSection}>
          <Text style={styles.leaderboardTitle}>Top scores</Text>
          {loadingLeaderboard ? (
            <ActivityIndicator size="small" />
          ) : (
            <ScrollView style={styles.leaderboardList}>
              {leaderboard.slice(0, 5).map((s, i) => (
                <View key={i} style={styles.leaderboardRow}>
                  <Text style={styles.rank}>#{i + 1}</Text>
                  <Text style={styles.leaderboardName}>{displayNameForScoreboard(s.display_name)}</Text>
                  <Text style={styles.leaderboardScore}>{s.score}</Text>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    );
  }

  if (gameState === 'playing') {
    return (
      <View style={styles.container}>
        <View style={styles.hud}>
          <Text style={styles.hudText}>Score: {score}</Text>
          <Text style={styles.hudText}>Misses: {misses}/{MAX_MISSES}</Text>
        </View>
        <View style={[styles.gameArea, { width: GAME_WIDTH, height: GAME_HEIGHT }]}>
          {poops.map((p) => (
            <View
              key={p.id}
              style={[
                styles.poop,
                {
                  left: p.x,
                  top: p.y,
                  width: POOP_SIZE,
                  height: POOP_SIZE,
                },
              ]}
            >
              <Text style={styles.poopEmoji}>💩</Text>
            </View>
          ))}
          <View
            {...panResponder.panHandlers}
            style={[
              styles.toilet,
              {
                left: toiletX,
                bottom: 20,
                width: TOILET_WIDTH,
                height: TOILET_HEIGHT,
              },
            ]}
          >
            <Text style={styles.toiletEmoji}>🚽</Text>
          </View>
        </View>
      </View>
    );
  }

  const finalScore = lastGameScoreRef.current || score;
  const handleSaveWithName = () => {
    const name = scoreName.trim() || 'Anonymous';
    submitScore(finalScore, name.slice(0, 128));
  };

  // Game over
  return (
    <View style={styles.container}>
      <Text style={styles.gameOverTitle}>Game Over!</Text>
      <Text style={styles.finalScore}>Score: {finalScore}</Text>
      {submitting && <ActivityIndicator size="small" style={{ marginVertical: 8 }} />}
      {scoreSubmitted && <Text style={styles.scoreSavedText}>Score recorded!</Text>}
      {!scoreSubmitted && (
        <View style={styles.scoreForm}>
          <Text style={styles.scoreFormTitle}>Save your score</Text>
          <TextInput
            style={styles.scoreInput}
            placeholder="Name"
            value={scoreName}
            onChangeText={setScoreName}
            autoCapitalize="words"
          />
          <TouchableOpacity
            style={[styles.playBtn, styles.saveScoreBtn]}
            onPress={handleSaveWithName}
            disabled={submitting}
          >
            <Text style={styles.playBtnText}>Save score</Text>
          </TouchableOpacity>
          <Text style={styles.orSignIn}>Or create an account to record scores:</Text>
          <TouchableOpacity
            style={[styles.playBtn, styles.signInBtn]}
            onPress={() => (navigation as any).navigate('Login', { returnTo: 'PoopGame', pendingScore: finalScore })}
          >
            <Text style={styles.playBtnText}>Sign in with Google, Apple, or Email</Text>
          </TouchableOpacity>
        </View>
      )}
      <TouchableOpacity style={styles.playBtn} onPress={startGame} disabled={submitting}>
        <Text style={styles.playBtnText}>Play Again</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.playBtn, styles.reviewBtn]}
        onPress={promptReviewByLocation}
      >
        <Text style={styles.playBtnText}>Review a toilet near me</Text>
      </TouchableOpacity>
      <View style={styles.leaderboardSection}>
        <Text style={styles.leaderboardTitle}>Top scores</Text>
        {loadingLeaderboard ? (
          <ActivityIndicator size="small" />
        ) : (
          <ScrollView style={styles.leaderboardList}>
            {leaderboard.slice(0, 5).map((s, i) => (
              <View key={i} style={styles.leaderboardRow}>
                <Text style={styles.rank}>#{i + 1}</Text>
                <Text style={styles.leaderboardName}>{displayNameForScoreboard(s.display_name)}</Text>
                <Text style={styles.leaderboardScore}>{s.score}</Text>
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f4f8',
    padding: 16,
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#333',
    marginTop: 24,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
  },
  playBtn: {
    backgroundColor: '#6366f1',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    marginBottom: 24,
  },
  playBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  reviewBtn: {
    backgroundColor: '#10b981',
    marginBottom: 24,
  },
  scoreSavedText: {
    fontSize: 16,
    color: '#10b981',
    fontWeight: '600',
    marginBottom: 16,
  },
  scoreForm: {
    width: '100%',
    maxWidth: 320,
    marginBottom: 24,
  },
  scoreFormTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  scoreInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 10,
    ...(Platform.OS === 'web' ? {} : {}),
  },
  saveScoreBtn: {
    marginTop: 4,
    marginBottom: 16,
  },
  orSignIn: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 8,
    textAlign: 'center',
  },
  signInBtn: {
    backgroundColor: '#6366f1',
  },
  hud: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: GAME_WIDTH,
    marginBottom: 8,
  },
  hudText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  gameArea: {
    backgroundColor: '#e2e8f0',
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  poop: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  poopEmoji: {
    fontSize: 24,
  },
  toilet: {
    position: 'absolute',
    backgroundColor: '#94a3b8',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toiletEmoji: {
    fontSize: 36,
  },
  gameOverTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#333',
    marginTop: 24,
    marginBottom: 8,
  },
  finalScore: {
    fontSize: 24,
    color: '#6366f1',
    fontWeight: '600',
    marginBottom: 24,
  },
  leaderboardSection: {
    width: '100%',
    maxWidth: 320,
    marginTop: 16,
  },
  leaderboardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  leaderboardList: {
    maxHeight: 200,
  },
  leaderboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  rank: {
    width: 36,
    fontSize: 14,
    color: '#64748b',
  },
  leaderboardName: {
    flex: 1,
    fontSize: 16,
    color: '#333',
  },
  leaderboardScore: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6366f1',
  },
});
