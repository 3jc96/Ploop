# Sharing the App with Remote Users

To let someone in another country test your app, you need to make the backend publicly accessible.

## Option 1: Use Expo Tunnel (Easiest)

Expo has built-in tunnel support that makes your entire development server accessible:

1. **Stop current Expo server** (Ctrl+C)

2. **Start with tunnel mode**:
   ```bash
   cd mobile
   npm start -- --tunnel
   ```

3. **Get the tunnel URL** - Expo will give you a URL like:
   ```
   exp://exp.host/@your-username/ploop
   ```

4. **Share the QR code** with the remote user

5. **BUT** - This only exposes the Expo app, not your backend API

## Option 2: Use ngrok (Recommended for Backend)

ngrok creates a secure tunnel to your local backend:

### Setup:

1. **Install ngrok**:
   ```bash
   brew install ngrok
   # OR download from https://ngrok.com/
   ```

2. **Create free account** at https://ngrok.com/ (get auth token)

3. **Configure ngrok**:
   ```bash
   ngrok config add-authtoken YOUR_TOKEN
   ```

4. **Start backend** (in one terminal):
   ```bash
   cd backend
   npm run dev
   ```

5. **Start ngrok tunnel** (in another terminal):
   ```bash
   ngrok http 3000
   ```

6. **Copy the ngrok URL** (e.g., `https://abc123.ngrok.io`)

7. **Update API config** in `mobile/src/config/api.ts`:
   ```typescript
   export const API_BASE_URL = __DEV__
     ? 'https://abc123.ngrok.io'  // Your ngrok URL
     : 'https://your-api-domain.com';
   ```

8. **Restart Expo**:
   ```bash
   cd mobile
   npm start
   ```

9. **Share QR code** - Remote user can scan and use the app!

**Note**: Free ngrok URLs change each time you restart. For permanent URLs, you need a paid plan.

## Option 3: Deploy Backend (Best for Production)

Deploy your backend to a cloud service:

- **Heroku** (easy, free tier available)
- **Railway** (simple deployment)
- **DigitalOcean** (more control)
- **AWS/Azure/GCP** (enterprise)

Then update `mobile/src/config/api.ts` with your deployment URL.

## Option 4: Use Cloudflare Tunnel (Free, Permanent)

Cloudflare Tunnel provides a free, permanent URL:

1. **Install cloudflared**:
   ```bash
   brew install cloudflared
   ```

2. **Create tunnel**:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```

3. **Copy the URL** it gives you (e.g., `https://xyz.trycloudflare.com`)

4. **Update API config** with this URL

5. **Restart Expo**

## Quick Comparison

| Method | Free | Permanent URL | Setup Difficulty |
|--------|------|---------------|------------------|
| Expo Tunnel | ✅ | ❌ | Easy |
| ngrok | ✅ | ❌ (free) | Easy |
| Cloudflare Tunnel | ✅ | ❌ (changes) | Easy |
| Deploy Backend | ❓ | ✅ | Medium |

## Recommended for Testing

For quick testing with a remote user:
1. Use **ngrok** (easiest, works immediately)
2. Share the ngrok URL + QR code
3. Update API config and reload app

For production/long-term:
1. Deploy backend to Heroku/Railway
2. Update API config with deployment URL
3. Share app normally


