# Gaode (Amap) Map Setup for China

Ploop automatically uses **Gaode (高德地图)** when the user is in China for better map coverage and compliance. For users outside China, Google Maps is used.

## Blank map tiles? Check your API keys

If the map shows a white background with markers but no roads/terrain, the Gaode API keys are invalid or missing. Replace the placeholders in `app.json` with real keys from 高德开放平台.

---

## Get API Keys

1. Go to [高德开放平台](https://lbs.amap.com/) and register.
2. Create an application and add:
   - **iOS Key** – for the iOS app (bundle ID: `com.ploop.app`)
   - **Android Key** – for the Android app (package: `com.ploop.app`)
3. Enable these services for each key:
   - **地图** (Map) – required for map tiles
   - **定位** (Location) – required for user location
4. Copy the keys.

## Configure in app.json

Replace the placeholder keys in `app.json` (in the `expo-gaode-map` plugin config):

```json
[
  "expo-gaode-map",
  {
    "iosKey": "YOUR_ACTUAL_IOS_KEY",
    "androidKey": "YOUR_ACTUAL_ANDROID_KEY",
    "enableLocation": true,
    "locationDescription": "Ploop needs your location to find nearby toilets."
  }
]
```

**Important:** Do not leave `YOUR_GAODE_IOS_KEY` or `YOUR_GAODE_ANDROID_KEY` – these are placeholders and will cause blank map tiles.

## Rebuild

After changing the keys, rebuild the native app:

```bash
npx expo prebuild --clean
npx expo run:ios
# or
npx expo run:android
```

## Testing

- **Google Maps first**: The app uses Google Maps everywhere by default.
- **Gaode fallback in China**: When the user is in China mainland, the app automatically switches to Gaode (Amap) for better coverage (Google may be blocked there).
- **Dev testing**: Use "Simulate China location" in Settings (dev only) to test Gaode from elsewhere.

## Gaode POI (toilet search in China)

When using Amap, the app fetches nearby public toilets from Gaode's POI API in addition to the Ploop backend. This requires a **Web Service** key.

1. In [Gaode console](https://console.amap.com/), edit your key and enable **Web服务** (Web Service).
2. The same iOS/Android key can often be used; or create a separate Web Service key.
3. Add the key to `app.json` → `extra` → `gaodeWebKey`, or set `EXPO_PUBLIC_GAODE_WEB_KEY` in `.env`.

If the key is missing, Gaode POI is skipped and only backend toilets are shown.

## Gaode in Singapore / overseas

Gaode/Amap has limited overseas coverage. The SDK may render maps in Singapore, but tiles and POI data are optimized for China. Use the Settings override to test; for production in Singapore, the app will use Google Maps by default.

If map tiles are still blank after adding valid keys (e.g. when testing in Singapore), Gaode may require **世界地图** (world map) to be enabled for your key. Contact Gaode support via [工单](https://lbs.amap.com/) to request overseas map access.
