# Import Toilets to Render

**Important:** The TestFlight app does **not** contain toilet data. It fetches toilets from the Render API (`https://ploop-api.onrender.com`) at runtime. If your "new toilets" aren't showing, they need to be in Render's PostgreSQL database.

## Where are your new toilets?

- **Local development:** If you added toilets while testing with a local backend + local PostgreSQL, those are in your local database—they never sync to Render.
- **Render database:** Toilets added via the app when it pointed to Render are already there.

## Sync local toilets to Render

1. **Get Render's database URL**
   - Render Dashboard → **ploop-db** → **Connect** → **External Database URL**
   - Copy the connection string (e.g. `postgres://ploop:xxx@dpg-xxx.oregon-postgres.render.com/ploop`)

2. **Run the import script**
   ```bash
   cd Ploop/backend
   SOURCE_DATABASE_URL=postgres://user:pass@localhost:5432/ploop \
   TARGET_DATABASE_URL=postgres://ploop:xxx@dpg-xxx.oregon-postgres.render.com/ploop \
   npm run import-toilets
   ```

3. **Verify**
   - Open the TestFlight app and pull to refresh
   - Or: `curl "https://ploop-api.onrender.com/api/toilets?latitude=YOUR_LAT&longitude=YOUR_LON&radius=5000&limit=10"`

## Add toilets directly on Render

If you don't have a local database, add toilets through the app:

1. Use the TestFlight app (or dev app pointing to Render)
2. Tap **+ Add Toilet** and add each toilet
3. They will be stored in Render's database

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "No toilets to import" | Your SOURCE_DATABASE_URL has no toilets. Add them locally first, or add via the app. |
| Connection refused | Ensure Render DB allows external connections. Use the **External** URL, not Internal. |
| Column missing | The target DB may be older. Run migrations or ensure `ensureTables` has run. |
