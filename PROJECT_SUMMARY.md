# Ploop Project Summary

## ✅ Phase 1 Implementation Complete

### Backend (Node.js/Express/TypeScript)
- ✅ RESTful API with all CRUD operations
- ✅ PostgreSQL database with PostGIS for location queries
- ✅ Duplicate detection algorithm (50m radius + name matching)
- ✅ Photo upload functionality
- ✅ Review system with automatic score calculation
- ✅ Input validation and error handling

### Mobile App (React Native/Expo)
- **Expo SDK 54** — compatible with **Expo Go 54** on your phone. Run `npm start` in `Ploop/mobile` and scan the QR code.
- ✅ Map view with Google Maps integration
- ✅ Location-based toilet discovery
- ✅ Add new toilet with all Phase 1 attributes
- ✅ Edit existing toilets
- ✅ View toilet details with scores and amenities
- ✅ Photo upload from device
- ✅ Review submission system
- ✅ Duplicate detection warnings

### User engagement (interactive & fun)
- ✅ **Start screen:** Tagline (“Never get caught short”), emoji, haptic feedback on buttons, “Sign in to save & edit your reviews” hint
- ✅ **Success messages:** Random fun copy on add-toilet and review (e.g. “You’re a hero!”, “Ploop approved!”) with haptics
- ✅ **Empty states:** List view shows “No toilets nearby yet” with CTA “Add the first toilet” when empty
- ✅ **Pull to refresh:** List (fallback) map screen supports pull-to-refresh for nearby toilets
- ✅ **Toilet not found:** Clear message + “Go back” button so users aren’t stuck
- ✅ **Haptics:** Light tap on primary actions (Start buttons, list item tap, Add toilet, favorite toggle where used)

### Desktop (Web) — http://localhost:8081
- ✅ Live map (Google Maps JS) with toilet markers; fallback to list if map unavailable
- ✅ List + search; **Details** opens toilet and **Add your review** (Cleanliness/Smell 1–5)
- ✅ Location fallback to San Francisco when permission denied; **Use my location** to retry
- ✅ Error boundary: uncaught errors show a message and **Reload app**
- ✅ Optional `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` in env; otherwise uses `app.json` extra

### Database Schema
- ✅ Toilets table with all Phase 1 fields
- ✅ Spatial indexing for fast location queries
- ✅ Photos table for multiple images per toilet
- ✅ Reviews table with automatic score aggregation
- ✅ Triggers for maintaining data consistency

## 📋 Phase 1 Features Implemented

### Core Features
1. **Cleanliness Score** - 1-5 scale, averaged from reviews
2. **Smell Score** - 1-5 scale, averaged from reviews
3. **Amenities Tracking**:
   - ✅ Toilet paper (y/n)
   - ✅ Bidet (y/n)
   - ✅ Seat warmer (y/n)
   - ✅ Hand soap (y/n)
4. **Physical Details**:
   - ✅ Number of stalls
   - ✅ Squat/Sit/Both type
   - ✅ Pay to enter (y/n)
   - ✅ Entry fee (optional amount)
   - ✅ Wheelchair accessible (y/n)
5. **Location Tagging** - Users can add new toilets
6. **Duplicate Prevention** - Smart detection prevents duplicates

## 🎯 Key Design Decisions

### Duplicate Detection Strategy
- **50-meter radius check**: Toilets within 50m are flagged
- **Name similarity**: Exact or substring matches trigger warnings
- **10-meter strict rule**: Anything within 10m is considered duplicate
- **User choice**: Users can view existing or add anyway

### Scoring System
- Individual reviews stored separately
- Automatic averaging via database triggers
- Scores update in real-time when new reviews added
- Supports partial reviews (only cleanliness or only smell)

### Architecture
- **Separation of concerns**: Backend API, mobile app, database
- **Type safety**: TypeScript throughout
- **Scalable**: PostGIS for efficient location queries
- **Extensible**: Ready for Phase 2 features (WebSockets, payments)

## 📁 Project Structure

