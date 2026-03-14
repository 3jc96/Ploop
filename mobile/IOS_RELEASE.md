# iOS Release Guide

## One-time setup: Sync build version with EAS

Since Apple already has build 1, you need to tell EAS to start from build 2:

```bash
cd Ploop/mobile
eas build:version:set
```

When prompted:
- **What version would you like to initialize it with?** → Enter `2` (or the next build number after what Apple has)
- **Do you want to set app version source to remote now?** → Select **No** (already set in eas.json)
- **Select platform** → iOS

## Build and release

```bash
cd Ploop/mobile

# Build only (auto-increments build number on EAS)
npm run build:ios

# Build and submit to TestFlight
npm run release:ios
```

## What changed

- **Version 1.0.0** was happening because the native `ios/` project had old values that overrode `app.json`.
- **Submission errors** (409 duplicate build) happened because build 1 was already uploaded to Apple.

**Fix:** EAS now uses **remote version management** with `autoIncrement: true`. EAS servers assign a new build number for each build, so you won't get duplicate errors.

- `version` (user-facing, e.g. 1.0.7) – still bumped by `npm run version:bump` before each build
- `buildNumber` – now managed by EAS (auto-incremented remotely)
