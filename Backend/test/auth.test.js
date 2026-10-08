import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { pool, initSchema } from '../db.js';
import { findOrCreateUser, googleEnabled } from '../auth.js';
import authRoutes from '../routes/auth.js';
import { createApp } from '../app.js';

const RUN = Date.now().toString(36);
const email = (n) => `${n}${RUN}@test.local`;
const profile = (n, id, extra = {}) => ({ id, displayName: 'Person ' + n, emails: [{ value: email(n), verified: true }], ...extra });
let server, base;

before(async () => {
  await initSchema();
  // Real session store + real passport + real routes/auth.js, plus ONE test-only route that stands in for Google's callback.
  const router = express.Router();
  router.get('/auth/test-login', async (req, res, next) => {
    try {
      const user = await findOrCreateUser(profile(req.query.n, 'g-' + req.query.n + RUN));
      req.login(user, (e) => (e ? next(e) : res.json({ ok: true })));
    } catch (e) { next(e); }
  });
  router.use(authRoutes);
  server = createApp({ authRouter: router }).listen(0);
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  await pool.query("delete from users where email like '%' || $1 || '@test.local'", [RUN]);
  await pool.query("delete from session where sess::text like '%passport%' and expire < now() + interval '40 days'").catch(() => {});
  server.close(); await pool.end();
});

test('findOrCreateUser: new user gets default lists; returning user is the same row', async () => {
  const a = await findOrCreateUser(profile('new', 'g1' + RUN));
  assert.equal(a.email, email('new')); assert.equal(a.provider, 'google');
  const lists = await pool.query('select name from lists where user_id=$1 order by created_at', [a.id]);
  assert.deepEqual(lists.rows.map((l) => l.name), ['Daily', 'Weekly', 'Monthly']);
  const b = await findOrCreateUser(profile('new', 'g1' + RUN));
  assert.equal(b.id, a.id);
  assert.equal((await pool.query('select count(*) from lists where user_id=$1', [a.id])).rows[0].count, '3');
});

test('findOrCreateUser: links an existing email, refuses another google account, rejects bad profiles', async () => {
  const pre = await pool.query("insert into users (email, name, provider) values ($1,'Pre','google') returning id", [email('pre')]);
  const linked = await findOrCreateUser(profile('pre', 'g2' + RUN));
  assert.equal(linked.id, pre.rows[0].id); assert.equal(linked.google_id, 'g2' + RUN);
  await assert.rejects(findOrCreateUser(profile('pre', 'someone-else' + RUN)), /already linked/);
  await assert.rejects(findOrCreateUser({ id: 'x', displayName: 'No mail' }), /email/);
  await assert.rejects(findOrCreateUser(profile('unv', 'g3' + RUN, { emails: [{ value: email('unv'), verified: false }] })), /not verified/);
});

test('Google redirect uses the absolute BASE_URL callback', async () => {
  assert.equal(googleEnabled, true);
  const r = await fetch(base + '/api/auth/google', { redirect: 'manual' });
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get('location'));
  assert.equal(loc.host, 'accounts.google.com');
  assert.equal(loc.searchParams.get('redirect_uri'), 'https://tally.example.com/api/auth/google/callback');
  assert.equal(loc.searchParams.get('client_id'), 'test-client-id');
  assert.match(loc.searchParams.get('scope'), /email/);
});

test('real session round-trip: login -> /auth/me -> API -> logout -> 401', async () => {
  const login = await fetch(base + '/api/auth/test-login?n=sess');
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.match(cookie, /^tally\.sid=/);
  const hdr = { cookie };
  const me = await (await fetch(base + '/api/auth/me', { headers: hdr })).json();
  assert.equal(me.email, email('sess')); assert.deepEqual(Object.keys(me).sort(), ['email', 'id', 'name', 'provider']);   // no google_id leak
  const lists = await (await fetch(base + '/api/lists', { headers: hdr })).json();
  assert.equal(lists.length, 3);
  assert.equal((await fetch(base + '/api/lists')).status, 401);                               // no cookie
  const out = await fetch(base + '/api/auth/logout', { method: 'POST', headers: hdr });
  assert.equal((await out.json()).ok, true);
  assert.equal((await fetch(base + '/api/auth/me', { headers: hdr })).status, 401);          // old cookie is dead
  assert.equal((await fetch(base + '/api/lists', { headers: hdr })).status, 401);
});

test('a deleted user with a live cookie is signed out, not crashed', async () => {
  const login = await fetch(base + '/api/auth/test-login?n=gone');
  const hdr = { cookie: login.headers.get('set-cookie').split(';')[0] };
  assert.equal((await fetch(base + '/api/auth/me', { headers: hdr })).status, 200);
  await pool.query('delete from users where email=$1', [email('gone')]);
  assert.equal((await fetch(base + '/api/auth/me', { headers: hdr })).status, 401);
});

test('website: pages are served, Backend/ and dotfiles are NOT', async () => {
  const get = (p) => fetch(base + p, { redirect: 'manual' });
  assert.equal((await get('/')).status, 200);
  assert.match(await (await get('/')).text(), /Organize your life/);
  assert.equal((await get('/Frontend/js/api.js')).status, 200);
  assert.equal((await get('/Frontend/dashboard.html')).status, 200);
  for (const p of ['/Backend/auth.js', '/Backend/.env', '/Backend/package.json', '/.env', '/auth.js', '/Frontend/../Backend/auth.js', '/Frontend/%2e%2e/Backend/auth.js', '/Frontend/..%2fBackend%2fauth.js'])
    assert.ok([403, 404].includes((await get(p)).status), p + ' must not be served');
  const d = await get('/dashboard'); assert.equal(d.status, 302); assert.equal(d.headers.get('location'), '/Frontend/dashboard.html');
  assert.equal((await get('/task/new')).headers.get('location'), '/Frontend/dashboard.html#/task/new');
  assert.equal((await (await get('/api/health')).json()).ok, true);
});
