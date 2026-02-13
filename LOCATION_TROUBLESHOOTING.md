# Why can't the map sense my location?

Here are the usual causes and how to fix them.

---

## Desktop (browser at http://localhost:8081)

1. **You denied the prompt**  
   When the page asked “Allow location?”, you chose Block or closed it.  
   - **Fix:** Click the lock or “i” in the address bar → Site settings → Location → set to **Allow**, then refresh. Or use the in-app **“Use my location”** button.

2. **Browser requires HTTPS**  
   Many browsers only allow geolocation on secure pages (HTTPS). On **HTTP** localhost, some browsers (e.g. Firefox) will not give location.  
   - **Fix:** Use **Chrome** for local dev (it often allows HTTP on localhost), or run the app over **HTTPS** (e.g. with Expo’s HTTPS guide or a local SSL proxy).

3. **OS location is off for the browser**  
   The OS can block the browser from using location.  
   - **Fix:**  
     - **macOS:** System Settings → Privacy & Security → Location Services → turn on, and enable your browser (Chrome, Safari, etc.).  
     - **Windows:** Settings → Privacy → Location → allow for your browser.

4. **No location available**  
   Some machines (e.g. desktops without Wi‑Fi positioning) have no location.  
   - The app will fall back to **San Francisco** and still show toilets; you can search and open places in Google Maps.

---

## iOS Simulator

The simulator has **no real GPS**. You must give it a simulated location.

1. In the **Simulator** menu bar: **Features → Location**.
2. Pick one of:
   - **Apple** (Cupertino)
   - **City Run** / **City Bicycle Ride**
   - **Custom Location…** and enter latitude/longitude (e.g. 37.7749, -122.4194 for San Francisco).

After that, the map should center on that location and load nearby toilets.

---

## Physical iPhone / Android

1. When the app asks for location, tap **Allow** (or “While Using the App”).
2. If you previously denied:
   - **iOS:** Settings → Ploop → Location → **While Using the App**.
   - **Android:** Settings → Apps → Ploop → Permissions → **Location** → Allow.
3. Ensure **Location / GPS** is turned on in the device’s main settings.

---

## Summary

| Where you’re running | Most likely cause | What to do |
|---------------------|------------------|------------|
| **Desktop browser** | Permission denied or browser/OS blocking | Allow location for the site and browser; try Chrome on localhost or use HTTPS |
| **iOS Simulator**   | No simulated location set                | Simulator → Features → Location → choose a location |
| **Physical device**| Permission denied or location off       | Allow location for Ploop and enable device location |
