# Global Toilet Import

Imports public toilet locations from multiple open data sources into the Ploop database for 17 major cities worldwide.

## Data Sources

| Source | Coverage | License |
|--------|----------|---------|
| OpenStreetMap (Overpass API) | All 17 cities | ODbL |
| Refuge Restrooms API | US cities (NYC, LA, SF, Chicago) | Free / Open |
| Toilet Map UK | London | CC BY 4.0 |
| Google Places API | Hotels + malls for rating | Paid (API key) |

## Cities

Singapore, Tokyo, Seoul, Hong Kong, Bangkok, Dubai, Kuala Lumpur, Jakarta, Sydney, New York, Los Angeles, San Francisco, Chicago, London, Paris, Berlin, Amsterdam.

## Rating Heuristics

- Toilets within ~100 m of a **5-star hotel**: 4.5 cleanliness / 4.5 smell
- Toilets within ~100 m of a **4-star hotel or shopping mall**: 4.0 / 4.0
- All others use a city-level safety index (Numbeo 2025):
  - Safety 75+: 3.5 (Dubai, HK, Singapore, Tokyo, Seoul)
  - Safety 60-75: 3.0 (Amsterdam, Sydney, Bangkok)
  - Safety 45-60: 2.5 (Berlin, NYC, Jakarta, LA)
  - Safety 30-45: 2.0 (London, Paris, KL, SF, Chicago)

## Bidet Marking

- `has_bidet = true` only for OSM entries tagged `toilets:bidet=yes`
- All others: `null` (unknown) — users confirm via in-app reviews

## Usage

```bash
cd backend

# Preview without writing to DB
npx ts-node scripts/import-global-toilets.ts --dry-run

# Import one city
npx ts-node scripts/import-global-toilets.ts --city=tokyo

# Import all cities (skip hotel/mall lookup)
npx ts-node scripts/import-global-toilets.ts --skip-places

# Full import with hotel/mall ratings
npx ts-node scripts/import-global-toilets.ts
```

## Environment Variables

- `DATABASE_URL` or `DB_HOST` / `DB_NAME` / `DB_USER` / `DB_PASSWORD`
- `GOOGLE_PLACES_API_KEY` — for hotel/mall proximity lookup (optional with `--skip-places`)

## Duplicate Handling

Toilets within ~20 m of an existing record are treated as matches:
- `has_bidet` and `wheelchair_accessible` are merged (OR logic)
- One review is added per matched toilet per script run
- No duplicate toilet rows are created
