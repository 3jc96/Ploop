# Switch to Native Google Sign-In on Android

This guide walks through migrating from `expo-auth-session` (auth.expo.io proxy) to `@react-native-google-signin/google-signin` for Android only. iOS and web keep the current flow.

---

## Prerequisites

You already have:
- **Android OAuth client:** `1010299468013-otps87aevhv3r187puttr4tatk5111of.apps.googleusercontent.com`
- **Package name:** `com.ploop.app`
- **SHA-1 (debug):** `72:21:B6:98:57:C6:CD:46:60:CD:39:7A:02:31:FE:67:A6:F9:EE:B4`
- **Web OAuth client:** `765592890788-6e8s1b0ugc544krdfiosv0lv9cg2ket5.apps.googleusercontent.com`

For **Play Store** builds, add the SHA-1 from Play Console → Setup → App signing (both App signing key and Upload key).

---

## Step 1: Install the package

```bash
cd Ploop/mobile
npx expo install @react-native-google-signin/google-signin
```

---

## Step 2: Add config plugin to app.json

Add the plugin to the `plugins` array. For **Android only** (no Firebase), you don't need `iosUrlScheme` for Android, but the plugin may require it. Use your **Web** client ID reversed for iOS (we won't use it on Android, but the plugin expects it):

```json
[
  "@react-native-google-signin/google-signin",
  {
    "iosUrlScheme": "com.googleusercontent.apps.765592890788-6e8s1b0ugc544krdfiosv0lv9cg2ket5"
  }
]
```

The `iosUrlScheme` is derived from the Web client ID: `com.googleusercontent.apps.` + the numeric part before `.apps.googleusercontent.com`.

---

## Step 3: Configure Google Sign-In at app startup

Create or update an init file that runs before the app renders. In `App.tsx` or a new `src/initGoogleSignIn.ts`:

```typescript
// src/initGoogleSignIn.ts
import { Platform } from 'react-native';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

const WEB_CLIENT_ID = '765592890788-6e8s1b0ugc544krdfiosv0lv9cg2ket5.apps.googleusercontent.com';

export function initGoogleSignIn() {
  if (Platform.OS === 'android') {
    GoogleSignin.configure({
      webClientId: WEB_CLIENT_ID,
      offlineAccess: true,
    });
  }
}
```

Call `initGoogleSignIn()` in `App.tsx` before the first render (e.g. at the top level or in a `useEffect` that runs once).

---

## Step 4: Update LoginScreen for Android

In `handleGoogleSignIn`, add a branch for Android that uses the native SDK:

```typescript
import { Platform } from 'react-native';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

// Inside handleGoogleSignIn:
if (Platform.OS === 'android') {
  try {
    await GoogleSignin.hasPlayServices();
    const { idToken } = await GoogleSignin.signIn();
    if (idToken) {
      const ok = await loginWithGoogle({ id_token: idToken });
      if (ok) {
        // navigate to Map or PoopGame
      }
    }
  } catch (e) {
    Alert.alert('Error', getErrorMessage(e, 'Google sign-in failed'));
  } finally {
    setGoogleLoading(false);
  }
  return;
}

// Existing iOS/web flow (expo-auth-session)...
```

---

## Step 5: Backend – accept Android client ID

The backend must verify `id_token` from both the Web client (iOS/web) and the Android client. Add `GOOGLE_ANDROID_CLIENT_ID` to Render env and update `auth.ts`:

```typescript
const GOOGLE_ANDROID_CLIENT_ID = process.env.GOOGLE_ANDROID_CLIENT_ID || '';

// When verifying id_token, use multiple audiences:
const allowedAudiences = [GOOGLE_CLIENT_ID];
if (GOOGLE_ANDROID_CLIENT_ID) allowedAudiences.push(GOOGLE_ANDROID_CLIENT_ID);

const ticket = await client.verifyIdToken({
  idToken: id_token,
  audience: allowedAudiences,
});
```

---

## Step 6: Render environment variables

Add to Render → ploop-api → Environment:

| Key | Value |
|-----|-------|
| `GOOGLE_ANDROID_CLIENT_ID` | `1010299468013-otps87aevhv3r187puttr4tatk5111of.apps.googleusercontent.com` |

Redeploy after adding.

---

## Step 7: Rebuild the app

The native module requires a new build (Expo Go won't work):

```bash
cd Ploop/mobile
eas build --profile production --platform android
```

Or for local dev:

```bash
npx expo prebuild --clean
npx expo run:android
```

---

## Step 8: Verify Google Cloud Console

In [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials):

1. **Android OAuth client** (`1010299468013-...`):
   - Package name: `com.ploop.app`
   - SHA-1: `72:21:B6:98:57:C6:CD:46:60:CD:39:7A:02:31:FE:67:A6:F9:EE:B4`
   - Add Play Store SHA-1s when you have them

2. **Web OAuth client** (unchanged):
   - Authorized redirect URIs: `https://auth.expo.io/@jcrs96/ploop`, `http://localhost:8081/redirect`

---

## Summary checklist

- [ ] Install `@react-native-google-signin/google-signin`
- [ ] Add config plugin to `app.json`
- [ ] Call `initGoogleSignIn()` at app startup
- [ ] Add Android branch in `LoginScreen` using `GoogleSignin.signIn()`
- [ ] Backend: add `GOOGLE_ANDROID_CLIENT_ID`, verify with multiple audiences
- [ ] Render: add env var, redeploy
- [ ] Rebuild Android app (EAS or `expo run:android`)
