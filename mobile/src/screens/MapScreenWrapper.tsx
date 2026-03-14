/**
 * Picks the real MapScreen or MapScreenFallback at load time so React.lazy
 * always receives a module with a valid default. In Expo Go, react-native-maps
 * throws (RNMapsAirModule); dynamic import() can still resolve with default: undefined.
 * Using require() in try/catch here guarantees we never export undefined.
 */
import React from 'react';

let MapComponent: React.ComponentType<any>;

try {
  const mod = require('./MapScreen');
  if (mod && typeof mod.default === 'function') {
    MapComponent = mod.default;
  } else {
    MapComponent = require('./MapScreenFallback').default;
  }
} catch {
  MapComponent = require('./MapScreenFallback').default;
}

export default function MapScreenWrapper(props: any) {
  return <MapComponent {...props} />;
}
