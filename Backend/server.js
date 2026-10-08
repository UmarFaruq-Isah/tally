// server.js — entry point.   npm start  (production)   |   npm run dev  (auto-restart)
import 'dotenv/config';
import { createApp } from './app.js';
import './auth.js';                        // registers the Google strategy + session (de)serializers with Passport
import authRouter from './routes/auth.js';
import { initSchema, pool } from './db.js';

const port = process.env.PORT || 3000;

try {
  if (process.env.AUTO_MIGRATE !== 'false') await initSchema();   // creates tables on first run, no-op afterwards
  await pool.query('select 1');                                  // fail fast with a clear message if the DB is unreachable
} catch (e) {
  console.error('Could not connect to the database. Check DATABASE_URL.\n', e.message);
  process.exit(1);
}

const server = createApp({ authRouter }).listen(port, () => console.log(`Tally running on port ${port}`));

// Render sends SIGTERM on every deploy: finish in-flight requests, then exit.
process.on('SIGTERM', () => server.close(() => pool.end().then(() => process.exit(0))));
