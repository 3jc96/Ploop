# Ship Ploop to Google Play & App Store (Expo EAS)

Store uploads are **not automatic from this repo** — you run **EAS Build** and **EAS Submit** from your machine (or CI) with your accounts.

## Prerequisites

1. **Expo / EAS**
   - Account: project owner `jcrs96` (see `app.json` / `extra.eas.projectId`).
   - Install: `npm i -g eas-cli`
   - Login: `eas login`
   - From `Ploop/mobile`: `eas whoami` and confirm the project links: `eas project:info`

2. **Android — Google Play**
   - [Google Play Console](https://play.google.com/console) app created with package **`com.ploop.app`** (must match `app.json`).
   - A **Google Service Account JSON** with Play API access, linked in Play Console → **API access**.  
   - EAS: `eas credentials` or follow the prompt on first `eas submit` to upload the key.

3. **iOS — App Store Connect**
   - Apple Developer Program membership.
   - App record in App Store Connect (EAS already has `ascAppId` in `eas.json` for submit).
   - **Distribution certificate + provisioning profile** — EAS can manage these: `eas credentials -p ios`.

## One-command flows (from `Ploop/mobile`)

```bash
cd Ploop/mobile
```

**Android (Play Store)** — builds AAB (`production` profile), then submits latest build:

```bash
npm run deploy:android
```

**iOS (TestFlight / App Store)** — builds on EAS, then submits latest:

```bash
npm run deploy:ios
```

Or step-by-step:

```bash
npm run build:android
npm run submit:android

npm run build:ios
npm run submit:ios
```

Optional before iOS if you use local bump + prebuild helpers:

```bash
npm run prepare:ios
```

## Profiles (see `eas.json`)

- **production** uses `EXPO_PUBLIC_PLOOP_API_URL=https://ploop-api.onrender.com` — change in `eas.json` if your API URL differs.
- **Android Play track** is set in **`eas.json`** under `submit.<profile>.android.track`. There is **no** `--track` flag on `eas submit`.

| Profile        | Command |
|----------------|---------|
| **production** (default) — Play **production** track | `eas submit --platform android --latest` |
| **internal** testing track | `eas submit --platform android --latest --profile play-internal` |

Edit `eas.json` → `submit.production.android.track` if you need `alpha`, `beta`, or `internal` as the default instead.

## After submit

- **Android:** Play Console → **Testing** (internal/open) or **Production** → review and roll out.
- **iOS:** App Store Connect → **TestFlight** for testers; then **App Store** tab for review/release.

## Notes

- `app.json`: bump **`version`**, **`ios.buildNumber`**, and **`android.versionCode`** when stores require it; **`production`** profile has `autoIncrement: true` for native build numbers where EAS applies it.
- Store review: privacy policy, location justification, and sign-in (Google/Apple) must match what you declare in each store.
