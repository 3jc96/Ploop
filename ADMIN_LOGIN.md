# Log in to your admin account

Admin login uses **Google Sign-In**. Your admin email is **rubiks.bb@gmail.com** (in `backend/.env` as `ADMIN_EMAILS`). Once Google Sign-In is configured, you sign in with that Google account and get admin access.

---

## Step 1: Get a Google OAuth Client ID (one-time)

1. Open **[Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)**.
2. Select your project (or create one).
3. **Create credentials** → **OAuth client ID**.
4. If prompted, set up the **OAuth consent screen** (External, add **rubiks.bb@gmail.com** as a test user).
5. Application type: **Web application**.
6. Name: e.g. `Ploop`.
7. **Authorized redirect URIs** → **Add URI**:
   - `https://auth.expo.io/@jcrs96/ploop`
   - (Use your Expo username and app slug if different; see `app.json` → `expo.owner` and `expo.slug`.)
8. Click **Create**. Copy the **Client ID** and **Client secret**.

---

## Step 2: Backend

Edit **`Ploop/backend/.env`** (create from `backend/env.example` if it doesn’t exist). Set:

```bash
GOOGLE_CLIENT_ID=PASTE_YOUR_CLIENT_ID_HERE.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=PASTE_YOUR_CLIENT_SECRET_HERE
ADMIN_EMAILS=rubiks.bb@gmail.com
```

Restart the backend: stop it (Ctrl+C), then from **Ploop** run `npm run start:backend`.

---

## Step 3: Mobile app

Edit **`Ploop/mobile/.env`**. Set the **same** Client ID (no secret):

```bash
EXPO_PUBLIC_GOOGLE_CLIENT_ID=PASTE_SAME_CLIENT_ID_HERE.apps.googleusercontent.com
```

Restart Expo so the app picks up the new value: stop Expo (Ctrl+C), then from **Ploop/mobile** run `npm run start:tunnel` or `npx expo start --clear --tunnel`. Reload the app in Expo Go (shake → Reload).

---

## Step 4: Sign in and open Admin

**Direct link (web):** Open **http://localhost:8081/admin** to go straight to the Admin screen. (On mobile, use Map → ⋯ → Admin.)

1. In the app, tap **Create account or sign in**.
2. Tap **Sign in with Google** and sign in with **rubiks.bb@gmail.com**.
3. You’re signed in as admin. Open the **map** (e.g. tap to continue).
4. Tap **⋯** (top-right) → **Admin**.
5. **First time only:** set a **4-digit PIN**. After that, use **Face ID / Touch ID** or the PIN to open Admin.

---

## If something doesn’t work

- **“Google Sign-In not configured”** – `EXPO_PUBLIC_GOOGLE_CLIENT_ID` is missing or wrong. Add it to `mobile/.env` (same as backend `GOOGLE_CLIENT_ID`), then restart Expo and reload the app.
- **Redirect error** – Add the **exact** redirect URI from the error message to your OAuth client’s **Authorized redirect URIs** in Google Cloud Console.
- **Backend not reachable** – Ensure backend is running (`npm run start:backend` from Ploop) and the app can reach it (see TROUBLESHOOT_8081.md if needed).
- **Network Error / Google sign-in fails** – The app can’t reach the backend.  
  - **iOS Simulator:** Add `EXPO_PUBLIC_PLOOP_USE_LOCALHOST=true` to `mobile/.env`. Restart Expo and reload.  
  - **Physical iPhone:** Set `EXPO_PUBLIC_PLOOP_API_URL=http://YOUR_MAC_IP:8082` in `mobile/.env`. Get your Mac’s IP: `ipconfig getifaddr en0`. iPhone and Mac must be on the same Wi‑Fi. Restart Expo after changing .env.

More detail: **GOOGLE_SIGNIN_SETUP.md** and **AUTH_SETUP.md**.
