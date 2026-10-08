import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, seedDefaultLists, initSchema } from '../db.js';
import { createApp } from '../app.js';
import stub from './stubAuth.js';

const RUN = Date.now().toString(36);
const A = 'alice' + RUN, B = 'bob' + RUN;
let server, base;
const api = (who, method, path, body) => fetch(base + '/api' + path, {
  method, headers: { 'content-type': 'application/json', ...(who ? { 'x-test-user': who } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body)
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const listId = async (who, name) => (await api(who, 'GET', '/lists')).body.find((l) => l.name === name).id;

before(async () => {
  await initSchema();
  server = createApp({ authRouter: stub, useSession: false }).listen(0);
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  await pool.query("delete from users where email like '%' || $1 || '@test.local'", [RUN]);
  server.close(); await pool.end();
});

test('401 without a session; /auth/me works with one', async () => {
  assert.equal((await api(null, 'GET', '/lists')).status, 401);
  assert.equal((await api(null, 'POST', '/tasks', {})).status, 401);
  const me = await api(A, 'GET', '/auth/me');
  assert.equal(me.body.email, A + '@test.local');
});

test('first GET /lists seeds Daily/Weekly/Monthly once, in order', async () => {
  const [r1, r2] = await Promise.all([api(A, 'GET', '/lists'), api(A, 'GET', '/lists')]);   // concurrent first load
  assert.deepEqual(r1.body.map((l) => l.name), ['Daily', 'Weekly', 'Monthly']);
  assert.equal(r2.body.length, 3);
  assert.deepEqual(r1.body.map((l) => l.recurrence), ['daily', 'weekly', 'monthly']);
  assert.ok(r1.body.every((l) => l.is_default));
  const me = await pool.query('select id from users where email = $1', [A + '@test.local']);
  assert.equal(await seedDefaultLists(me.rows[0].id), false);            // helper for auth.js is idempotent
  assert.equal((await api(A, 'GET', '/lists')).body.length, 3);
});

test('list CRUD and default-list protection', async () => {
  const c = await api(A, 'POST', '/lists', { name: '  Groceries ' });
  assert.equal(c.status, 201); assert.equal(c.body.name, 'Groceries'); assert.equal(c.body.is_default, false);
  assert.equal((await api(A, 'POST', '/lists', { name: '   ' })).body.message, 'List name is required');
  assert.equal((await api(A, 'PUT', '/lists/' + c.body.id, { name: 'Shopping' })).body.name, 'Shopping');
  const daily = await listId(A, 'Daily');
  assert.equal((await api(A, 'DELETE', '/lists/' + daily)).status, 403);
  assert.equal((await api(A, 'PUT', '/lists/' + daily, { name: 'x' })).status, 403);
  assert.equal((await api(A, 'DELETE', '/lists/' + c.body.id)).body.ok, true);
  assert.equal((await api(A, 'DELETE', '/lists/not-a-uuid')).status, 404);
});

test('task validation returns { message } with 400', async () => {
  const list = await listId(A, 'Daily');
  const bad = async (b) => (await api(A, 'POST', '/tasks', { list_id: list, ...b }));
  assert.equal((await bad({ title: ' ' })).body.message, 'Title is required');
  assert.equal((await bad({ title: 'x', due_date: '2026-13-40' })).status, 400);
  assert.equal((await bad({ title: 'x', priority: 'urgent' })).status, 400);
  assert.equal((await bad({ title: 'x', recurrence: 'hourly' })).status, 400);
  assert.equal((await api(A, 'POST', '/tasks', { title: 'x' })).body.message, 'Choose a list');
});

test('create / read / update a task; due_date stays a plain string', async () => {
  const list = await listId(A, 'Weekly');
  const c = await api(A, 'POST', '/tasks', { list_id: list, title: 'Write report', description: 'Q3', due_date: '2026-10-05', priority: 'high', recurrence: 'none' });
  assert.equal(c.status, 201);
  assert.equal(c.body.due_date, '2026-10-05');
  assert.equal(c.body.is_complete, false);
  assert.equal('next_generated' in c.body, false);
  const u = await api(A, 'PUT', '/tasks/' + c.body.id, { list_id: list, title: 'Write final report', due_date: '', priority: 'low', recurrence: 'weekly' });
  assert.equal(u.body.title, 'Write final report'); assert.equal(u.body.due_date, null); assert.equal(u.body.recurrence, 'weekly');
  const got = (await api(A, 'GET', `/lists/${list}/tasks`)).body;
  assert.equal(got.length, 1); assert.equal(got[0].id, c.body.id);
});

test('sort, filter and search (including LIKE wildcards and hostile input)', async () => {
  const list = await listId(A, 'Monthly');
  const mk = (t, extra) => api(A, 'POST', '/tasks', { list_id: list, title: t, ...extra }).then((r) => r.body);
  const a = await mk('Old report', { due_date: '2020-01-01', priority: 'high' });
  const b = await mk('Buy milk', { due_date: today(), priority: 'low' });
  const c = await mk('100% sure_thing', { priority: 'medium' });
  const names = async (qs) => (await api(A, 'GET', `/lists/${list}/tasks${qs}`)).body.map((t) => t.title);
  assert.deepEqual(await names(''), ['Old report', 'Buy milk', '100% sure_thing']);
  assert.deepEqual(await names('?sort=priority'), ['Old report', '100% sure_thing', 'Buy milk']);
  assert.deepEqual(await names('?sort=due'), ['Old report', 'Buy milk', '100% sure_thing']);
  assert.deepEqual(await names('?sort=created'), ['100% sure_thing', 'Buy milk', 'Old report']);
  assert.deepEqual(await names('?filter=overdue'), ['Old report']);
  assert.deepEqual(await names('?filter=due_today'), ['Buy milk']);
  assert.deepEqual(await names(`?filter=due_today&today=2020-01-01`), ['Old report']);   // client calendar day wins
  assert.deepEqual(await names('?q=MILK'), ['Buy milk']);
  assert.deepEqual(await names('?q=' + encodeURIComponent('100%')), ['100% sure_thing']);
  assert.deepEqual(await names('?q=' + encodeURIComponent('%')), ['100% sure_thing']);      // % is literal, not a wildcard
  assert.deepEqual(await names('?q=' + encodeURIComponent('_')), ['100% sure_thing']);
  assert.equal((await api(A, 'GET', `/lists/${list}/tasks?sort=${encodeURIComponent('x; drop table tasks')}&filter=bogus`)).status, 200);
  await api(A, 'PATCH', `/tasks/${b.id}/complete`);
  assert.deepEqual(await names('?filter=completed'), ['Buy milk']);
  assert.deepEqual(await names('?filter=active&sort=due'), ['Old report', '100% sure_thing']);
});

test('completing a repeating task creates the next one exactly once', async () => {
  const list = await listId(A, 'Daily');
  const t = (await api(A, 'POST', '/tasks', { list_id: list, title: 'Stretch', due_date: '2026-01-31', recurrence: 'monthly' })).body;
  const done = await api(A, 'PATCH', `/tasks/${t.id}/complete`);
  assert.equal(done.body.is_complete, true);
  let rows = (await api(A, 'GET', `/lists/${list}/tasks`)).body.filter((x) => x.title === 'Stretch');
  assert.equal(rows.length, 2);
  assert.equal(rows.find((x) => x.id !== t.id).due_date, '2026-02-28');       // month-end clamps, never overflows
  assert.equal(rows.find((x) => x.id !== t.id).is_complete, false);
  await api(A, 'PATCH', `/tasks/${t.id}/complete`);                            // undo
  assert.equal((await api(A, 'PATCH', `/tasks/${t.id}/complete`)).body.is_complete, true);   // redo
  rows = (await api(A, 'GET', `/lists/${list}/tasks`)).body.filter((x) => x.title === 'Stretch');
  assert.equal(rows.length, 2, 'no duplicate on redo');
  const d = (await api(A, 'POST', '/tasks', { list_id: list, title: 'Daily no date', recurrence: 'daily' })).body;
  await api(A, 'PATCH', `/tasks/${d.id}/complete`);
  const next = (await api(A, 'GET', `/lists/${list}/tasks`)).body.find((x) => x.title === 'Daily no date' && !x.is_complete);
  assert.match(next.due_date, /^\d{4}-\d{2}-\d{2}$/);
  const plain = (await api(A, 'POST', '/tasks', { list_id: list, title: 'One-off' })).body;
  await api(A, 'PATCH', `/tasks/${plain.id}/complete`);
  assert.equal((await api(A, 'GET', `/lists/${list}/tasks`)).body.filter((x) => x.title === 'One-off').length, 1);
});

test('reorder persists, ignores foreign ids, rejects bad input', async () => {
  const l = (await api(A, 'POST', '/lists', { name: 'Order' })).body.id;
  const ids = [];
  for (const n of ['one', 'two', 'three']) ids.push((await api(A, 'POST', '/tasks', { list_id: l, title: n })).body.id);
  assert.deepEqual((await api(A, 'GET', `/lists/${l}/tasks`)).body.map((t) => t.title), ['one', 'two', 'three']);
  assert.equal((await api(A, 'PATCH', `/lists/${l}/reorder`, { ordered_ids: [ids[2], ids[0], ids[1]] })).body.ok, true);
  assert.deepEqual((await api(A, 'GET', `/lists/${l}/tasks`)).body.map((t) => t.title), ['three', 'one', 'two']);
  assert.equal((await api(A, 'PATCH', `/lists/${l}/reorder`, { ordered_ids: ['nope'] })).status, 400);
  assert.equal((await api(A, 'PATCH', `/lists/${l}/reorder`, { ordered_ids: [ids[0], ids[0]] })).status, 400);
  const t4 = (await api(A, 'POST', '/tasks', { list_id: l, title: 'four' })).body;
  assert.equal(t4.order_index, 3, 'new tasks go to the bottom');
});

test('moving a task to another list; deleting a list removes its tasks', async () => {
  const from = await listId(A, 'Daily'), to = (await api(A, 'POST', '/lists', { name: 'Elsewhere' })).body.id;
  const t = (await api(A, 'POST', '/tasks', { list_id: from, title: 'Mover' })).body;
  assert.equal((await api(A, 'PUT', '/tasks/' + t.id, { list_id: to, title: 'Mover' })).body.list_id, to);
  assert.equal((await api(A, 'GET', `/lists/${to}/tasks`)).body.length, 1);
  await api(A, 'DELETE', '/lists/' + to);
  const left = await pool.query('select 1 from tasks where id = $1', [t.id]);
  assert.equal(left.rowCount, 0);
});

test("users can never see or touch each other's data", async () => {
  const aList = await listId(A, 'Daily');
  const aTask = (await api(A, 'POST', '/tasks', { list_id: aList, title: 'Secret' })).body;
  const bLists = (await api(B, 'GET', '/lists')).body;
  assert.equal(bLists.length, 3); assert.ok(!bLists.some((l) => l.id === aList));
  assert.equal((await api(B, 'GET', `/lists/${aList}/tasks`)).status, 404);
  assert.equal((await api(B, 'PUT', '/tasks/' + aTask.id, { title: 'hacked', list_id: bLists[0].id })).status, 404);
  assert.equal((await api(B, 'PATCH', `/tasks/${aTask.id}/complete`)).status, 404);
  assert.equal((await api(B, 'DELETE', '/tasks/' + aTask.id)).status, 404);
  assert.equal((await api(B, 'POST', '/tasks', { list_id: aList, title: 'inject' })).status, 400);
  assert.equal((await api(B, 'PATCH', `/lists/${aList}/reorder`, { ordered_ids: [aTask.id] })).status, 404);
  assert.equal((await api(B, 'DELETE', '/lists/' + aList)).status, 404);
  const mine = await api(A, 'POST', '/tasks', { list_id: aList, title: 'steal' });
  assert.equal((await api(A, 'PUT', '/tasks/' + mine.body.id, { title: 'steal', list_id: bLists[0].id })).status, 400);   // can't move into B's list
  assert.equal((await api(A, 'GET', `/lists/${aList}/tasks?q=Secret`)).body.length, 1);
});

test('delete task; unknown routes and bad JSON give JSON errors', async () => {
  const list = await listId(A, 'Daily');
  const t = (await api(A, 'POST', '/tasks', { list_id: list, title: 'Temp' })).body;
  assert.equal((await api(A, 'DELETE', '/tasks/' + t.id)).body.ok, true);
  assert.equal((await api(A, 'DELETE', '/tasks/' + t.id)).status, 404);
  assert.equal((await api(A, 'GET', '/nope')).status, 404);
  const raw = await fetch(base + '/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': A }, body: '{oops' });
  assert.equal(raw.status, 400); assert.equal((await raw.json()).message, 'Invalid JSON');
});
