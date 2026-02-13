# Backend connectivity troubleshooting

When "nothing can reach the backend" even though it's running, try these steps.

**Note:** The app uses automatic retries (3x with backoff) for network errors. See `INFRASTRUCTURE.md` for the full architecture.

## 1. Test from your Mac

```bash
curl http://localhost:8082/health
```

- **If it works** → Backend is reachable from your machine. The issue is the app/simulator/device.
- **If it fails** → Backend might not be running, or something is wrong with the server.

## 2. Try a different port (port 8082 may be blocked)

Some networks, VPNs, or firewalls block port 8082.

**Backend** – create or edit `backend/.env`:
```
PORT=3000
```

**Mobile** – edit `mobile/.env`:
```
EXPO_PUBLIC_PLOOP_API_URL=http://localhost:3000
EXPO_PUBLIC_PLOOP_USE_LOCALHOST=true
```

For a physical device, use your Mac's IP:
```
EXPO_PUBLIC_PLOOP_API_URL=http://YOUR_MAC_IP:3000
```

Restart backend and Expo.

## 3. macOS Firewall

If the backend works with `curl localhost` but not from a physical device:

1. **System Settings** → **Network** → **Firewall**
2. **Options** → ensure **Node** or **node** is allowed for incoming connections
3. Or temporarily turn the firewall off to test

## 4. iOS Simulator

The simulator runs on your Mac, so it should reach `localhost`. If it doesn’t:

- Set `EXPO_PUBLIC_PLOOP_USE_LOCALHOST=true` in `mobile/.env`
- Restart Expo
- Test with port 3000 if 8082 still fails

## 5. Physical device on same Wi‑Fi

- Mac and phone must be on the same Wi‑Fi
- Get your Mac’s IP: `ipconfig getifaddr en0`
- In `mobile/.env`:  
  `EXPO_PUBLIC_PLOOP_API_URL=http://YOUR_IP:8082`  
  (or `:3000` if using `PORT=3000`)

## 6. Verify backend is listening

When the backend starts, you should see:
```
🚽 Ploop API server running on port 8082
(Listening on all interfaces so your phone can connect when on the same Wi‑Fi)
```

It listens on `0.0.0.0`, so it should accept connections from other devices on the network.
