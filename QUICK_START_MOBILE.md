# Quick Start: Mobile App with Expo Go

## You're Already in the Right Directory! ✅

Since your terminal shows `mobile %`, you're already in `/Users/joelchu/quantum-webscraper/Ploop/mobile`

## Just Run:

```bash
npm start
```

## What Happens:

1. **Expo Metro Bundler starts**
   - Shows a QR code in your terminal
   - Shows "Metro waiting on..."

2. **Scan QR Code with Expo Go**:
   - **iPhone**: Open Camera app, point at QR code
   - **Android**: Open Expo Go app, tap "Scan QR code"

3. **Make Sure**:
   - ✅ Backend is running: `cd ../backend && npm run dev`
   - ✅ Phone and computer are on same WiFi
   - ✅ Expo Go app is installed on your phone

4. **App Loads on Your Phone!** 📱

## If You See Network Errors:

You may need to update the API URL for your computer's IP address (since phone can't use "localhost"):

1. Find your computer's IP:
   ```bash
   ifconfig | grep "inet " | grep -v 127.0.0.1
   ```
   (Look for something like `192.168.1.100`)

2. Update `src/config/api.ts`:
   Change `http://localhost:3000` to `http://YOUR_IP:3000`

3. Restart: `npm start`

## That's It!

Just run `npm start` and scan the QR code! 🚀


