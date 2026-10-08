import express from 'express';
import requireAuth from '../middleware/requireAuth.js';
import lists from './lists.js';
import tasks from './tasks.js';

/** Everything mounted under /api. `authRouter` supplies /auth/google, /auth/me, /auth/logout. */
export default function buildRoutes(authRouter) {
  const r = express.Router();
  r.get('/health', (req, res) => res.json({ ok: true }));   // Render health check (no DB hit)
  r.use(authRouter);
  r.use(['/lists', '/tasks'], requireAuth);
  r.use(lists);
  r.use(tasks);
  r.use((req, res) => res.status(404).json({ message: 'Not found' }));
  return r;
}
