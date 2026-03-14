# Setup Guide: Native POI Click Implementation

## Overview
This guide will help you set up native Google Maps SDK integration for true POI click events.

## Prerequisites

1. **Expo Development Build**: Native modules require a development build (not Expo Go)
2. **Xcode** (for iOS) - macOS only
3. **Android Studio** (for Android)
4. **Google Maps API Key** - Already configured: `AIzaSyCLKBC2IeU1rQVSdhSZBCfDu984LcwiSXg`

## Step 1: Generate Native Directories

```bash
cd mobile
npx expo prebuild
```

This creates `ios/` and `android/` directories.

## Step 2: iOS Setup

### 2.1 Install Google Maps SDK

Add to `ios/Podfile`:
```ruby
pod 'GoogleMaps'
pod 'Google-Maps-iOS-Utils'
```

Then run:
```bash
cd ios
pod install
```

### 2.2 Configure API Key

Add to `ios/Ploop/Info.plist`:
```xml
<key>GMSApiKey</key>
<string>AIzaSyCLKBC2IeU1rQVSdhSZBCfDu984LcwiSXg</string>
```

### 2.3 Register Native Module

Add to `ios/Ploop/AppDelegate.mm` (or AppDelegate.swift):
```objc
#import "PoiClickManager.h"
```

## Step 3: Android Setup

### 3.1 Add Google Maps SDK

Add to `android/app/build.gradle`:
```gradle
dependencies {
    implementation 'com.google.android.gms:play-services-maps:18.2.0'
}
```

### 3.2 Configure API Key

Add to `android/app/src/main/AndroidManifest.xml`:
```xml
<application>
    <meta-data
        android:name="com.google.android.geo.API_KEY"
        android:value="AIzaSyCLKBC2IeU1rQVSdhSZBCfDu984LcwiSXg"/>
</application>
```

### 3.3 Register Native Module

Add to `android/app/src/main/java/com/ploop/app/MainApplication.java`:
```java
import com.ploop.app.PoiClickPackage;

// In getPackages():
packages.add(new PoiClickPackage());
```

## Step 4: Build Development Build

### iOS
```bash
eas build --profile development --platform ios
```

### Android
```bash
eas build --profile development --platform android
```

## Step 5: Test

1. Install the development build on your device
2. Open the app
3. Tap on POI icons on the map
4. You should see instant POI detection (no API delay)

## Troubleshooting

### iOS
- Ensure Google Maps SDK is properly installed via CocoaPods
- Check that API key is in Info.plist
- Verify native module is registered in AppDelegate

### Android
- Ensure Google Maps SDK is in build.gradle
- Check API key in AndroidManifest.xml
- Verify native module package is registered in MainApplication

## Notes

- Native modules only work in development/production builds, not Expo Go
- First build may take 10-15 minutes
- You'll need to rebuild when making native code changes
- The implementation includes fallback to coordinate-based detection if native module unavailable

## Next Steps

Once native modules are working:
1. Test POI clicks on various POI types
2. Verify instant response (no API delay)
3. Compare accuracy with previous implementation


