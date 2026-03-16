/**
 * Plays the startup "ploop" sound when the app is ready.
 * Respects the user's settings.ploopSoundEnabled preference.
 */
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';

let playedThisSession = false;

/**
 * Plays the ploop sound and returns a Promise that resolves when playback finishes.
 * Resolves immediately if sound is disabled. Use before showing the main app.
 */
export async function playPloopSoundAndWait(): Promise<void> {
  if (playedThisSession) return;
  try {
    const v = await AsyncStorage.getItem('settings.ploopSoundEnabled');
    if (v === 'false') return;
    playedThisSession = true;
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
    const { sound } = await Audio.Sound.createAsync(
      require('../../assets/ploop.wav'),
      { shouldPlay: true }
    );
    await new Promise<void>((resolve) => {
      let resolved = false;
      const done = () => {
        if (resolved) return;
        resolved = true;
        resolve();
      };
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync().catch(() => {});
          done();
        }
      });
      setTimeout(done, 2000);
    });
  } catch {
    // Silent fail - don't block app if sound fails
  }
}

export async function playPloopSoundIfEnabled(): Promise<void> {
  if (playedThisSession) return;
  try {
    const v = await AsyncStorage.getItem('settings.ploopSoundEnabled');
    if (v === 'false') return;
    playedThisSession = true;
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
    const { sound } = await Audio.Sound.createAsync(
      require('../../assets/ploop.wav'),
      { shouldPlay: true }
    );
    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) {
        sound.unloadAsync().catch(() => {});
      }
    });
  } catch {
    // Silent fail - don't block app if sound fails
  }
}
