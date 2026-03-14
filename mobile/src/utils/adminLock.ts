/**
 * Admin screen lock: 4-digit PIN stored in SecureStore (native) or AsyncStorage (web).
 * Optional Face ID / Touch ID on native.
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ADMIN_PIN_KEY = 'ploop_admin_pin';

const isWeb = Platform.OS === 'web';

async function getStoredPin(): Promise<string | null> {
  if (isWeb) {
    return AsyncStorage.getItem(ADMIN_PIN_KEY);
  }
  return SecureStore.getItemAsync(ADMIN_PIN_KEY);
}

async function setStoredPin(pin: string): Promise<void> {
  if (isWeb) {
    await AsyncStorage.setItem(ADMIN_PIN_KEY, pin);
  } else {
    await SecureStore.setItemAsync(ADMIN_PIN_KEY, pin);
  }
}

export async function hasAdminPin(): Promise<boolean> {
  try {
    const pin = await getStoredPin();
    return typeof pin === 'string' && pin.length === 4;
  } catch {
    return false;
  }
}

export async function setAdminPin(pin: string): Promise<void> {
  if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
    throw new Error('PIN must be 4 digits');
  }
  await setStoredPin(pin);
}

export async function verifyAdminPin(pin: string): Promise<boolean> {
  try {
    const stored = await getStoredPin();
    return stored === pin;
  } catch {
    return false;
  }
}

export async function isBiometricAvailable(): Promise<boolean> {
  if (isWeb) return false;
  try {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    return types.length > 0;
  } catch {
    return false;
  }
}

export async function authenticateWithBiometric(): Promise<boolean> {
  if (isWeb) return false;
  try {
    const ok = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock Admin',
      fallbackLabel: 'Use PIN',
    });
    return ok.success;
  } catch {
    return false;
  }
}
