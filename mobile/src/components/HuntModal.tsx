/**
 * HuntModal — Golden Toilet Hunt popup.
 *
 * Shows:
 *   • 1–3 days before the hunt: countdown + instructions
 *   • During the hunt (5th–26th): golden toilets remaining in the user's city
 *
 * Shown once per calendar day (persisted via AsyncStorage).
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import { api } from '../services/api';

const SHOWN_KEY = '@ploop/hunt_modal_shown_date';
const COUNTDOWN_SHOW_DAYS = 3; // Show popup this many days before hunt starts

// Approximate city centres for nearest-city detection (degrees lat/lng)
const CITY_CENTRES: { name: string; lat: number; lng: number }[] = [
  { name: 'Singapore',    lat: 1.35,   lng: 103.82 },
  { name: 'Tokyo',        lat: 35.68,  lng: 139.69 },
  { name: 'Seoul',        lat: 37.57,  lng: 126.98 },
  { name: 'Hong Kong',    lat: 22.32,  lng: 114.18 },
  { name: 'Bangkok',      lat: 13.75,  lng: 100.52 },
  { name: 'Dubai',        lat: 25.20,  lng: 55.27  },
  { name: 'Kuala Lumpur', lat: 3.14,   lng: 101.69 },
  { name: 'Jakarta',      lat: -6.21,  lng: 106.85 },
  { name: 'Sydney',       lat: -33.87, lng: 151.21 },
  { name: 'New York',     lat: 40.71,  lng: -74.01 },
  { name: 'Los Angeles',  lat: 34.05,  lng: -118.24 },
  { name: 'San Francisco',lat: 37.77,  lng: -122.42 },
  { name: 'Chicago',      lat: 41.88,  lng: -87.63 },
  { name: 'London',       lat: 51.51,  lng: -0.13  },
  { name: 'Paris',        lat: 48.86,  lng: 2.35   },
  { name: 'Berlin',       lat: 52.52,  lng: 13.40  },
  { name: 'Amsterdam',    lat: 52.37,  lng: 4.90   },
];

function nearestCity(lat: number, lng: number): string | null {
  let best: string | null = null;
  let minDist = Infinity;
  for (const c of CITY_CENTRES) {
    const d = Math.abs(c.lat - lat) + Math.abs(c.lng - lng);
    if (d < minDist) { minDist = d; best = c.name; }
  }
  return minDist < 2 ? best : null; // ~200 km threshold
}

async function registerPushToken(): Promise<void> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    let finalStatus = status;
    if (status !== 'granted') {
      const { status: asked } = await Notifications.requestPermissionsAsync();
      finalStatus = asked;
    }
    if (finalStatus !== 'granted') return;
    const tokenData = await Notifications.getExpoPushTokenAsync();
    await api.hunt.registerPushToken(tokenData.data);
  } catch {
    // Push registration is best-effort
  }
}

async function shouldShowToday(): Promise<boolean> {
  try {
    const stored = await AsyncStorage.getItem(SHOWN_KEY);
    const today = new Date().toISOString().slice(0, 10);
    return stored !== today;
  } catch {
    return true;
  }
}

async function markShownToday(): Promise<void> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    await AsyncStorage.setItem(SHOWN_KEY, today);
  } catch {}
}

export default function HuntModal() {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const checked = useRef(false);

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;

    (async () => {
      // Register push token on every app open (token can change)
      registerPushToken().catch(() => {});

      if (!(await shouldShowToday())) return;

      try {
        const status = await api.hunt.getStatus();

        // During active hunt — show remaining in user's city
        if (status.active && status.goldenToiletsRemaining) {
          const remaining = status.goldenToiletsRemaining;
          const totalRemaining = Object.values(remaining).reduce((a, b) => a + b, 0);
          if (totalRemaining === 0) return; // All found — no modal

          let cityLine = '';
          try {
            const loc = await Location.getLastKnownPositionAsync();
            if (loc) {
              const city = nearestCity(loc.coords.latitude, loc.coords.longitude);
              if (city && remaining[city] !== undefined) {
                cityLine = `\n\n${remaining[city]} golden toilet${remaining[city] === 1 ? '' : 's'} still hidden in ${city}.`;
              }
            }
          } catch {}

          if (!cityLine) {
            cityLine = `\n\n${totalRemaining} golden toilet${totalRemaining === 1 ? '' : 's'} still hidden across all cities.`;
          }

          setTitle('🚽🏆 Golden Toilet Hunt is ON!');
          setBody(`Find hidden golden toilets to win a $10 voucher. Max 2 check-ins per day.${cityLine}`);
          await markShownToday();
          setVisible(true);
          return;
        }

        // Pre-hunt countdown (1–3 days before)
        const days = status.daysUntilStart;
        if (days !== null && days >= 1 && days <= COUNTDOWN_SHOW_DAYS) {
          const startDate = status.startsAt
            ? new Date(status.startsAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
            : 'soon';
          setTitle(`🚽 Golden Toilet Hunt in ${days} day${days === 1 ? '' : 's'}!`);
          setBody(
            `The hunt begins ${startDate}.\n\n` +
            `3 golden toilets are hidden in each city. Find them and check in to win a $10 voucher!\n\n` +
            `• Hunt runs 3 weeks\n` +
            `• Max 2 golden check-ins per day\n` +
            `• First to find gets bragging rights!`
          );
          await markShownToday();
          setVisible(true);
        }
      } catch {
        // Silently fail — hunt status is non-critical
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (!visible || loading) return null;

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={() => setVisible(false)}>
      <Pressable style={styles.backdrop} onPress={() => setVisible(false)} />
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        <Pressable style={styles.button} onPress={() => setVisible(false)}>
          <Text style={styles.buttonText}>Got it!</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  card: {
    position: 'absolute',
    top: '25%',
    left: 24,
    right: 24,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 12,
    textAlign: 'center',
  },
  body: {
    fontSize: 15,
    color: '#444',
    lineHeight: 22,
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#FFD700',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
  },
});
