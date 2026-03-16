/**
 * Plays a flush sound when a review is added.
 * Respects the user's settings.ploopSoundEnabled preference (same as ploop sound).
 */
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';

export async function playFlushSound(): Promise<void> {
  try {
    const v = await AsyncStorage.getItem('settings.ploopSoundEnabled');
    if (v === 'false') return;
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
    const { sound } = await Audio.Sound.createAsync(
      require('../../assets/flush.mov'),
      { shouldPlay: true }
    );
    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) {
        sound.unloadAsync().catch(() => {});
      }
    });
  } catch {
    // Silent fail - don't block if sound fails
  }
}
