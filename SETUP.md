# Ploop Setup Guide

## Prerequisites

1. **Node.js** (v18 or higher)
2. **PostgreSQL** (v14 or higher) with PostGIS extension
3. **React Native development environment**
   - For iOS: Xcode and CocoaPods
   - For Android: Android Studio and Android SDK

## Database Setup

1. **Install PostgreSQL with PostGIS**:
   ```bash
   # macOS (using Homebrew)
   brew install postgresql postgis
   
   # Ubuntu/Debian
   sudo apt-get install postgresql postgresql-contrib postgis
   ```

2. **Create database**:
   ```bash
   createdb ploop
   ```

3. **Enable PostGIS extension**:
   ```bash
   psql ploop -c "CREATE EXTENSION IF NOT EXISTS postgis;"
   ```

4. **Run schema migration**:
   ```bash
   cd database
   psql ploop -f schema.sql
   ```

## Backend Setup

1. **Navigate to backend directory**:
   ```bash
   cd backend
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment**:
   ```bash
   cp env.example .env
   # Edit .env with your database credentials
   ```

4. **Create uploads directory**:
   ```bash
   mkdir -p uploads
   ```

5. **Start the server**:
   ```bash
   npm run dev
   ```

   The API will be available at `http://localhost:3000`

## Mobile App Setup

1. **Navigate to mobile directory**:
   ```bash
   cd mobile
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure API endpoint** (if needed):
   Edit `src/config/api.ts` and update `API_BASE_URL` if your backend is not running on `localhost:3000`

4. **For iOS**:
   ```bash
   cd ios
   pod install
   cd ..
   npm run ios
   ```

5. **For Android**:
   ```bash
   npm run android
   ```

## Testing the Setup

1. **Backend Health Check**:
   ```bash
   curl http://localhost:3000/health
   ```
   Should return: `{"status":"ok","timestamp":"..."}`

2. **Test API Endpoint**:
   ```bash
   curl "http://localhost:3000/api/toilets?latitude=37.7749&longitude=-122.4194&radius=1000"
   ```
   Should return an empty array initially: `{"toilets":[],"count":0}`

## Google Maps API Setup (Required for Maps)

1. **Get Google Maps API Key**:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing
   - Enable "Maps SDK for Android" and "Maps SDK for iOS"
   - Create API key

2. **For Android**:
   - Add to `mobile/android/app/src/main/AndroidManifest.xml`:
     ```xml
     <meta-data
       android:name="com.google.android.geo.API_KEY"
       android:value="YOUR_API_KEY"/>
     ```

3. **For iOS**:
   - Add to `mobile/ios/Ploop/AppDelegate.mm`:
     ```objc
     [GMSServices provideAPIKey:@"YOUR_API_KEY"];
     ```

## Troubleshooting

### Database Connection Issues
- Verify PostgreSQL is running: `pg_isready`
- Check credentials in `.env` file
- Ensure PostGIS extension is installed: `psql ploop -c "\dx"`

### Mobile App Issues
- Clear cache: `npm start -- --reset-cache`
- Reinstall dependencies: `rm -rf node_modules && npm install`
- For iOS: Clean build folder in Xcode

### Port Already in Use
- Change PORT in backend `.env` file
- Update `API_BASE_URL` in mobile `src/config/api.ts`

## Next Steps

1. Add your first toilet through the mobile app
2. Test duplicate detection by trying to add the same toilet twice
3. Upload photos for toilets
4. Submit reviews to see score calculations

## Phase 2 Preparation

When ready for Phase 2, you'll need to:
- Set up WebSocket server for real-time updates
- Implement push notifications
- Add payment processing for tips/subscriptions
- Set up analytics for data sales