```
Ploop/
├── backend/              # Node.js/Express API
│   ├── src/
│   │   ├── config/      # Database configuration
│   │   ├── routes/      # API routes
│   │   ├── types/       # TypeScript types
│   │   ├── utils/       # Helper functions (duplicate detection)
│   │   └── server.ts    # Express server
│   ├── uploads/         # Photo storage
│   └── package.json
│
├── mobile/              # React Native app
│   ├── src/
│   │   ├── config/      # API configuration
│   │   ├── screens/     # App screens
│   │   │   ├── MapScreen.tsx
│   │   │   ├── AddToiletScreen.tsx
│   │   │   └── ToiletDetailsScreen.tsx
│   │   └── services/    # API client
│   └── package.json
│
├── database/            # Database schema
│   └── schema.sql      # PostgreSQL schema with PostGIS
│
└── Documentation
    ├── README.md       # Main documentation
    ├── SETUP.md        # Detailed setup guide
    └── QUICKSTART.md   # Quick start guide
```

## 🚀 Getting Started

### One-command start (backend + app)

From the **Ploop** directory, run:

```bash
npm start
```

This starts both the backend API (port 8082) and the Expo dev server (port 8081) in one terminal. **You can use both web and your phone at the same time** — the same Expo server serves both:

- **Desktop (web):** Open **http://localhost:8081** in your browser.
- **Phone (Expo Go):** In the same terminal you'll see a **QR code** and a URL (e.g. `exp://192.168.x.x:8081`). Scan the QR with Expo Go (phone and Mac on same Wi‑Fi). If the phone can't connect to that LAN URL, run **`npm run start:with-tunnel`** instead of `npm start` to use tunnel mode.
- **iOS Simulator:** Run `npm run start:mobile:ios` in a separate terminal if you want the simulator; or use **http://localhost:8081** in the browser.
Ensure PostgreSQL is running and the database is set up (see `QUICKSTART.md` or `SETUP.md`).

**Troubleshooting:** If `npm start` reports *address already in use* for 8081 or 8082, stop any existing Expo or backend process (or close the terminal that’s running them), then run `npm start` again.

If the map can’t use your location, see **`LOCATION_TROUBLESHOOTING.md`** (desktop browser, iOS Simulator, and device).

**Network / backend:** The app talks to the backend at `http://<host>:8082`. In dev, the host is taken from the Expo dev server (e.g. your machine’s LAN IP when using simulator or device). If you see “Error searching landmarks: Network Error” or “Couldn’t load toilets”, ensure (1) the backend is running (`npm start` or `npm run start:backend`) and (2) the device/simulator can reach it (same Wi‑Fi; simulator uses the host machine so `localhost:8082` is fine when you run both on the same Mac).

**Open on your phone:** Use the same Wi‑Fi as your Mac. Start the backend (`npm run dev` in `backend/`) and Expo (`npx expo start --port 8081` in `mobile/`), then scan the QR code with Expo Go. **If you see “Could not connect to server”** when using the LAN URL (e.g. `exp://192.168.0.3:8081`), use **tunnel mode**: from the **Ploop** folder run `npm run start:mobile:tunnel` (or from `mobile/` run `npx expo start --port 8081 --tunnel`). Expo will show a new QR code and URL; scan that with Expo Go. Keep the backend running in another terminal. (With tunnel, the app loads over the tunnel; if the app then can’t reach the API, ensure phone and Mac are on the same Wi‑Fi and set `EXPO_PUBLIC_PLOOP_API_URL=http://YOUR_MAC_IP:8082` in `mobile/.env`.) **Permanent QR/link page:** Open `mobile/expo-qr.html` in your browser; if opened as a file, enter your computer’s IP. If the app loads but shows API errors, add `EXPO_PUBLIC_PLOOP_API_URL=http://YOUR_MAC_IP:8082` to `mobile/.env` and restart Expo. Find your Mac IP: `ipconfig getifaddr en0`.

**Expo Go version:** The app targets **Expo SDK 55** so it works with Expo Go that uses SDK 55. Use an Expo Go build that matches SDK 55 (e.g. from the App Store / Play Store if they’ve updated to 55).

**Maps in Expo Go:** Expo Go only bundles an older `react-native-maps` native module, so the full map screen can throw `RNMapsAirModule could not be found`. The app handles this by showing a **list-only fallback** (nearby toilets, search, “Add toilet”, “Open in Maps”) when the map module fails to load. Toilet Details in Expo Go shows details without the map (with a note to use a dev build for the full map). For the full native map in the simulator or on device, use a development build: `npx expo run:ios` (or `run:android`).

### Troubleshooting checklist

