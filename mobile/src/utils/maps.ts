/**
 * Open a location in Google Maps, Apple Maps, or Amap (Gaode) for China.
 * Shows an action sheet / alert so the user can choose.
 */
import { Alert, Linking, Platform, ActionSheetIOS } from 'react-native';
import { isInChina } from '../context/MapProviderContext';

export function openInMapsWithChoice(
  latitude: number,
  longitude: number,
  title?: string,
  options?: { userInChina?: boolean }
): void {
  const label = title || 'Destination';
  const inChina = options?.userInChina ?? isInChina(latitude, longitude);
  const googleUrl = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
  const appleUrl = `https://maps.apple.com/?daddr=${latitude},${longitude}`;
  const amapUrl = `https://uri.amap.com/navigation?to=${longitude},${latitude},${encodeURIComponent(label || 'Destination')}&dev=1`;

  const openGoogle = () => Linking.openURL(googleUrl);
  const openApple = () => Linking.openURL(appleUrl);
  const openAmap = () => Linking.openURL(amapUrl);

  if (inChina) {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: `Open ${label} in`,
          options: ['Cancel', 'Amap (高德地图)', 'Apple Maps'],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) openAmap();
          else if (buttonIndex === 2) openApple();
        }
      );
    } else {
      Alert.alert(
        `Open ${label} in`,
        undefined,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Amap (高德地图)', onPress: openAmap },
          { text: 'Apple Maps', onPress: openApple },
        ]
      );
    }
  } else {
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
}
