# Deploy Ploop Backend to Render (GitHub + Render)

Step-by-step guide to upload Ploop to GitHub and deploy the backend on Render.

---

## Step 1: Create a new GitHub repo

1. Go to [github.com/new](https://github.com/new)
2. **Repository name:** `ploop` (or `ploop-app`)
3. **Visibility:** Private or Public
4. **Do NOT** initialize with README, .gitignore, or license (we already have these)
5. Click **Create repository**

---

## Step 2: Push Ploop to GitHub

Open Terminal and run:

```bash
cd /Users/joelchu/quantum-webscraper/Ploop

# If mobile/ had its own git repo, remove it so mobile is part of Ploop
rm -rf mobile/.git

# Initialize git (if not already)
git init

# Add everything (excluding .env via .gitignore)
git add .
git commit -m "Initial commit: Ploop toilet finder app"

# Add your GitHub repo (replace USERNAME/ploop with your repo URL)
git remote add origin https://github.com/USERNAME/ploop.git

# Push
git branch -M main
git push -u origin main
```

Replace `USERNAME/ploop` with your actual GitHub username and repo name (e.g. `jcrs96/ploop`).

---

## Step 3: Log in to Render and connect GitHub

1. Go to [render.com](https://render.com) and sign up or log in
2. Click **Sign in with GitHub** and authorize Render to access your repos
3. You’ll be taken to the Render dashboard

---

## Step 4: Deploy with Blueprint

1. In Render dashboard, click **New +** → **Blueprint**
2. Connect your GitHub account if prompted
3. Select the **ploop** repo (or the repo where you pushed Ploop)
4. Render reads `render.yaml` and creates:
   - **ploop-db** – PostgreSQL database
   - **ploop-api** – Node.js web service
5. Click **Apply**
6. Wait for the deploy to complete (about 2–5 minutes)

---

## Step 5: Add secret environment variables

After the first deploy:

1. Go to **Dashboard** → **ploop-api** → **Environment**
2. Add these variables (from your local `backend/.env`):

| Key | Value |
|-----|-------|
| `JWT_SECRET` | At least 32 random characters (for auth) |
| `GOOGLE_CLIENT_ID` | Your Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Your Google OAuth client secret |
| `GOOGLE_PLACES_API_KEY` | Your Google Places API key |
| `ADMIN_EMAILS` | `rubiks.bb@gmail.com` (or your admin email) |

3. Click **Save Changes** – Render will redeploy with the new vars.

---

## Step 6: Get your API URL

1. In Render, open **ploop-api**
2. Copy the URL (e.g. `https://ploop-api.onrender.com`)
3. Test it: `curl https://ploop-api.onrender.com/health`

---

## Step 7: Use this URL for TestFlight

For your TestFlight build, set:

```bash
EXPO_PUBLIC_PLOOP_API_URL=https://ploop-api.onrender.com eas build --profile production --platform ios
```

Or add `EXPO_PUBLIC_PLOOP_API_URL=https://ploop-api.onrender.com` to `mobile/.env` before building (for production builds).

---

## Troubleshooting

**Database connection fails**
- Wait a few minutes after the first deploy – the DB may still be provisioning
- Confirm `DATABASE_URL` is set (Render sets it when using the Blueprint)

**Cold starts**
- Render free tier spins down after inactivity; the first request may take 30–60 seconds

**CORS errors**
- The backend allows `*.onrender.com` and common dev origins. For a custom domain, add it via `CORS_ORIGIN` in the ploop-api environment.
