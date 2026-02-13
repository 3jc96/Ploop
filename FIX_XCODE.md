# Fix Xcode Setup for iOS Simulator

## Current Issue

Xcode is not fully configured. The system is using Command Line Tools instead of full Xcode.

## Option 1: Use Expo Go App (EASIEST - Recommended!)

Skip Xcode setup entirely and use your phone:

1. **Install Expo Go** on your iPhone:
   - App Store: https://apps.apple.com/app/expo-go/id982107779
   - Or search "Expo Go" in App Store

2. **Make sure phone and computer are on same WiFi**

3. **Start the app**:
   ```bash
   cd mobile
   npm start
   ```

4. **Scan QR code** with:
   - iPhone Camera app (built-in scanner)
   - Or Expo Go app's scanner

✅ Works immediately, no Xcode setup needed!

## Option 2: Fix Xcode Setup (For Simulator)

If you want to use iOS Simulator:

1. **Install/Open Xcode**:
   - Open App Store
   - Search "Xcode"
   - Install if not installed (takes a while, ~15GB)
   - OR open if already installed

2. **Complete Xcode setup**:
   ```bash
   sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
   ```

3. **Accept license and run first launch**:
   ```bash
   sudo xcodebuild -license accept
   xcodebuild -runFirstLaunch
   ```

4. **Install iOS Simulator** (if needed):
   - Open Xcode
   - Xcode > Settings > Platforms
   - Install iOS Simulator

5. **Try again**:
   ```bash
   cd mobile
   ulimit -n 10240
   npm run ios
   ```

## Recommendation

**Use Expo Go on your phone** - it's faster, easier, and works immediately without any setup!


