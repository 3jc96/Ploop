# TestFlight Setup Guide for Ploop

Follow these steps to get Ploop on TestFlight for beta testing.

---

## Prerequisites

1. **Apple Developer account** ($99/year) – [developer.apple.com](https://developer.apple.com)
2. **Expo / EAS CLI** – `npm install -g eas-cli`
3. **Deployed backend** – TestFlight testers won't be on your Wi‑Fi. Your API must be reachable at a public URL (e.g. Railway, Render, Fly.io, or your own server).

---

## Step 1: Configure production API URL

TestFlight builds run on real devices, so they cannot use `localhost` or your Mac’s LAN IP. You need a public backend URL.

**Option A – Deploy backend first (recommended)**

Deploy the Ploop backend to a hosting provider, then set the URL when building:

```bash
# Example: if your backend is at https://ploop-api.railway.app
EXPO_PUBLIC_PLOOP_API_URL=https://ploop-api.yourdomain.com eas build --profile production --platform ios
```

**Option B – Use a temporary backend**

If the backend is not deployed yet, you can still build and ship the app. It will fail network requests until you deploy and update the app. For testing, you can temporarily point to a staging URL or ngrok tunnel (valid only while the tunnel is running).

---

## Step 2: Ensure Apple credentials are set up

1. **Log in to EAS:**
   ```bash
   cd Ploop/mobile
   eas login
   ```

2. **Configure the project for EAS (if needed):**
   ```bash
   eas build:configure
   ```

3. **Set up Apple credentials** (EAS can create or use your own):
   ```bash
   eas credentials --platform ios
   ```
   - Choose **production** or the profile you use for TestFlight
   - EAS can create an App Store Connect API key or use existing distribution certs and provisioning profile

---

## Step 3: Create the app in App Store Connect

1. Go to [App Store Connect](https://appstoreconnect.apple.com)
2. **Apps** → **+** → **New App**
3. Fill in:
   - **Platform:** iOS
   - **Name:** Ploop
   - **Primary Language:** English (or your choice)
   - **Bundle ID:** `com.ploop.app` (must match `app.json`)
   - **SKU:** e.g. `ploop-001`
4. Click **Create**

---

## Step 4: Build for iOS (production)

```bash
cd Ploop/mobile

# Build with production API URL (replace with your deployed backend)
EXPO_PUBLIC_PLOOP_API_URL=https://your-api.example.com eas build --profile production --platform ios
```

EAS will build in the cloud. When it finishes, you’ll get a download link.

---

## Step 5: Submit to TestFlight

**Option A – Submit from EAS:**

```bash
# After the build completes, submit the latest build
eas submit --platform ios --latest
```

**Option B – Manual upload:**

1. Download the `.ipa` from the EAS build page
2. Use Transporter (Mac App Store) or Xcode Organizer to upload to App Store Connect
3. In App Store Connect: **TestFlight** → select the build → wait for processing (often 15–30 minutes)

---

## Step 6: Add testers

1. In App Store Connect: **TestFlight** → **Internal Testing** or **External Testing**
2. **Internal Testing:** Up to 100 testers (team members with App Store Connect access)
3. **External Testing:** Up to 10,000 testers (requires a short review)
4. Add testers by email; they receive an invite and install via the TestFlight app

---

## Quick reference

| Task            | Command                                              |
|-----------------|------------------------------------------------------|
| Build iOS       | `eas build --profile production --platform ios`      |
| Submit latest   | `eas submit --platform ios --latest`                 |
| View builds     | `eas build:list` or [expo.dev](https://expo.dev)     |
| Credentials     | `eas credentials --platform ios`                     |

---

## Common issues

**“No builds found”** – Run a build first with `eas build`.

**“Invalid provisioning profile”** – Run `eas credentials --platform ios` and fix or regenerate credentials.

**“App won’t load data”** – Check `EXPO_PUBLIC_PLOOP_API_URL` in your build. It must point to a public URL, not localhost or LAN IP.

**Backend not deployed** – Use [Railway](https://railway.app), [Render](https://render.com), or [Fly.io](https://fly.io) to deploy the Ploop backend and get a public URL.
