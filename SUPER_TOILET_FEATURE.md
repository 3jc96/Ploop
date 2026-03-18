# Super Toilet of the Day

Features the toilet with the highest confidence score in the user's region (city) each day.

## Design

- **Region:** City (from reverse geocoding of user location)
- **Display:** Banner on map screen (tap to view details)
- **Scope:** One per region (city)
- **Eligibility:** Min confidence 75, min 3 reviews, no active reports (super toilet pool)
- **Rotation:** Midnight in user's local timezone
- **Tiebreaker:** Random (deterministic per day)

## Backend

- **Endpoint:** `GET /api/toilets/super-toilet-of-the-day`
- **Params:** `latitude`, `longitude` (required if no city), `city` (optional), `timezone` (optional)
- **DB:** `toilets.city` column added via `ensureTables`

## Backfill

Existing toilets need `city` populated. Run:

```bash
cd Ploop/backend
npx ts-node scripts/backfill-city.ts
```

Requires `GOOGLE_PLACES_API_KEY` and `DATABASE_URL`.

## New Toilets

City is set automatically when creating a toilet (reverse geocode on insert).
