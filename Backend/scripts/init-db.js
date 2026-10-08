// Applies schema.sql to DATABASE_URL.   npm run db:init
import { initSchema, pool } from '../db.js';
try { await initSchema(); console.log('Schema applied.'); }
catch (e) { console.error('Could not apply schema:', e.message); process.exitCode = 1; }
finally { await pool.end(); }
