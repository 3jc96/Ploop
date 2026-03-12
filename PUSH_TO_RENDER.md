# Push to Render – Quick Guide

Deploy your latest Ploop backend changes to Render.

---

## If Render is already set up

1. **Commit and push from the Ploop folder:**

```bash
cd /Users/joelchu/quantum-webscraper/Ploop

git add .
git status   # Review changes
git commit -m "Your commit message (e.g. Add admin toilet name edit, ploop sound)"
git push origin main
```

2. **Render auto-deploys** when you push to `main`. Check:
   - [render.com](https://render.com) → **Dashboard** → **ploop-api** → **Logs**
   - Wait 2–5 minutes for the build to finish
   - Test: `curl https://ploop-api.onrender.com/health`

---

## If this is your first time

### 1. Create a GitHub repo

- Go to [github.com/new](https://github.com/new)
- Name: `ploop` (or `ploop-app`)
- Don’t add README, .gitignore, or license
- Create repository

### 2. Push Ploop to GitHub

```bash
cd /Users/joelchu/quantum-webscraper/Ploop

# Remove mobile/.git if it exists (so mobile is part of Ploop)
rm -rf mobile/.git 2>/dev/null

git init
git add .
git commit -m "Initial commit: Ploop toilet finder app"
git remote add origin https://github.com/YOUR_USERNAME/ploop.git
git branch -M main
git push -u origin main
```

Replace `YOUR_USERNAME` with your GitHub username.

### 3. Connect Render to GitHub

1. Go to [render.com](https://render.com) → **Sign in with GitHub**
2. **New +** → **Blueprint**
3. Select your **ploop** repo
4. Render reads `render.yaml` and creates **ploop-db** and **ploop-api**
5. Click **Apply** and wait for the first deploy

### 4. Add environment variables

1. **Dashboard** → **ploop-api** → **Environment**
2. Add (from your local `backend/.env`):

| Key | Value |
|-----|-------|
| `JWT_SECRET` | 32+ random characters |
| `GOOGLE_CLIENT_ID` | Your OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Your OAuth client secret |
| `GOOGLE_PLACES_API_KEY` | Your Places API key |
| `ADMIN_EMAILS` | Your admin email(s) |

3. **Save Changes** – Render redeploys automatically

### 5. Verify

```bash
curl https://ploop-api.onrender.com/health
# Should return: {"status":"ok","timestamp":"..."}
```

---

## Repo layout

Render expects the repo root to contain a `backend` folder (see `render.yaml`). If your repo is `quantum-webscraper` and Ploop lives in a subfolder:

- Set **Blueprint Path** to `Ploop/render.yaml`
- Ensure `render.yaml` has `rootDir: backend` (relative to the Blueprint path)

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Push doesn’t trigger deploy | Check Render → ploop-api → **Settings** → **Build & Deploy** → **Auto-Deploy** is on |
| 404 on admin PATCH | Redeploy so Render picks up the latest backend code |
| Cold start (30–60s) | Render free tier sleeps; first request wakes it |
| Build fails | Check **Logs**; run `cd backend && npm run build` locally |
