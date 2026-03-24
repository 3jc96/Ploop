# Book1.pdf — Singapore bidet / toilet list

Crowd-sourced **bidet-toilet** list for Singapore. Every row is treated as a bidet location when importing. The file lives here as the canonical copy.

## Import into Postgres

Requires `GOOGLE_PLACES_API_KEY` (Geocoding API) and either **`DATABASE_URL`** or the usual **`DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD`** (same as the API). Loads `backend/.env` automatically.

From `Ploop/backend`:

```bash
# Preview extracted rows (no API / DB)
npx ts-node scripts/import-book1-bidet-pdf.ts --dry-run

# Import (geocodes each row; rate-limited). Optional: BOOK1_PDF=/path/to/Book1.pdf
npx ts-node scripts/import-book1-bidet-pdf.ts
```

Rows are inferred from `Singapore + 6-digit postal code` patterns in the PDF text. Names and flags are heuristics; review in-app after import.

If a toilet already exists within ~20 m, the script does **not** insert a second toilet. It sets **`has_bidet` to true** (whole PDF is bidet listings), **OR**s `wheelchair_accessible` when remarks suggest handicap/wheelchair/elderly, and adds **one** review per toilet per run (cleanliness **4**, smell **4**, `reviewed_by` `book1_pdf`). **`review_text`** is filled from the PDF **remarks** column (parsed from the text before the address). Source is still indicated by **`reviewed_by`** `book1_pdf`. New toilets get the same review on insert. Re-running the script adds another such review per matched toilet.
