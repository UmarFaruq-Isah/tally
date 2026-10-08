// auth.js — Passport + Google OAuth (your original file, hardened).
// It only *configures* Passport. The /api/auth/* routes live in routes/auth.js.
import 'dotenv/config';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { pool, seedDefaultLists } from './db.js';

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');

/** False when the Google keys are missing (the site still runs; /api/auth/google answers 503). */
export const googleEnabled = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);

/**
 * Finds the user for a Google profile, or creates them (with their default lists).
 * Exported so it can be tested without talking to Google.
 */
export async function findOrCreateUser(profile) {
  const first = profile.emails && profile.emails[0];
  if (!first || !first.value) throw new Error('Your Google account did not share an email address.');
  if (first.verified === false) throw new Error('Your Google email address is not verified.');
  const email = first.value.toLowerCase();
  const name = profile.displayName || email.split('@')[0];
  const googleId = String(profile.id);

  // 1) Returning user
  const found = await pool.query('SELECT * FROM users WHERE google_id=$1', [googleId]);
  if (found.rows[0]) return found.rows[0];

  // 2) New user, or an existing row with the same email that has no google_id yet (links it).
  const r = await pool.query(
    `INSERT INTO users (google_id, email, name, provider) VALUES ($1,$2,$3,'google')
     ON CONFLICT (email) DO UPDATE
       SET google_id = COALESCE(users.google_id, EXCLUDED.google_id),
           name = COALESCE(users.name, EXCLUDED.name)
     RETURNING *`,
    [googleId, email, name],
  );
  const user = r.rows[0];
  // Same email but already tied to a different Google account: never sign into someone else's data.
  if (user.google_id !== googleId) throw new Error('That email is already linked to another Google account.');
  await seedDefaultLists(user.id);
  return user;
}

if (googleEnabled) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        // Absolute URL: a relative one breaks behind Render's proxy (Google would get http://...).
        // It must be listed under "Authorized redirect URIs" in the Google Cloud console.
        callbackURL: `${BASE_URL}/api/auth/google/callback`,
        proxy: true,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          done(null, await findOrCreateUser(profile));
        } catch (err) {
          done(err, null);
        }
      },
    ),
  );
} else if (process.env.NODE_ENV === 'production') {
  throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in production.');
} else {
  console.warn('Google sign-in is disabled: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set.');
}

// Serialize/deserialize user for the session
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id=$1', [id]);
    done(null, result.rows[0] || false); // false = user was deleted, drop the session quietly
  } catch (err) {
    done(err, null);
  }
});
