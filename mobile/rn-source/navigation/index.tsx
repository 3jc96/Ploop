/**
 * Ploop design navigation — bottom tab bar matching the prototype.
 * Map tab reuses the real, fully-functional MapScreen; the other tabs
 * are the new design screens wired to live data.
 *
 * This Tab navigator is registered as a screen inside the existing
 * stack in App.tsx, so pushed routes like ToiletDetailDesign / SOS
 * resolve against the parent stack.
 */
import React from 'react';
import { Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { colors } from '../theme';
import NearbyScreen from '../screens/NearbyScreen';
import TreasureScreen from '../screens/TreasureScreen';
import ProfileScreen from '../screens/ProfileScreen';

const MapScreen = React.lazy(() => import('../../src/screens/MapScreenWrapper'));

function MapTab(props: any) {
  return (
    <React.Suspense fallback={null}>
      <MapScreen {...props} />
    </React.Suspense>
  );
}

const Tab = createBottomTabNavigator();

function tabIcon(emoji: string) {
  return ({ color }: { color: string }) => (
    <Text style={{ fontSize: 22, color, opacity: color === colors.blue ? 1 : 0.7 }}>{emoji}</Text>
  );
}

export default function RootNavigation() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.blue,
        tabBarInactiveTintColor: colors.label2,
        tabBarStyle: { borderTopColor: colors.separator },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '500' },
      }}
    >
      <Tab.Screen
        name="MapTab"
        component={MapTab}
        options={{ title: 'Map', tabBarIcon: tabIcon('\ud83e\udded') }}
      />
      <Tab.Screen
        name="Nearby"
        component={NearbyScreen}
        options={{ title: 'Nearby', headerShown: true, tabBarIcon: tabIcon('\ud83d\udccb') }}
      />
      <Tab.Screen
        name="Treasure"
        component={TreasureScreen}
        options={{ title: 'Treasure Hunt', headerShown: true, tabBarIcon: tabIcon('\ud83c\udfc6') }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileScreen}
        options={{ title: 'Profile', headerShown: true, tabBarIcon: tabIcon('\ud83d\udc64') }}
      />
    </Tab.Navigator>
  );
}
