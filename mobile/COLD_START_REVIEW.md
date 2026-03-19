# Cold Start Review: Time to Full Display / reportFullyDrawn

This document reviews the app’s cold start flow and how to measure and optimize time to full display (Android `reportFullyDrawn`).

---

## Current Boot Flow (Sequential)

```
Native launch → RN bridge → JS bundle
    ↓
SplashSoundGate     ← BLOCKS: ploop sound (AsyncStorage + expo-av + load + play, up to 2s)
    ↓
LanguageProvider    ← BLOCKS: AsyncStorage + FileSystem (or shows picker if first run)
    ↓
MapProvider         ← AsyncStorage (non-blocking)
    ↓
AppLoadingGate      ← BLOCKS: Location permission + getLastKnownPositionAsync / getCurrentPositionAsync + API fetch
    ↓
AuthProvider        ← refreshUser() on mount (non-blocking for children)
    ↓
NavigationContainer
    ↓
MapScreen (lazy)    ← React.lazy + Suspense → loads MapScreenWrapper
    ↓
Map fully rendered  ← "Time to full display"
```

---

## Bottlenecks (Estimated Impact)

| Phase | Blocks? | Typical Time | Notes |
|-------|---------|--------------|-------|
| **SplashSoundGate** | Yes | 0.5–2s | AsyncStorage, Audio.setAudioModeAsync, Sound.createAsync, playback. 2s timeout. |
| **LanguageProvider** | Yes | 50–200ms | AsyncStorage + FileSystem. Shows loading spinner until ready. |
| **AppLoadingGate** | Yes | 1–6s | Location (lastKnown ~50ms, currentPosition 2–6s), API 0.5–2s. Android uses fallback coords when lastKnown null. |
| **MapScreen lazy** | Yes | 100–500ms | First load of MapScreenWrapper + map libs. |
| **AuthProvider** | No | ~0 | Children render; refreshUser runs in background. |

---

## reportFullyDrawn (Android)

`Activity.reportFullyDrawn()` tells Android the app is fully drawn and ready for interaction. It affects:

- **Firebase Test Lab** and Play Console startup metrics
- **Vitals** (startup time, ANRs)
- **Perfetto / systrace** traces

### How to Use It

1. **When to call**  
   Call when the first meaningful, interactive screen is visible (e.g. map with pins).

2. **Implementation**  
   Use a native module that calls `activity.reportFullyDrawn()` from Kotlin/Java. Expo does not provide this out of the box.

3. **Example native module (Kotlin)**  
   In `MainActivity.kt` or a custom module:

   ```kotlin
   // In a React Native native module
   (activity as? Activity)?.reportFullyDrawn()
   ```

4. **Where to call from JS**  
   Call it when `AppLoadingGate` finishes and the Map screen has rendered its first frame (e.g. from `MapScreen` or a shared “app ready” hook).

---

## Optimization Recommendations

### 1. **SplashSoundGate – Don’t Block on Sound (High Impact)**

**Current:** App waits for ploop sound to finish before showing anything.

**Change:** Play sound in the background and render the app immediately. Use `playPloopSoundIfEnabled()` (fire-and-forget) instead of `playPloopSoundAndWait()`.

**Effect:** Saves ~0.5–2s on cold start.

---

### 2. **LanguageProvider – Avoid Blocking on First Render (Medium Impact)**

**Current:** Shows loading spinner until AsyncStorage returns. First-time users see picker, but returning users wait 50–200ms.

**Change:** Default to `localeStatus: 'ready'` with `locale: 'en'`, load persisted locale in the background, and update when ready. Only show picker when `needsPick` (first run).

**Effect:** Saves ~50–200ms for returning users.

---

### 3. **Use expo-splash-screen Correctly (Medium Impact)**

**Current:** Native splash is used, but there’s no explicit `preventAutoHideAsync` / `hideAsync` control.

**Change:**  
- Call `SplashScreen.preventAutoHideAsync()` at app entry (before first render).  
- Call `SplashScreen.hideAsync()` when the first meaningful content is ready (e.g. when AppLoadingGate shows its loading UI or when the map is ready).

**Effect:** Smoother perceived startup; native splash stays visible until JS is ready.

---

### 4. **Preload MapScreen (Low–Medium Impact)**

**Current:** MapScreen is lazy-loaded; first navigation triggers load.

**Change:** Eagerly import MapScreen at app init, or preload it after the initial route is known. Reduces Suspense delay when navigating to Map.

**Effect:** Saves ~100–500ms when Map first appears.

---

### 5. **Add reportFullyDrawn for Measurement (Low Impact, High Value for Metrics)**

**Change:** Add a small native module that calls `reportFullyDrawn()`, and invoke it from JS when the map is fully rendered (e.g. when MapScreen has shown toilets and map is interactive).

**Effect:** Enables accurate cold start metrics in Play Console and Firebase.

---

### 6. **Extend Load Diagnostics to Include Full Boot**

**Current:** Load diagnostics cover permission → location → API inside AppLoadingGate.

**Change:** Add timestamps for:
- App component mount
- SplashSoundGate ready
- LanguageProvider ready
- AppLoadingGate ready
- MapScreen first paint

**Effect:** Clear visibility into where time is spent during cold start.

---

## Measuring Cold Start Today

1. **Load diagnostics (existing)**  
   In dev, check Metro for `[Ploop Load]` logs (permission, location, API, total).

2. **Android Studio Profiler**  
   Use CPU / trace to see native + JS startup.

3. **Perfetto**  
   Record a trace from app launch; inspect `create_react_co`, `mqt_native_modu`, and JS execution.

4. **adb**  
   ```bash
   adb shell am start -W -n com.ploop.app/.MainActivity
   ```
   Reports `TotalTime`, `WaitTime`, etc.

---

## Implemented (Feb 2025)

1. **SplashSoundGate** – Now plays sound in background; app renders immediately (~0.5–2s saved).
2. **expo-splash-screen** – `preventAutoHideAsync()` at app load, `hideAsync()` after first frame.
3. **LanguageProvider** – Starts with `ready` + `en`; loads persisted locale async; no blocking spinner.

## Remaining

4. **reportFullyDrawn** – Add native module and call when map is ready.
5. **Boot diagnostics** – Add timestamps for each gate.
