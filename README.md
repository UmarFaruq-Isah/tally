# Tally

```
index.html      landing page (also what GitHub Pages serves)
Frontend/       pages, css, js
Backend/        Express + PostgreSQL API. It ALSO serves index.html and Frontend/, so the whole app is one deployment.
render.yaml     one-click Render setup
```

## Run it locally

```bash
cd Backend
npm install
cp .env.example .env        # fill in DATABASE_URL, SESSION_SECRET (and the Google keys when you have them)
npm run dev                 # http://localhost:3000
```
Tables are created automatically on start (`schema.sql` is idempotent; or run `npm run db:init`).

No Google keys yet? `npm run dev:stub` runs the real app with a **fake login** ("Dev User"), so you can use everything. It refuses to run in production.
Tests (17, need a throwaway Postgres): `TEST_DATABASE_URL=postgresql://… npm test`

## Deploy (about 15 minutes)

**1. Database (Supabase).** Create a project → *Connect* → copy the **Session pooler** connection string (the direct one is IPv6-only).
Replace `[YOUR-PASSWORD]`; URL-encode special characters in it (`@` → `%40`). You don't need to run any SQL: the server creates the tables on first start.

**2. Google Cloud console** → your OAuth client → *Authorized redirect URIs*. **The path changed** from `/auth/google/callback` to:
```
http://localhost:3000/api/auth/google/callback
https://<your-service>.onrender.com/api/auth/google/callback      (add after step 3)
```

**3. Render.** Push this repo to GitHub → Render → *New → Blueprint* → select the repo (it reads `render.yaml`). Fill in:
`DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BASE_URL` (`https://<service-name>.onrender.com`). `SESSION_SECRET` is generated for you.
Open the URL. Check `/api/health` returns `{"ok":true}`. Free instances sleep when idle: the first request afterwards takes ~30–60 s.

**4. GitHub Pages (optional demo).** Pages can only host static files, so it runs as a **guest-only demo** (tasks stay in the visitor's browser).
To make its "Sign in with Google" button send people to the real app, set this in `Frontend/js/api.js` and push:
```js
APP_URL: 'https://<your-service>.onrender.com'
```

## What I fixed in your `server.js` and `auth.js`

| Problem | Fix |
|---|---|
| Redirect after login was `Frontend/dashboard.html` (relative, so it resolved to `/auth/google/Frontend/...`) | `/Frontend/dashboard.html` |
| `failureRedirect: "/login"` had no route | `/Frontend/login.html` |
| `MemoryStore` sessions: lost on every restart/deploy, leaks memory | sessions stored in Postgres (`session` table) |
| No `trust proxy`, no secure cookies: login breaks behind Render | `trust proxy`, `httpOnly` + `secure` + `sameSite=lax` cookies |
| `SESSION_SECRET` could be `undefined` | server refuses to start in production without it |
| Relative `callbackURL`, no `proxy: true`: Google gets an `http://` URL on Render | `BASE_URL + /api/auth/google/callback`, `proxy: true` |
| `auth.js` created its own `Pool` with no SSL (Supabase rejects it) | one shared pool (`db.js`) with SSL |
| Same email under a different `google_id` crashed on the unique constraint | links the account safely; refuses if the email belongs to another Google account |
| Deleted user + live cookie → deserialize error | quietly signs them out |
| `/auth/me` returned `{error}`, port hardcoded to 3000, no JSON parsing, no lists/tasks routes | `{message}`, `PORT` env, full API under `/api` |
| `GET /logout` (any site can log you out via an image tag) | `POST /api/auth/logout` |
| Missing Google keys crashed on boot | dev: warns and continues; production: refuses to start |

Your Passport setup is still in `auth.js`; the `/api/auth/*` routes moved to `routes/auth.js`.
Only `index.html` and `Frontend/` are public. `Backend/` (and any `.env`) is never served (tested).

## Troubleshooting
| Symptom | Check |
|---|---|
| `redirect_uri_mismatch` from Google | the URI in step 2 must match `BASE_URL` + `/api/auth/google/callback` exactly |
| Login bounces back to the login page | `BASE_URL` is `https://…` and `NODE_ENV=production` (secure cookie needs HTTPS) |
| Server exits at start: "Could not connect to the database" | `DATABASE_URL` (use the Session pooler string; password URL-encoded) |
| Everything is slow once in a while | Render free tier waking up |
| "Google sign-in is not configured" (503) | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` missing |
