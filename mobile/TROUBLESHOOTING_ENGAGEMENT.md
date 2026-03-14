# Troubleshooting Report: Engagement Features

Deep-level analysis and fixes applied to the engagement changes.

---

## Issues Found & Fixed

### 1. **LoadingWithTrivia – Animation Loop After Unmount** ✅ FIXED

**Problem:** The loading bar animation recursively calls `loop()` when each cycle finishes. If the component unmounts during loading (e.g. quick load or navigation), the callback could still run and call `loop()`, causing:
- Memory leaks
- Updates to unmounted component state
- Potential crashes

**Fix:** Added a `cancelled` flag that is set in the cleanup function. The animation callback checks `cancelled` before recursively calling `loop()`.

```tsx
// Before: loop() could run after unmount
// After: cancelled = true prevents loop from continuing
```

---

### 2. **StartScreen – Tap Timeout Leak** ✅ FIXED

**Problem:** `tapTimeoutRef` schedules a timeout to reset tap count. If the user navigates away before the timeout fires, the callback would run on an unmounted component and call `setTapCount(0)` and `setTapMessage(null)`, triggering a React warning and possible issues.

**Fix:** Added a `useEffect` cleanup that clears the timeout on unmount.

---

### 3. **YouAreHereContext – Unnecessary Re-renders** ✅ FIXED

**Problem:** The context `value` object was created on every render. Since the Provider re-renders often, all consumers re-rendered even when nothing changed.

**Fix:** Wrapped the context value in `useMemo` with proper dependencies so it only changes when `lastViewedToilet`, `dismissedYouAreHere`, or `dismissedPostUse` change.

---

### 4. **MapScreen.web – Banner Scrolls Away** ✅ FIXED

**Problem:** `YouAreHerePromptBanner` was inside the `ScrollView`. With `position: absolute`, it was positioned relative to the scroll content, so it scrolled away with the page.

**Fix:** Moved the banner outside the `ScrollView` so it is a sibling. It now overlays the content and stays fixed while the user scrolls.

---

### 5. **YouAreHerePromptBanner – Hardcoded Top Position** ✅ FIXED

**Problem:** `top: 80` was hardcoded. On devices with notches or different status bar heights, the banner could overlap the status bar or other UI.

**Fix:** Switched to `useSafeAreaInsets()` and set `top: Math.max(insets.top, 8) + 60` so the banner respects safe areas.

---

### 6. **YouAreHerePrompt – Post-use Dismiss State** ✅ FIXED

**Problem:** When the user dismissed the post-use prompt and stayed far away, the effect’s fall-through only ran `setShowPostUse(false)` when `dist < LEFT_M`. When `dist > LEFT_M` and the prompt was dismissed, `showPostUse` was never set to false, so the banner could stay visible.

**Fix:** Always call `setShowPostUse(false)` in the fall-through branch so the banner is hidden whenever we are not explicitly showing it.

---

## Verified as Correct

### LoadingWithTrivia
- `barAnim` ref is stable across renders
- Trivia delay (800ms) avoids flashing on fast loads
- `context` prop is only used for the initial message; loading screens are usually short-lived

### StartScreen Emoji Tap
- `Animated.sequence` runs once per press; no cleanup needed
- `tapCount` reset logic is correct
- Messages only appear at 5, 8, 10, 15, 20 taps

### YouAreHereContext
- `dismissedYouAreHere` and `dismissedPostUse` use new `Set` instances on update, so effect dependencies work
- `setLastViewedToilet(null)` is never called; last viewed toilet stays until the next view

### useYouAreHerePrompt
- `wasNearRef` correctly accumulates toilet IDs
- Distance thresholds (40m, 50m, 100m) are applied in the right order
- `ctx` null is handled when outside the provider

### Haptic Feedback
- `hapticSuccess` / `hapticLight` wrapped in try/catch; safe on web
- Success flows call haptics before navigation or alerts

---

## Edge Cases to Watch

1. **Location updates on web:** MapScreen.web uses `coords` from `tryUserLocation`. There is no continuous location watch, so “you’re here” may not appear until the user refreshes or the page gets a new location.

2. **Deep link to ToiletDetails:** If the user opens `/toilet/:id` directly, `setLastViewedToilet` runs when the toilet loads. “You’re here” will work once they return to the map with location enabled.

3. **LocationReviewScreen:** When adding a toilet from the map, the user goes through LocationReviewScreen, not ToiletDetailsScreen. `lastViewedToilet` is not set there, so “you’re here” does not apply for newly added toilets until they open ToiletDetails for that toilet.

4. **MapScreenFallback:** The fallback list-only screen does not render the YouAreHere prompt. Consider adding it if this screen is used often.

---

## Files Modified in This Troubleshoot

- `src/components/LoadingWithTrivia.tsx` – animation cleanup
- `src/components/YouAreHerePrompt.tsx` – SafeAreaInsets, dismiss logic
- `src/context/YouAreHereContext.tsx` – memoized value
- `src/screens/StartScreen.tsx` – timeout cleanup
- `src/screens/MapScreen.web.tsx` – banner moved outside ScrollView
