// Test-only auth: header "x-test-user: alice" signs the request in as alice@test.local (created on demand).
import express from 'express';
import { pool } from '../db.js';

const r = express.Router();
r.use(async (req, res, next) => {
  const who = req.get('x-test-user');
  if (who) {
    const u = await pool.query(
      `insert into users (email, name, provider) values ($1,$2,'test')
       on conflict (email) do update set name = excluded.name returning id, email, name, provider`, [who + '@test.local', who]);
    req.user = u.rows[0];
  }
  next();
});
r.get('/auth/me', (req, res) => (req.user ? res.json(req.user) : res.status(401).json({ message: 'Not signed in' })));
export default r;
