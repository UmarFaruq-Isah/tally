import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { pool } from './db.js';

const PgStore = connectPgSimple(session);

/** Cookie sessions stored in Postgres, so logins survive restarts and redeploys (MemoryStore does not). */
export default function sessionMiddleware() {
  const prod = process.env.NODE_ENV === 'production';
  if (!process.env.SESSION_SECRET) {
    if (prod) throw new Error('SESSION_SECRET must be set in production.');
    console.warn('SESSION_SECRET is not set: using an insecure development secret.');
  }
  return session({
    name: 'tally.sid',
    store: new PgStore({ pool, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || 'dev-only-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: prod, maxAge: 30 * 24 * 60 * 60 * 1000 },
  });
}
