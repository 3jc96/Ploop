/**
 * Open a location in Google Maps or Apple Maps.
 * Shows an action sheet / alert so the user can choose.
 */
import { Alert, Linking, Platform, ActionSheetIOS } from 'react-native';

export function openInMapsWithChoice(
  latitude: number,
  longitude: number,
  title?: string
): void {
  const label = title || 'Destination';
  const googleUrl = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
  const appleUrl = `https://maps.apple.com/?daddr=${latitude},${longitude}`;

  const openGoogle = () => Linking.openURL(googleUrl);
  const openApple = () => Linking.openURL(appleUrl);

  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: `Open ${label} in`,
        options: ['Cancel', 'Google Maps', 'Apple Maps'],
        cancelButtonIndex: 0,
      },
      (buttonIndex) => {
        if (buttonIndex === 1) openGoogle();
        else if (buttonIndex === 2) openApple();
      }
    );
  } else {
    // Android, web: use Alert (ActionSheet not available on these platforms)
    Alert.alert(
      `Open ${label} in`,
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Google Maps', onPress: openGoogle },
        { text: 'Apple Maps', onPress: openApple },
      ]
    );
  }
}
