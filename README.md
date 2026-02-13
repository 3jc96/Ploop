# Ploop - Find Toilets When You Need Them 🚽

A mobile app that helps people find clean, accessible toilets with detailed information about amenities and conditions.

## Project Structure

```
Ploop/
├── mobile/          # React Native mobile app (iOS & Android)
├── backend/         # Node.js/Express API server
├── database/        # PostgreSQL schema and migrations
└── README.md
```

## Phase 1 Features

- **Cleanliness Score**: Rate toilets on cleanliness (1-5 scale)
- **Smell Score**: Rate smell quality (1-5 scale)
- **Amenities Tracking**:
  - Toilet paper availability
  - Bidet availability
  - Seat warmer
  - Hand soap
- **Physical Details**:
  - Number of stalls
  - Squat vs Sit toilets
  - Pay to enter
  - Wheelchair accessible
- **Location Tagging**: Users can add new toilets or update existing ones
- **Duplicate Prevention**: Smart detection to avoid duplicate entries

## Tech Stack

### Mobile App
- React Native
- React Navigation
- React Native Maps (Google Maps)
- React Native Image Picker

### Backend
- Node.js with Express
- TypeScript
- PostgreSQL with PostGIS (for location queries)
- Multer (for image uploads)

## Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL 14+ with PostGIS extension
- React Native development environment
- iOS: Xcode
- Android: Android Studio

### Quick start (one command)

From the **Ploop** directory (after `backend` and `mobile` have been set up once):

```bash
npm start
```

This starts the backend (port 8082) and the Expo app (port 8081) together. Use **http://localhost:8081** in a browser for the desktop app, or press `i` to open the iOS Simulator.

### Load the app on your phone

1. **Install Expo Go** on your phone: [App Store (iOS)](https://apps.apple.com/app/expo-go/id982107779) or [Play Store (Android)](https://play.google.com/store/apps/details?id=host.exp.exponent).
2. **Start the project** (from the `Ploop` folder):
   ```bash
   npm start
   ```
3. **Same Wi‑Fi as your computer:** In the terminal, Expo shows a **QR code**. Open **Expo Go** on your phone and:
   - **iOS:** Use the Camera app to scan the QR code, then tap the banner to open in Expo Go.
   - **Android:** In Expo Go, tap **“Scan QR code”** and scan the code from the terminal.
4. **Phone on a different network (e.g. mobile data):** Use tunnel mode so the phone can load the app:
   ```bash
   cd mobile && npx expo start --go --tunnel --port 8081
   ```
   Keep the backend running in another terminal (`cd backend && npm run dev`). Scan the tunnel QR code in Expo Go. **Note:** The app expects the API at the same host as the dev server; for tunnel + backend you may need the backend reachable at a public URL (e.g. deployed or ngrok on 8082) so the phone can call it.

**Tip:** Your phone and computer should be on the **same Wi‑Fi** so the app can reach the backend (your computer) at `http://<your-computer-ip>:8082`. On the iOS Simulator, the app uses your machine’s host (from Expo), so the backend must be running on the same machine; if you see “Network Error” when searching or loading toilets, ensure the backend is running (`npm start` or `npm run start:backend`).

### Backend Setup

```bash
cd backend
npm install
cp env.example .env
# Edit .env with your database credentials
npm run dev
```

### Mobile App Setup

```bash
cd mobile
npm install
# For iOS
cd ios && pod install && cd ..
npm run ios
# For Android
npm run android
```

## Database Setup

```bash
# Create database
createdb ploop

# Enable PostGIS
psql ploop -c "CREATE EXTENSION IF NOT EXISTS postgis;"

# Run migrations
cd database
psql ploop -f schema.sql
```

## API Endpoints

- `GET /api/toilets` - Get nearby toilets
- `POST /api/toilets` - Add new toilet
- `GET /api/toilets/:id` - Get toilet details
- `PUT /api/toilets/:id` - Update toilet
- `POST /api/toilets/check-duplicate` - Check for duplicates
- `POST /api/toilets/:id/photo` - Upload toilet photo

## Future Phases

### Phase 2
- Real-time stall occupancy
- Toilet paper SOS alerts
- Cleaning in progress notifications
- Subscription model
- Tips (capped at $1000)

### Phase 3
- Exit strategy: Sell to Google Maps

