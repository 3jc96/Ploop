# How to Become an App Developer & Publish Ploop to the App Store

Step-by-step guide to publish Ploop without running a local server. Your backend runs in the cloud; the app runs on users’ phones.

---

## Part 1: Apple Developer Program

### Step 1.1: Enroll in the Apple Developer Program

1. Go to **[developer.apple.com](https://developer.apple.com)**
2. Click **Account** → **Sign In** (use your Apple ID)
3. Click **Enroll** (or **Membership** → **Enroll**)
4. Choose **Individual** or **Organization**:
   - **Individual:** You’re the sole developer. Use your personal Apple ID.
   - **Organization:** For a company. Requires a D-U-N-S number and legal entity.
5. Pay the **$99/year** fee
6. Wait for approval (often 24–48 hours; sometimes same day)

### Step 1.2: Fix “Developer account needs to be updated”

If you see this during a build:

1. Go to [developer.apple.com/account](https://developer.apple.com/account)
2. Complete any pending agreements (e.g. Paid Apps Agreement)
3. Ensure your payment method and contact info are up to date

---

## Part 2: Deploy Backend to the Cloud

Your app needs a public API. Render is already configured for Ploop.

### Step 2.1: Push code to GitHub

```bash
cd /Users/joelchu/quantum-webscraper
git init   # if not already a git repo
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/Ploop.git
git push -u origin main
```

### Step 2.2: Deploy on Render

1. Go to **[render.com](https://render.com)** and sign up (free)
2. **New** → **Blueprint** (or **Web Service**)
3. Connect your GitHub repo
4. Render will read `render.yaml` in the repo and create:
   - PostgreSQL database
   - Web service for the backend
5. After deploy, you’ll get a URL like **https://ploop-api.onrender.com**
6. In Render Dashboard → **Environment**, add:
   - `JWT_SECRET` (32+ chars)
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (if using Google Sign-In)
   - `GOOGLE_PLACES_API_KEY` (for map search)
   - `ADMIN_EMAILS` (comma-separated admin emails)

### Step 2.3: Verify backend

```bash
curl https://ploop-api.onrender.com/health
# Should return: {"status":"ok","timestamp":"..."}
```

---

## Part 3: Configure the App for Production

### Step 3.1: Set production API URL

The app must use your deployed backend, not localhost. This is set at **build time**.

Create or edit `Ploop/mobile/.env.production` (optional, for clarity):

```
EXPO_PUBLIC_PLOOP_API_URL=https://ploop-api.onrender.com
```

Or pass it when building (see Step 4.2).

### Step 3.2: Ensure app.json is correct

- **Bundle ID:** `com.ploop.app` (must match App Store Connect)
- **Version:** e.g. `1.0.0` in `app.json` → `expo.version`

---

## Part 4: Build the App with EAS

### Step 4.1: Install EAS CLI

```bash
npm install -g eas-cli
```

### Step 4.2: Log in to Expo

```bash
cd Ploop/mobile
eas login
```

Use the Expo account that owns the project (e.g. `jcrs96`).

### Step 4.3: Configure EAS (if needed)

```bash
eas build:configure
```

### Step 4.4: Build for iOS (production)

```bash
cd Ploop/mobile

EXPO_PUBLIC_PLOOP_API_URL=https://ploop-api.onrender.com eas build --profile production --platform ios
```

- EAS builds in the cloud
- First build may take 15–30 minutes
- When done, you get a link to the `.ipa` file

### Step 4.5: Fix Apple credentials (if prompted)

If EAS asks for Apple credentials:

```bash
eas credentials --platform ios
```

- Choose **production**
- Let EAS create/use distribution certificate and provisioning profile
- You may need to log in with your Apple Developer account

---

## Part 5: Submit to TestFlight (Beta Testing)

### Step 5.1: Create the app in App Store Connect

1. Go to **[App Store Connect](https://appstoreconnect.apple.com)**
2. **Apps** → **+** → **New App**
3. Fill in:
   - **Platform:** iOS
   - **Name:** Ploop
   - **Primary Language:** English
   - **Bundle ID:** `com.ploop.app` (must match `app.json`)
   - **SKU:** e.g. `ploop-001`
4. Click **Create**

### Step 5.2: Submit build to TestFlight

```bash
eas submit --platform ios --latest
```

- EAS uses the latest production build
- Choose the app in App Store Connect when prompted
- Wait 15–30 minutes for Apple to process the build

### Step 5.3: Add testers

1. In App Store Connect: **TestFlight** tab
2. **Internal Testing:** Add team members (up to 100)
3. **External Testing:** Add up to 10,000 testers (requires a short review)

---

## Part 6: Submit to the App Store (Public Release)

### Step 6.1: Prepare store listing

In App Store Connect → your app:

1. **App Information:** Name, subtitle, category (e.g. Navigation or Utilities)
2. **Pricing:** Free or paid
3. **App Privacy:** Privacy policy URL, data collection details
4. **Screenshots:** Required sizes (e.g. 6.7", 6.5", 5.5" for iPhone)
5. **Description:** What the app does
6. **Keywords:** For search
7. **Support URL:** e.g. your website or GitHub

### Step 6.2: Create a version for release

1. **App Store** tab → **+** to add a version (e.g. 1.0.0)
2. Fill in description, keywords, screenshots, etc.
3. Under **Build**, select the TestFlight build you submitted
4. Answer **Export Compliance** (e.g. “No” for encryption if you use standard HTTPS only)
5. **Content Rights** and **Advertising Identifier** if applicable

### Step 6.3: Submit for review

1. Click **Add for Review**
2. Answer any additional questions (e.g. sign-in, in-app purchases)
3. Click **Submit to App Review**
4. Review usually takes 24–48 hours

---

## Quick Reference

| Step | Command / Action |
|------|------------------|
| Deploy backend | Push to GitHub → Connect Render → Add env vars |
| Build iOS | `EXPO_PUBLIC_PLOOP_API_URL=https://ploop-api.onrender.com eas build --profile production --platform ios` |
| Submit to TestFlight | `eas submit --platform ios --latest` |
| View builds | [expo.dev](https://expo.dev) → your project → Builds |
| App Store Connect | [appstoreconnect.apple.com](https://appstoreconnect.apple.com) |

---

## Common Issues

| Issue | Fix |
|-------|-----|
| “Developer account needs to be updated” | Complete agreements at developer.apple.com/account |
| “No builds found” | Run `eas build` first |
| “Invalid provisioning profile” | Run `eas credentials --platform ios` |
| App shows no data / network error | Ensure `EXPO_PUBLIC_PLOOP_API_URL` points to your Render URL at build time |
| Render free tier sleeps | First request after idle may be slow; consider paid plan for production |

---

## Summary Checklist

- [ ] Apple Developer Program enrolled ($99/year)
- [ ] Backend deployed (e.g. Render) and reachable
- [ ] `EXPO_PUBLIC_PLOOP_API_URL` set to production URL when building
- [ ] `eas build --profile production --platform ios` succeeds
- [ ] App created in App Store Connect with bundle ID `com.ploop.app`
- [ ] Build submitted via `eas submit --platform ios --latest`
- [ ] Store listing, screenshots, and privacy info filled in
- [ ] App submitted for App Review
