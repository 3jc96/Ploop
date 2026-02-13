# Setting Up Google Places API Key

## Step 1: Create API Key in Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Sign in with your Google account
3. Create a new project (or select existing one)
4. Go to **APIs & Services** > **Credentials**
5. Click **+ CREATE CREDENTIALS** > **API key**
6. Copy the API key that appears

## Step 2: Enable Required APIs

1. Go to **APIs & Services** > **Library**
2. Search for and enable these APIs:
   - **Places API**
   - **Geocoding API**
   - **Maps JavaScript API** (optional, for web if needed)

## Step 3: (Optional) Restrict API Key

For security, restrict your API key:
1. In **Credentials**, click on your API key
2. Under **API restrictions**, select **Restrict key**
3. Select: **Places API** and **Geocoding API**
4. Click **Save**

## Step 4: Add API Key to Backend

Add your API key to `backend/.env`:

```bash
GOOGLE_PLACES_API_KEY=your_actual_api_key_here
```

**Quick setup command:**
```bash
cd /Users/joelchu/quantum-webscraper/Ploop/backend
# If .env doesn't exist, copy from example
if [ ! -f .env ]; then cp env.example .env; fi
# Then edit .env and add your key
nano .env  # or use your preferred editor
```

## Step 5: Restart Backend Server

After adding the key, restart the backend server for changes to take effect.

## Testing

Once configured, when you tap on POI icons on the map, you should see:
- Place names (e.g., "Casa Cherish", "The Pal")
- Addresses
- Google ratings and reviews
- Instead of just "Location" or coordinates

## Troubleshooting

- **Still showing "Location"**: Make sure the API key is in `.env` and backend is restarted
- **API errors**: Check that Places API and Geocoding API are enabled
- **Quota exceeded**: Google provides free tier (usually sufficient for testing)


