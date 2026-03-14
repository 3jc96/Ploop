/**
 * Cross-platform alerts. React Native Alert.alert is a no-op on web,
 * so we use window.confirm/alert for web.
 */
import { Platform } from 'react-native';
import { Alert } from 'react-native';

const isWeb = Platform.OS === 'web';

/**
 * Show a confirmation dialog. On web uses window.confirm; on native uses Alert.alert.
 * Returns a promise that resolves to true if user confirmed, false if cancelled.
 */
export function confirmAsync(
  title: string,
  message: string,
  options?: { confirmText?: string; cancelText?: string }
): Promise<boolean> {
  const { confirmText = 'OK', cancelText = 'Cancel' } = options ?? {};
  if (isWeb) {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancelText, style: 'cancel', onPress: () => resolve(false) },
      { text: confirmText, onPress: () => resolve(true) },
    ]);
  });
}

/**
 * Show an alert. On web uses window.alert; on native uses Alert.alert.
 */
export function showAlert(title: string, message: string): void {
  if (isWeb) {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}
