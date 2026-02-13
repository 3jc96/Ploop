# Can't connect to server 8081 (phone / Expo)

**Do not type `npx expo start`.** A typo (e.g. `sxpo` or `satrt`) gives `404 Not Found - sxpo`. Use the npm scripts below only.

---

## One-line start (copy-paste this)

From **Ploop/mobile** (or run the first part to get there):

```bash
cd /Users/joelchu/quantum-webscraper/Ploop/mobile && npm run clean-ports && npm run start:tunnel
```

Then scan the **new** QR code with Expo Go. Keep the terminal open.

**If you see "No usable data found" when scanning:** The project now forces Expo Go mode (`--go`) so the QR uses `exp://` and works in Expo Go. Restart the dev server (`npm run start:tunnel` again) and scan the new QR. Or open **Expo Go** on your phone → **Enter URL manually** → paste the URL shown in the terminal (e.g. `exp://xxx.exp.direct:80` or the tunnel URL).

---

## Or run step by step from Ploop/mobile

```bash
npm run clean-ports
npm run start:tunnel
```

- **clean-ports** frees 8081 and 8082.
- **start:tunnel** starts Expo with tunnel. Do **not** type `npx expo` — use this script.

---

## If you're in a different directory

| Where you are | What to run |
|---------------|-------------|
| **Ploop** (parent of mobile) | `npm run clean-ports && npm run start:mobile:tunnel` (Ploop has these scripts) |
| **Ploop/mobile** | `npm run clean-ports` then `npm run start:tunnel` |
| **Repo root** (quantum-webscraper) | `cd Ploop/mobile && npm run clean-ports && npm run start:tunnel` |

From repo root there is no `clean-ports` script — you must `cd Ploop/mobile` (or `cd Ploop`) first.

---

## Why "404 Not Found - sxpo" happens

If you see:

```
404 Not Found - GET https://registry.npmjs.org/sxpo - Not found
```

you ran something like `npx sxpo satrt` instead of `npx expo start`. Use the npm scripts instead: **`npm run start:tunnel`** from Ploop/mobile (no typing the command).

---

## Android: "Failed to download remote update" (java.io.IOException)

Expo Go on Android can't reach the dev server. Try in order:

1. **Same Wi‑Fi** — Phone and Mac on the same network (no guest/captive networks).
2. **Enter URL manually** — In Expo Go, tap "Enter URL manually" and paste the URL from the terminal (e.g. `exp://xxx.exp.direct:80`).
3. **Use LAN instead of tunnel** — From Ploop/mobile run `npm run clean-ports` then `npm run start` (no tunnel). In Expo Go, connect using the **LAN** URL shown in the terminal (e.g. `exp://192.168.x.x:8081`). Phone must be on same Wi‑Fi as Mac.
4. **Phone hotspot** — Turn on hotspot on the phone, connect the Mac to it, then run `npm run start:tunnel` and scan again.

---

## iOS/Android: "Using cached toilets" / "Error searching landmarks: timeout exceeded"

The app can't reach the **backend** (port 8082). The tunnel only serves the JS bundle; the API runs on your Mac.

1. **Start the backend** — From Ploop: `npm run start:backend` (or `cd backend && npm run dev`). Keep it running.
2. **Use your Mac’s LAN IP** — If the phone is on the **same Wi‑Fi** as the Mac, the phone cannot reach a public IP (e.g. 138.x.x.x). In `Ploop/mobile/.env` set:
   ```bash
   EXPO_PUBLIC_PLOOP_API_URL=http://YOUR_MAC_LAN_IP:8082
   ```
   Find LAN IP: `ipconfig getifaddr en0` or `ipconfig getifaddr en1` (usually **192.168.x.x** or 10.x.x.x). Use that, not a 138.x or public IP.
3. **Same Wi‑Fi** — Phone and Mac must be on the same network so the phone can reach `http://YOUR_MAC_LAN_IP:8082`.
4. **Restart Expo and reload** — Stop Expo (Ctrl+C), run `npm run start:tunnel` (or `npm run start`) again so the app gets the new env. In Metro you should see `[Ploop] API base URL: http://...`. Reload the app in Expo Go (shake → Reload).

**"Error searching landmarks" / "Search unavailable"** — Landmark search uses the backend. If the app can’t reach it, you’ll see this. Fix: same as above (set `EXPO_PUBLIC_PLOOP_API_URL` to your Mac’s LAN IP, backend running, same Wi‑Fi, restart Expo). Optional: set `GOOGLE_PLACES_API_KEY` in `backend/.env` for real Google place search; without it the backend returns preset landmarks.

**Network error across the whole app** — (1) iOS and Android are configured to allow HTTP to the local network. (2) Set `EXPO_PUBLIC_PLOOP_API_URL=http://YOUR_MAC_LAN_IP:8082` in `mobile/.env`. (3) Restart Expo **with cache clear** so the URL is in the bundle: `npx expo start --clear` or `npx expo start --clear --tunnel`. (4) Backend running; phone and Mac on same Wi‑Fi.
