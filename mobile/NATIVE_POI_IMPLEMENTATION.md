# Native POI Click Implementation Guide

## Overview
This document outlines the implementation of native Google Maps SDK integration to enable true POI (Point of Interest) click events, matching the responsiveness and accuracy of the native Google Maps app.

## Architecture

### Current Limitation
- `react-native-maps` doesn't expose Google Maps' native POI click events
- We only get map coordinate taps, requiring API lookups

### Solution
- Create custom native modules for iOS and Android
- Directly integrate Google Maps SDK POI click handlers
- Bridge POI click events to React Native JavaScript layer

## Implementation Steps

### 1. Prerequisites
```bash
# Install Expo CLI and EAS CLI
npm install -g expo-cli eas-cli

# Generate native directories (if not already done)
cd mobile
npx expo prebuild
```

### 2. iOS Implementation

#### 2.1 Install Google Maps SDK for iOS
Add to `ios/Podfile`:
```ruby
pod 'GoogleMaps'
pod 'Google-Maps-iOS-Utils'
```

#### 2.2 Create Native Module
File: `ios/PloopMaps/PoiClickManager.swift`
- Subclass `RCTViewManager`
- Implement `GMSMapViewDelegate` methods
- Handle `mapView(_:didTapPOIWithPlaceID:name:location:)` delegate method
- Send events to React Native via `RCTEventEmitter`

#### 2.3 Bridge Configuration
File: `ios/PloopMaps/PoiClickManager.m`
- Objective-C bridge header
- Export module to React Native

### 3. Android Implementation

#### 3.1 Add Google Maps SDK
Add to `android/app/build.gradle`:
```gradle
dependencies {
    implementation 'com.google.android.gms:play-services-maps:18.2.0'
}
```

#### 3.2 Create Native Module
File: `android/app/src/main/java/com/ploop/app/PoiClickModule.java`
- Extend `ReactContextBaseJavaModule`
- Implement `OnPoiClickListener`
- Handle POI click events
- Send events via `RCTDeviceEventEmitter`

### 4. React Native Bridge

#### 4.1 TypeScript Types
File: `src/native/PoiClickTypes.ts`
```typescript
export interface PoiClickEvent {
  placeId: string;
  name: string;
  latitude: number;
  longitude: number;
  address?: string;
}
```

#### 4.2 Native Module Wrapper
File: `src/native/PoiClickManager.ts`
- Import native module
- Set up event listeners
- Provide clean API for components

### 5. Integration with MapScreen

Update `MapScreen.tsx` to:
- Use native POI click events instead of coordinate taps
- Fallback to coordinate-based lookup if native events unavailable
- Maintain backward compatibility

## Benefits

1. **True POI Detection**: Know exactly which POI was clicked
2. **Instant Response**: No API lookup delay
3. **Better Accuracy**: 100% match with user intent
4. **Native Performance**: Direct SDK integration

## Testing

1. Test on physical iOS device (POI clicks require real device)
2. Test on Android emulator and device
3. Verify fallback behavior when native module unavailable
4. Test with various POI types (restaurants, cafes, shops, etc.)

## Deployment

1. Build development build: `eas build --profile development --platform ios`
2. Build development build: `eas build --profile development --platform android`
3. Test thoroughly before production release

## Notes

- Native modules require Expo development builds (not Expo Go)
- Google Maps API key must be configured in native projects
- iOS requires CocoaPods setup
- Android requires Gradle configuration


