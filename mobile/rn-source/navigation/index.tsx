/**
 * Design navigation entry point.
 * Swap screens here once your full design package is copied into rn-source/.
 */
import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import ProfileScreen from '../screens/ProfileScreen';
import SOSScreen from '../screens/SOSScreen';

const Tab = createBottomTabNavigator();

function MapPlaceholder() {
  return null;
}

export default function RootNavigation() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: true }}>
      <Tab.Screen name="Map" component={MapPlaceholder} options={{ title: 'Map' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
      <Tab.Screen name="SOS" component={SOSScreen} options={{ title: 'SOS' }} />
    </Tab.Navigator>
  );
}
