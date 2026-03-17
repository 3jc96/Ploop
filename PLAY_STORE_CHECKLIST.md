# Google Play Store Submission Checklist

Use this when setting up Ploop on the Play Store.

---

## 1. Google Play Developer Account

- [ ] Register at [play.google.com/console](https://play.google.com/console) ($25 one-time)
- [ ] Complete developer profile and agreements

---

## 2. Create the App

1. Play Console → **Create app**
2. **App name:** Ploop
3. **Default language:** English (United States)
4. **App or game:** App
5. **Free or paid:** Free
6. **Package name:** `com.ploop.app` (must match app.json)

---

## 3. App Content (Required Sections)

### Privacy Policy
**URL:** `https://ploop-api.onrender.com/privacy`

### App Access
- **Does your app require users to sign in?** → No (optional sign-in for saving reviews)
- If asked: "Users can browse toilets without an account. Sign-in is optional to save reviews and favorites."

### Ads Declaration
- **Does your app contain ads?** → No

### Content Rating
- Complete the questionnaire (similar to iOS)
- Expected: **Everyone** or **3+**

### Target Audience
- **Target age groups:** 13+ or All ages

### News App
- **Is your app a news app?** → No

### COVID-19
- **COVID-19 contact tracing?** → No

### Data Safety
- **Location:** Collected, used for finding nearby toilets
- **Personal info:** Email/name if user signs in (optional)
- **Photos:** Optional, for toilet uploads
- No data sold to third parties
- No data shared for advertising

---

## 4. Store Listing

### Short Description (max 80 characters)
```
Find clean toilets nearby. Map, reviews, ratings, and directions.
```

### Full Description (max 4000 characters)
```
Find clean toilets nearby—fast.

Ploop helps you discover and review public toilets near you. See ratings for cleanliness and smell, check amenities (bidet, wheelchair access, free entry), and get directions.

• Map view – Browse toilets on an interactive map
• Reviews – Rate toilets and read what others say
• Filters – Bidet only, wheelchair accessible, free only
• Save favorites – Build your go-to list
• Add toilets – Contribute new spots for the community
• Mini-game – Catch the poop and compete on the leaderboard

Sign in with Google or Apple to save your reviews and favorites. No account needed to browse.
```

### Graphics Required

| Asset | Size | Notes |
|-------|------|-------|
| App icon | 512×512 px | Use `Ploop/mobile/assets/icon.png` (resize if needed) |
| Feature graphic | 1024×500 px | Banner for store listing |
| Phone screenshots | Min 2, max 8 | 16:9 or 9:16, min 320px short side |
| 7" tablet screenshots | If supporting tablets | Optional |

---

## 5. Build & Upload

### Build the AAB
```bash
cd Ploop/mobile
eas build --platform android --profile production
```

### First Upload (Manual – Google Requirement)
1. Download the AAB from [expo.dev](https://expo.dev) → your project → Builds
2. Play Console → **Production** (or **Testing** → Internal testing)
3. **Create new release** → **Upload** → select the AAB
4. Add release notes (e.g. "Initial release")
5. Save and roll out

### Subsequent Uploads (EAS Submit)
After first manual upload, configure service account and run:
```bash
eas submit --platform android --latest
```

---

## 6. Release

1. Complete all **App content** sections (green checkmarks)
2. Complete **Store listing**
3. Upload build
4. **Send for review** (Production or Internal testing first)

---

## Quick Reference

| Item | Value |
|------|-------|
| Package name | com.ploop.app |
| Privacy policy | https://ploop-api.onrender.com/privacy |
| Support email | rubiks.bb@gmail.com |
| Build command | `eas build --platform android --profile production` |
