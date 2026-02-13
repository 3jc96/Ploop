# What to Expect When the App Loads

## First Time Setup (iOS Simulator)

1. **Metro Bundler** will start in your terminal
   - Shows a QR code (ignore for simulator)
   - Shows "Metro waiting on..."

2. **iOS Simulator** will open automatically
   - May take 30-60 seconds first time
   - Looks like an iPhone on your screen

3. **App Installation**
   - Expo will build and install the app
   - Shows "Building JavaScript bundle..."
   - Takes 1-2 minutes first time

## When the App Loads

### 1. Location Permission Prompt 📍
You'll see a popup asking for location access:
- **Tap "Allow While Using App"** or "Allow Once"
- This is required to show your location on the map

### 2. Map Screen 🗺️
After granting permissions, you'll see:
- **Google Maps** view
- **Blue dot** showing your current location (or simulator location)
- **"+ Add Toilet" button** in bottom right corner
- Map is empty (no toilets added yet)

### 3. Try Adding a Toilet ➕
1. Tap the **"+ Add Toilet"** button
2. Fill in the form:
   - Name: "Test Toilet" (required)
   - Address: Optional
   - Number of stalls: Tap 1, 2, 3, or 4+
   - Toilet type: Sit, Squat, or Both
   - Toggle switches for amenities (toilet paper, soap, etc.)
   - Wheelchair accessible: Yes/No
3. Tap **"Add Toilet"** button at bottom
4. You'll see a success message
5. Go back to map - you should see a marker!

### 4. View Toilet Details 📋
- Tap on a toilet marker on the map
- See a card with toilet information
- Tap "View Details" for full info
- Can rate the toilet (cleanliness & smell)

## Testing Checklist

✅ App opens without errors
✅ Location permission prompt appears
✅ Map displays with your location
✅ "+ Add Toilet" button is visible
✅ Can open "Add Toilet" form
✅ Can submit a toilet successfully
✅ Toilet appears on map as marker
✅ Can tap marker to see details

## If Something Goes Wrong

**App won't load:**
- Check terminal for errors
- Make sure backend is running: `curl http://localhost:3000/health`
- Try stopping and restarting: Press `Ctrl+C` in terminal, then `npm run ios` again

**"Network request failed":**
- Backend might not be running
- Check: `curl http://localhost:3000/health`
- Start backend: `cd backend && npm run dev`

**Location not showing:**
- Simulator: Features > Location > Custom Location (set coordinates)
- Grant location permissions if asked again

**Map is blank:**
- This is normal if no toilets added yet
- Try adding a toilet first

## Next Steps After Testing

Once you see it working:
1. Add a few test toilets
2. Test viewing details
3. Test rating/reviewing toilets
4. Test duplicate detection (try adding same location twice)
5. Ready for Phase 2 features!


