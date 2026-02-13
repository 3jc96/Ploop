# Ploop Quick Start Guide

## 🚀 Get Started in 5 Minutes

### 1. Database Setup (2 minutes)

**Note:** Ploop uses PostgreSQL 17 (PostGIS requires PostgreSQL 17/18)

```bash
# Make sure PostgreSQL 17 is running
brew services start postgresql@17

# Add to PATH if not already there (add to ~/.zshrc)
export PATH="/usr/local/opt/postgresql@17/bin:$PATH"

# Create database
createdb ploop

# Enable PostGIS
psql ploop -c "CREATE EXTENSION IF NOT EXISTS postgis;"

# Run schema
cd database
psql ploop -f schema.sql
cd ..
```

### 2. Backend Setup (1 minute)
```bash
cd backend
npm install
cp env.example .env
# Edit .env with your DB credentials
mkdir -p uploads
npm run dev
```

### 3. Mobile App Setup (2 minutes)
```bash
# In a new terminal
cd mobile
npm install

# For iOS
cd ios && pod install && cd ..
npm run ios

# For Android
npm run android
```

## ✅ Verify It Works

1. Open the mobile app
2. Grant location permissions
3. Tap "+ Add Toilet"
4. Fill in the form and submit
5. See your toilet on the map!

## 📝 Notes

- Backend runs on `http://localhost:3000`
- Make sure PostgreSQL is running
- For production, update API URLs in `mobile/src/config/api.ts`
- Google Maps API key required for maps (see SETUP.md)

## 🐛 Common Issues

**"Cannot connect to database"**
- Check PostgreSQL is running: `pg_isready`
- Verify credentials in `backend/.env`

**"Location not available"**
- Grant location permissions in device settings
- For iOS simulator: Features > Location > Custom Location

**"Maps not showing"**
- Add Google Maps API key (see SETUP.md)
- For Android: Update AndroidManifest.xml
- For iOS: Update AppDelegate.mm

