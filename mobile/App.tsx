import React, { Suspense, useEffect } from 'react';
import { ActivityIndicator, View, AppState } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import * as SplashScreen from 'expo-splash-screen';

SplashScreen.preventAutoHideAsync().catch(() => {});
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as WebBrowser from 'expo-web-browser';
import { initGoogleSignIn } from './src/utils/initGoogleSignIn';
import { AppErrorBoundary } from './src/AppErrorBoundary';

initGoogleSignIn();
import { AppLoadingGate } from './src/components/AppLoadingGate';
import { SplashSoundGate } from './src/components/SplashSoundGate';
import { AuthProvider } from './src/context/AuthContext';
import { LanguageProvider } from './src/context/LanguageContext';
import { MapProvider } from './src/context/MapProviderContext';
import { WebAuthRedirectHandler } from './src/WebAuthRedirectHandler';

import HuntModal from './src/components/HuntModal';
import { OnboardingModal } from './src/components/OnboardingModal';
import LoginScreenWrapper from './src/screens/LoginScreenWrapper';
import RedirectScreen from './src/screens/RedirectScreen';
import PoopGameEntry from './src/screens/PoopGameEntry';
// Lazy-load other screens so the app entry registers before loading heavy deps.
const MapScreen = React.lazy(() => import('./src/screens/MapScreenWrapper'));
const ToiletDetailsScreen = React.lazy(() => import('./src/screens/ToiletDetailsScreen'));
const AddToiletScreen = React.lazy(() => import('./src/screens/AddToiletScreen'));
const LocationReviewScreen = React.lazy(() => import('./src/screens/LocationReviewScreen'));
const AdminScreen = React.lazy(() => import('./src/screens/AdminScreen'));

const Stack = createStackNavigator();

const linking = {
  prefixes: [
    'http://localhost:8081',
    'http://127.0.0.1:8081',
    'ploop://',
  ],
  config: {
    screens: {
      Map: '',
      Login: 'login',
      Redirect: 'redirect',
      Admin: 'admin',
      PoopGame: 'game',
      ToiletDetails: 'toilet/:id',
      AddToilet: 'add',
      EditToilet: 'edit/:id',
      LocationReview: 'review',
    },
  },
};

function ScreenFallback() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" />
    </View>
  );
}

function withSuspense<P extends object>(LazyComponent: React.LazyExoticComponent<React.ComponentType<P>>) {
  return function Wrapped(props: P) {
    return (
      <Suspense fallback={<ScreenFallback />}>
        <LazyComponent {...props} />
      </Suspense>
    );
  };
}

export default function App() {
  useEffect(() => {
    requestAnimationFrame(() => {
      SplashScreen.hideAsync().catch(() => {});
    });
  }, []);

  // Complete the auth session when the app receives the redirect from Google (closes the browser and returns the result to promptAsync).
  useEffect(() => {
    const completeAuth = () => {
      try {
        WebBrowser.maybeCompleteAuthSession();
      } catch {
        // ignore if WebBrowser not available
      }
    };
    completeAuth();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') completeAuth();
    });
    return () => sub.remove();
  }, []);

  return (
    <AppErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <SplashSoundGate>
          <LanguageProvider>
          <MapProvider>
          <AppLoadingGate>
          <AuthProvider>
          <WebAuthRedirectHandler />
          <HuntModal />
          <OnboardingModal />
          <NavigationContainer linking={linking}>
            <Stack.Navigator
              initialRouteName="Map"
              screenOptions={{
                cardStyle: { flex: 1 },
              }}
            >
              <Stack.Screen
                name="Login"
                component={LoginScreenWrapper}
                options={{ title: 'Account', headerShown: false }}
              />
              <Stack.Screen
                name="Redirect"
                component={RedirectScreen}
                options={{ title: 'Sign-in', headerShown: false }}
              />
              <Stack.Screen
                name="Map"
                component={withSuspense(MapScreen)}
                options={{ title: 'Ploop - Find Toilets', headerShown: false }}
              />
              <Stack.Screen
                name="ToiletDetails"
                component={withSuspense(ToiletDetailsScreen)}
                options={{ title: 'Toilet Details' }}
              />
              <Stack.Screen
                name="AddToilet"
                component={withSuspense(AddToiletScreen)}
                options={{ title: 'Add New Toilet' }}
              />
              <Stack.Screen
                name="EditToilet"
                component={withSuspense(AddToiletScreen)}
                options={{ title: 'Edit Toilet' }}
              />
              <Stack.Screen
                name="LocationReview"
                component={withSuspense(LocationReviewScreen)}
                options={{ title: 'Review Location' }}
              />
              <Stack.Screen
                name="Admin"
                component={withSuspense(AdminScreen)}
                options={{ title: 'Admin' }}
              />
              <Stack.Screen
                name="PoopGame"
                component={PoopGameEntry}
                options={{ title: 'Catch the Poop' }}
              />
            </Stack.Navigator>
          </NavigationContainer>
          </AuthProvider>
          </AppLoadingGate>
          </MapProvider>
          </LanguageProvider>
          </SplashSoundGate>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </AppErrorBoundary>
  );
}

