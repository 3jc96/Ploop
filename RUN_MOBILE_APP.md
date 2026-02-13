# How to Run the Ploop Mobile App

## Quick Start

### Option 1: Using Expo (Recommended - Easiest)

1. **Make sure backend is running**:
   ```bash
   cd backend
   npm run dev
   ```
   (Keep this running in one terminal)

2. **Start the mobile app** (in a new terminal):
   ```bash
   cd mobile
   npm start
   ```

3. **Choose how to run**:
   - **Press `i`** for iOS Simulator (requires Xcode)
   - **Press `a`** for Android Emulator (requires Android Studio)
   - **Scan QR code** with Expo Go app on your phone (easiest!)

### Option 2: Using Expo Go App (Easiest for Testing)

1. **Install Expo Go** on your phone:
   - iOS: [App Store](https://apps.apple.com/app/expo-go/id982107779)
   - Android: [Google Play](https://play.google.com/store/apps/details?id=host.exp.exponent)

2. **Start the app**:
   ```bash
   cd mobile
   npm start
   ```

3. **Scan the QR code** that appears with:
   - **iOS**: Camera app (built-in scanner)
   - **Android**: Expo Go app (has built-in scanner)

4. **Make sure your phone and computer are on the same WiFi network**

### Option 3: iOS Simulator (macOS only)

```bash
cd mobile
npm run ios
```

**Requirements:**
- Xcode installed
- iOS Simulator available

### Option 4: Android Emulator

```bash
cd mobile
npm run android
```

**Requirements:**
- Android Studio installed
- Android emulator set up

## What You Should See

When the app loads:
1. **Map screen** with your current location
2. **"+ Add Toilet" button** in bottom right
3. Ability to add new toilets
4. View toilet details when you tap markers

## Troubleshooting

**"Cannot connect to backend"**
- Make sure backend is running on `http://localhost:3000`
- For physical device: You may need to use your computer's IP address instead of `localhost`
  - Update `mobile/src/config/api.ts` with your computer's IP (e.g., `http://192.168.1.100:3000`)

**"Metro bundler" errors**
- Clear cache: `npm start -- --reset-cache`

**"Location permission denied"**
- Grant location permissions when prompted
- Check phone settings if needed

**"Expo Go not connecting"**
- Make sure phone and computer are on same WiFi
- Try tunnel mode: `npm start -- --tunnel` (slower but works across networks)

## Next Steps After Running

1. Grant location permissions
2. See the map with your location
3. Tap "+ Add Toilet" to add your first toilet
4. Fill in the form and submit
5. See your toilet appear on the map!


