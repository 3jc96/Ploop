# Mobile App Quick Start Guide

## ✅ Dependencies Installed

All mobile app dependencies are installed. You can now run the app!

## How to Run the App

### Easiest Option: Expo Go App on Your Phone 📱

1. **Install Expo Go** on your iPhone/Android:
   - iOS: https://apps.apple.com/app/expo-go/id982107779
   - Android: https://play.google.com/store/apps/details?id=host.exp.exponent

2. **Make sure backend is running** (in one terminal):
   ```bash
   cd backend
   npm run dev
   ```

3. **Start the mobile app** (in another terminal):
   ```bash
   cd mobile
   npm start
   ```

4. **Scan the QR code** with:
   - **iPhone**: Use the Camera app (built-in scanner)
   - **Android**: Open Expo Go app and tap "Scan QR code"

5. **Make sure your phone and computer are on the same WiFi network**

### Alternative: iOS Simulator (macOS with Xcode)

```bash
cd mobile
npm run ios
```

This will:
- Open iOS Simulator automatically
- Install and run the app
- Show you the app interface

### Alternative: Android Emulator

```bash
cd mobile
npm run android
```

**Note**: Requires Android Studio and an emulator set up first.

## What You'll See

When the app loads successfully:

1. **Map Screen** 📍
   - Shows your current location (if permissions granted)
   - Map with Google Maps integration
   - Empty at first (no toilets added yet)

2. **"+ Add Toilet" Button** ➕
   - Bottom right corner
   - Tap to add a new toilet

3. **Location Permission Prompt** 🔒
   - Grant location access when asked
   - Required to show your location and add toilets

## Testing the App

1. **Grant location permissions** when prompted
2. **See the map** with your current location
3. **Tap "+ Add Toilet"** to add your first toilet
4. **Fill in the form**:
   - Name (required)
   - Number of stalls
   - Amenities (toilet paper, soap, etc.)
   - Scores (optional)
5. **Submit** and see it appear on the map!

## Troubleshooting

### "Cannot connect to backend"
- Make sure backend is running: `cd backend && npm run dev`
- Check backend is accessible: `curl http://localhost:3000/health`
- For physical device: May need to use your computer's IP address (see below)

### "Network request failed" (Physical Device)
If using Expo Go on a physical device, update the API URL:

1. Find your computer's IP address:
   ```bash
   ifconfig | grep "inet " | grep -v 127.0.0.1
   ```
   (Look for something like `192.168.1.100`)

2. Update `mobile/src/config/api.ts`:
   ```typescript
   export const API_BASE_URL = __DEV__
     ? 'http://192.168.1.100:3000'  // Your computer's IP
     : 'https://your-api-domain.com';
   ```

3. Restart the app

### "Metro bundler" errors
```bash
cd mobile
npm start -- --reset-cache
```

### Location not working
- Grant location permissions when prompted
- Check Settings > Privacy > Location Services (iOS)
- Make sure location services are enabled

## Current Status

✅ Mobile app dependencies installed  
✅ Backend API running  
✅ Ready to test!

**Next step**: Run `npm start` in the mobile directory and choose how to view it!


