# Fix POI Timeout & Sign-in Failure

## Root cause
Both errors mean **the app cannot reach the backend**:
- `Error handling native POI click: timeout of 30000ms exceeded`
- `Google sign-in error: timeout of 60000ms exceeded` or `Network Error`
- `Using cached toilets (backend request failed)`

## Fix: iOS Simulator

The LAN IP (e.g. `192.168.0.2`) is often unreachable from the iOS Simulator.

**Add to `mobile/.env`:**
```
EXPO_PUBLIC_PLOOP_USE_LOCALHOST=true
```

Then restart Expo and reload the app. The backend at `localhost:8082` will be used.

## Fix: Physical device

1. Ensure backend is running: `npm run start:backend` from Ploop.
2. Set in `mobile/.env`:
   ```
   EXPO_PUBLIC_PLOOP_API_URL=http://YOUR_MAC_IP:8082
   ```
   Get your Mac's IP: `ipconfig getifaddr en0`
3. Phone and Mac must be on the same Wi‑Fi.
4. Restart Expo after changing .env.

## Changes made (code)

- **POI:** When backend times out, the sheet now stays open with basic info (name, coordinates) instead of chaining another failing request.
- **Timeouts:** `getLandmarkDetails` and `getLocationDetails` use 10s timeout (was 30s) so failure is faster.
- **Map tap fallback:** When coordinate-based lookup fails, we show basic location info instead of nothing.
- **Simulator override:** `EXPO_PUBLIC_PLOOP_USE_LOCALHOST=true` forces `localhost:8082` for development.
