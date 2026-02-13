# Google Sign-In – 5-minute setup

## 1. Create OAuth credentials (Google Cloud)

1. Open **[Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)**.
2. Select your project (or create one).
3. Click **Create credentials** → **OAuth client ID**.
4. If asked, configure the **OAuth consent screen** (External, add your email as test user).
5. Application type: **Web application**.
6. Name: e.g. `Ploop`.
7. **Authorized redirect URIs** – add **all** of these (must match exactly):
   - **Native (Expo Go / device):** `https://auth.expo.io/@jcrs96/ploop`  
     (Replace `jcrs96` with your Expo username and `ploop` with your app slug from `app.json` → `expo.slug`.)
   - **Web:** `http://localhost:8081/redirect`  
     (Copy this exactly – no trailing slash after "redirect". When you deploy, add your production origin + `/redirect`, e.g. `https://yourapp.com/redirect`.)
8. Click **Create**. Copy the **Client ID** and **Client secret**.

## 2. Backend

In **`Ploop/backend/.env`** (create from `env.example` if needed), set:

```bash
GOOGLE_CLIENT_ID=YOUR_CLIENT_ID.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=YOUR_CLIENT_SECRET
```

Restart the backend after changing `.env`.

## 3. Mobile

In **`Ploop/mobile/.env`**, set the **same** Client ID (no secret in the app):

```bash
EXPO_PUBLIC_GOOGLE_CLIENT_ID=YOUR_CLIENT_ID.apps.googleusercontent.com
```

Use the **exact same** value as `GOOGLE_CLIENT_ID` in the backend.

**Restart Expo** (stop and run `npm run start:tunnel` or `npm run start` again) so the app picks up the new env.

## 4. Test

1. Backend running: `npm run start:backend` from Ploop.
2. Expo running: `npm run start:tunnel` or `npm run start` from Ploop/mobile.
3. In the app: **Sign in** → **Continue with Google**. You should see the Google sign-in screen.

---

**If you see "Not configured"** – `EXPO_PUBLIC_GOOGLE_CLIENT_ID` is missing or empty. Add it to `mobile/.env` and restart Expo.

**If redirect fails** – Add the exact redirect URI from the error message to your OAuth client’s **Authorized redirect URIs** in Google Cloud Console.

---

## Access blocked / Error 400: redirect_uri_mismatch (mobile or web)

Google rejects the request because the redirect URI sent by the app is not in your OAuth client’s **Authorized redirect URIs**.

- **Web:** Add exactly: `http://localhost:8081/redirect`  
  (No trailing slash. The app normalizes 127.0.0.1 to localhost, so this one URI covers both.)

- **Mobile (Expo Go):** Add exactly:  
  `https://auth.expo.io/@YOUR_EXPO_USERNAME/ploop`  
  (Check Metro logs when you tap “Sign in with Google” – it prints the redirect URI, or see `app.json` → `expo.owner` and `expo.slug`.)
- Use a **Web application** OAuth client in Google Cloud (not Android/iOS) so the same client works for web and for the code exchange used by Expo.

After changing redirect URIs in Google Cloud Console, wait a minute and try again.

## Web: not redirected back after signing in

- If a **popup** opened for Google and then closed but nothing happened: the app should still receive the result. Ensure you’re not blocking third‑party cookies or the popup.
- If the **same tab** went to Google and then came back to your app with `?code=...` in the URL: the app will exchange the code and log you in, then clear the URL. If it doesn’t, check the browser console for errors and that `http://localhost:8081` is in Google’s Authorized redirect URIs.
