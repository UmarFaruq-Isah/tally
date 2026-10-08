/**
 * Runs the real API + website with a FAKE login, so you can click through the whole app before
 * Google sign-in is set up.   npm run dev:stub   then open http://localhost:3000
 *   - you are already "signed in" as dev@tally.local
 *   - Settings -> Sign out really signs you out; "Sign in with Google" signs you back in
 * Never runs in production.
 */
import 'dotenv/config';
import express from 'express';
import { pool, initSchema } from '../db.js';
import { createApp } from '../app.js';

if (process.env.NODE_ENV === 'production') { console.error('dev-server is for development only.'); process.exit(1); }
await initSchema();

let signedIn = true;
const r = express.Router();
r.use(async (req, res, next) => {
  if (!signedIn) return next();
  const u = await pool.query(
    `insert into users (email, name, provider) values ('dev@tally.local','Dev User','stub')
     on conflict (email) do update set name = excluded.name returning id, email, name, provider`);
  req.user = u.rows[0]; next();
});
r.get('/auth/google', (req, res) => { signedIn = true; res.redirect('/Frontend/dashboard.html'); });
r.get('/auth/me', (req, res) => (req.user ? res.json(req.user) : res.status(401).json({ message: 'Not signed in' })));
r.post('/auth/logout', (req, res) => { signedIn = false; res.json({ ok: true }); });

const port = process.env.PORT || 3000;
createApp({ authRouter: r, useSession: false }).listen(port, () => console.log(`Stub-login server on http://localhost:${port}`));
