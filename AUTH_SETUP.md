# Ploop – Auth & Admin Setup

## Overview

- **Users** sign in with **Google** or **Apple**. **Admins** are determined by email (`ADMIN_EMAILS`); e.g. `rubiks.bb@gmail.com` gets admin when signing in with Google.
- **Admin screen** in the app is protected by a **4-digit PIN** and **Face ID / Touch ID**. You set the PIN once; then unlock Admin with biometrics or PIN.

## Backend (.env)

In `backend/` copy `env.example` to `.env` and set:

```bash
# Required for JWT (use a long random string in production)
JWT_SECRET=your_jwt_secret_min_32_chars_long_please

# Google Sign-In (same OAuth client for backend + mobile redirect)
GOOGLE_CLIENT_ID=your_google_oauth_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret

# Apple Sign-In (optional; iOS app only)
APPLE_CLIENT_ID=your_apple_services_id

# Admin: comma-separated emails that get admin role
ADMIN_EMAILS=rubiks.bb@gmail.com
```

- **Google:** In [Google Cloud Console](https://console.cloud.google.com/apis/credentials) create an OAuth 2.0 **Web application** client. Use the same client ID for the backend and for the Expo app’s redirect (authorized redirect URIs must include your Expo redirect, e.g. `https://auth.expo.io/@your-username/your-app-slug`).
- **Apple:** Configure Sign in with Apple in App Store Connect and use the same **Services ID** as `APPLE_CLIENT_ID` for token verification.

## Mobile (app config)

Set the **same** Google OAuth **Web** client ID so the app can complete sign-in:

- In `mobile/.env`: `EXPO_PUBLIC_GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com`
- Or in `app.json` → `extra`: `"EXPO_PUBLIC_GOOGLE_CLIENT_ID": "your_client_id.apps.googleusercontent.com"`

Restart Expo after changing `.env`.

## How to access your admin account

1. **Sign in** with Google (or Apple) using an email that’s in `ADMIN_EMAILS` (e.g. `rubiks.bb@gmail.com`).
2. Open the **map** (e.g. “Continue as guest” or “Create account or sign in” then use the app).
3. Tap the **⋯** (three dots) button in the top-right to open **Settings**.
4. Tap **Admin** (only visible when you’re signed in as an admin).
5. **First time:** set a **4-digit PIN**. After that, you’ll need that PIN or **Face ID / Touch ID** to open Admin each time.

## Admin PIN + Face ID

When an admin opens the **Admin** screen for the first time, they set a **4-digit PIN**. That PIN (or Face ID / Touch ID when available) is required each time they open Admin. This keeps admin access secure if someone else has the device.

## Admin moderation (API)

With a user whose email is in `ADMIN_EMAILS`:

- **List recent reviews:**  
  `GET /api/admin/reviews?limit=50&offset=0`  
  Send header: `Authorization: Bearer <your_jwt>`
- **Delete a review:**  
  `DELETE /api/admin/reviews/:reviewId`  
  Send header: `Authorization: Bearer <your_jwt>`

Get a JWT by signing in with Google (or Apple) in the app; the token is stored and sent automatically. For API testing you can use the same token from the app or implement a small “admin login” that returns a JWT.

## Database

On startup the backend ensures a `users` table and a `user_id` column on `toilet_reviews`. No manual migration is required for a fresh install.
