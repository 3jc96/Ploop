# How to Publish Ploop to the Google Play Store

Step-by-step guide to publish Ploop on Android.

---

## Part 1: Google Play Developer Account

### Step 1.1: Register

1. Go to **[play.google.com/console](https://play.google.com/console)**
2. Sign in with your Google account
3. Pay the **$25 one-time** registration fee
4. Complete the developer profile and accept the agreements

---

## Part 2: Create the App in Play Console

### Step 2.1: Create app

1. In Play Console → **Create app**
2. Fill in:
   - **App name:** Ploop
   - **Default language:** English
   - **App or game:** App
   - **Free or paid:** Free
3. Accept declarations and create

### Step 2.2: Set up the app

1. **App content** – Complete required sections:
   - Privacy policy URL
   - App access (if login required, explain how)
   - Ads declaration (if you use ads – Ploop doesn’t)
   - Content rating questionnaire
   - Target audience
   - News app declaration (No, if not a news app)
   - COVID-19 contact tracing (No)
   - Data safety form

2. **Store listing** – Main store presence:
   - Short description (80 chars)
   - Full description (4000 chars)
   - Screenshots (phone, 7-inch tablet if supported)
   - App icon (512×512)
   - Feature graphic (1024×500)

---

## Part 3: Build for Play Store

### Step 3.1: Set Android version (if using remote)

```bash
cd Ploop/mobile
eas build:version:set
```

- Select **Android**
- Set version (e.g. `1.2.9`) and version code (e.g. `23`)

### Step 3.2: Build production AAB

```bash
cd Ploop/mobile
eas build --profile production --platform android
```

- Builds an **AAB** (Android App Bundle) for Play Store
- Uses `EXPO_PUBLIC_PLOOP_API_URL=https://ploop-api.onrender.com` from eas.json
- First build may take 15–25 minutes
- EAS will create/use an Android keystore for signing

### Step 3.3: First manual upload (required by Google)

Google requires the **first** upload to be done manually:

1. Download the AAB from the EAS build page
2. In Play Console → your app → **Production** (or **Testing** → Internal testing)
3. **Create new release** → **Upload** → select the AAB
4. Add release notes and save

After this first manual upload, you can use EAS Submit for future releases.

---

## Part 4: Submit with EAS (after first manual upload)

### Step 4.1: Configure Google Service Account

1. In [Google Cloud Console](https://console.cloud.google.com):
   - Create a project (or use existing)
   - Enable **Google Play Android Developer API**
2. Create a **Service Account** with JSON key
3. In Play Console → **Users and permissions** → Invite the service account with **Release to production** (or appropriate) permission
4. In [Expo dashboard](https://expo.dev) → your project → **Credentials** → **Android** → Add the service account JSON

### Step 4.2: Add submit config to eas.json (optional)

```json
"submit": {
  "production": {
    "ios": { "ascAppId": "6759898612" },
    "android": {
      "track": "internal",
      "serviceAccountKeyPath": "./path-to-your-key.json"
    }
  }
}
```

Or let EAS prompt you when you run submit.

### Step 4.3: Submit

```bash
eas submit --platform android --latest
```

- Uses the latest production Android build
- Choose track: **internal** (testing), **alpha**, **beta**, or **production**
- EAS uploads to Play Console

---

## Part 5: Release to Production

1. In Play Console → **Production** → **Releases**
2. Create a release with your build
3. Complete store listing and content ratings if not done
4. **Send for review**
5. Review usually takes a few hours to a few days

---

## Quick Reference

| Step | Command / Action |
|------|------------------|
| Build Android AAB | `eas build --profile production --platform android` |
| Submit (after 1st manual) | `eas submit --platform android --latest` |
| View builds | [expo.dev](https://expo.dev) → your project → Builds |
| Play Console | [play.google.com/console](https://play.google.com/console) |

---

## Package Name

Ploop uses `com.ploop.app` (from app.json). This must match the package name in Play Console when you create the app.

---

## Common Issues

| Issue | Fix |
|-------|-----|
| "First upload must be manual" | Upload the first AAB manually in Play Console |
| Keystore / signing errors | Run `eas credentials --platform android` |
| Version code conflict | Increment version code in `eas build:version:set` |
| App shows no data | Ensure `EXPO_PUBLIC_PLOOP_API_URL` points to Render in production build |
