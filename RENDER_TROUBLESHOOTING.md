# Render "Create Web Service Failed" – Troubleshooting

## Quick fixes to try

### 1. Use the correct repo

Render must be connected to the **Ploop** repo (e.g. `3jc96/Ploop`), not the parent `quantum-webscraper` folder.

- If the repo root is `quantum-webscraper`, set **Blueprint Path** to `Ploop/render.yaml`
- If the repo is `3jc96/Ploop`, the default `render.yaml` at the root is correct

### 2. Try manual deployment (skip Blueprint)

If Blueprint keeps failing, create the database and web service manually:

1. **Create database**
   - In Render: **New +** → **PostgreSQL**
   - Name: `ploop-db`
   - Region: Oregon
   - Plan: Free
   - Create

2. **Create web service**
   - **New +** → **Web Service**
   - Connect repo: **3jc96/Ploop**
   - **Root Directory:** `backend`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
   - **Environment:** Add `DATABASE_URL` → paste the **Internal Database URL** from ploop-db
   - Add `NODE_ENV` = `production`
   - Add `PORT` = `3000` (or leave default)
   - Create Web Service

3. **Add secrets**
   - After the first deploy, go to **Environment** and add:
     - `JWT_SECRET` (32+ chars)
     - `GOOGLE_PLACES_API_KEY`
     - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (if using Google Sign-In)
     - `ADMIN_EMAILS`

### 3. Check the error message

In Render Dashboard:

- **Blueprint** → **Events** or **Logs** for the exact error
- **ploop-api** service → **Logs** tab for build errors

Common errors:

| Error | Fix |
|-------|-----|
| "plan no such plan free" | Remove `plan: free` or use `plan: starter` |
| "rootDir not found" | Wrong repo or root path; use `backend` as root |
| "Build failed" | Check TypeScript compiles: `cd backend && npm run build` |
| "Database not found" | Create the database first, then the web service |

### 4. Validate the Blueprint locally

```bash
cd Ploop
# If you have Render CLI:
render blueprints validate render.yaml
```

### 5. Simplify the Blueprint

If the Blueprint still fails, try a minimal version first (database only), then add the web service afterward.