| Issue | What to check |
|-------|----------------|
| **Phone: “Could not connect to server” (8081)** | Don’t use exp://localhost:8081 on a physical phone. (1) Run `npm run clean-ports` from Ploop, then start Expo: `npm run start:mobile` or `npm start`. (2) Use the **LAN URL** from the Expo terminal (e.g. exp://YOUR_MAC_IP:8081) on the same Wi‑Fi, or (3) use tunnel: `npm run start:mobile:tunnel` and scan the new QR. |
| **Login / Google or Apple sign-in** | The app always tries to load the real sign-in screen. If your build has the required native modules (e.g. many Expo Go and dev builds), Google/Apple sign-in works. If you see “Sign-in unavailable”, that build is missing a module — use **Continue as guest** or a dev build: `npx expo run:ios`. |
| App entry not found / Lazy element undefined | Map route uses `MapScreenWrapper` (try/require); Toilet Details uses optional `react-native-maps`. Ensure no other screens import `react-native-maps` at top level. |
| Reload button crashes (reload of undefined) | `AppErrorBoundary` only calls `location.reload()` when `location?.reload` is a function (web only). |
| No toilets / Network Error | Backend must be running (`npm start` or `npm run start:backend`). Simulator uses host from Expo; ensure backend is reachable on port 8082. |
| **Using cached toilets** / **Error searching landmarks** / **POI click Network Error** | The app can’t reach the backend. On a **physical phone**: set `EXPO_PUBLIC_PLOOP_API_URL=http://YOUR_MAC_LAN_IP:8082` in `mobile/.env` (get IP: `ipconfig getifaddr en0`), ensure backend is running and phone is on same Wi‑Fi, then restart Expo and reload. See **TROUBLESHOOT_8081.md**. |
| **How to access Admin** | Sign in with Google (admin email in `ADMIN_EMAILS`), open map → tap **⋯** (top-right) → **Admin**. First time: set 4-digit PIN; then use PIN or Face ID to unlock. See **AUTH_SETUP.md**. |
| Location fails on simulator | Map and fallback use default coords (e.g. San Francisco) and still load toilets; optional: set Simulator → Features → Location. |
| TypeScript errors | Run `cd mobile && npx tsc --noEmit`. |
| Bundle/build | Run `cd mobile && npx expo export --platform ios` to verify the app bundles. |

## 🔄 Next Steps for Phase 2

When ready to implement Phase 2:

1. **Real-time Features**:
   - Add WebSocket server (Socket.io)
   - Stall occupancy tracking
   - Toilet paper SOS alerts
   - Cleaning in progress notifications

2. **Monetization**:
   - Payment processing (Stripe)
   - Tip system with $1000 cap
   - Subscription model
   - Ad placement system

3. **Data Sales**:
   - Analytics dashboard
   - Data export APIs
   - Privacy-compliant data sharing

## 📊 API Endpoints

### Toilets
- `GET /api/toilets` - Get nearby toilets (with radius)
- `GET /api/toilets/:id` - Get toilet details
- `POST /api/toilets` - Create new toilet
- `PUT /api/toilets/:id` - Update toilet
- `POST /api/toilets/check-duplicate` - Check for duplicates
- `POST /api/toilets/:id/photo` - Upload photo
- `POST /api/toilets/:id/review` - Submit review

### Health
- `GET /health` - Server health check

## 🧪 Testing Recommendations

1. **Manual Testing**:
   - Add toilet at your location
   - Try adding duplicate (should warn)
   - Upload photo
   - Submit review
   - Check scores update

2. **Edge Cases**:
   - Toilets very close together (<10m)
   - Same name, different locations
   - No reviews (scores should be 0)
   - Missing optional fields

3. **Performance**:
   - Test with 1000+ toilets in database
   - Verify location queries are fast (<100ms)
   - Check photo upload size limits

## 💡 Tips for Development

- Use `npm run dev` in backend for hot reload
- Use Expo Go app for quick mobile testing
- **Web map:** If the desktop map doesn’t load, set `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` in `mobile/.env` (or ensure Maps JavaScript API is enabled and key is in `app.json` extra)
- Check PostgreSQL logs if database issues
- Use PostGIS functions for advanced location queries
- Monitor API response times in development

## 🎨 UI/UX Notes

- Color-coded markers on map (green=excellent, red=poor)
- Distance shown in meters
- Amenities displayed with emojis
- Loading states for all async operations
- Error messages are user-friendly
- Duplicate warnings give user control

## 🔐 Security Considerations (Future)

- Add authentication (JWT tokens)
- Rate limiting on API endpoints
- Input sanitization (already using express-validator)
- Photo upload validation (size, type)
- SQL injection prevention (using parameterized queries)


