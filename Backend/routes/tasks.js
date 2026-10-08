import express from 'express';
import { pool, tx } from '../db.js';
import { HttpError, asyncHandler, uuidParam } from '../lib/http.js';
import { cleanTask } from '../lib/validate.js';
import { taskCols } from '../lib/sql.js';

const router = express.Router();

/** Locks and returns the task row only if it lives in one of this user's lists. */
async function lockOwnedTask(c, id, userId) {
  const r = await c.query(
    `select t.* from tasks t join lists l on l.id = t.list_id
      where t.id = $1 and l.user_id = $2 for update of t`, [id, userId]);
  if (!r.rowCount) throw new HttpError(404, 'Task not found');
  return r.rows[0];
}
async function assertOwnsList(c, listId, userId) {
  const r = await c.query('select 1 from lists where id = $1 and user_id = $2', [listId, userId]);
  if (!r.rowCount) throw new HttpError(400, 'Choose a valid list');
}
const nextOrder = async (c, listId) =>
  (await c.query('select coalesce(max(order_index), -1) + 1 as n from tasks where list_id = $1', [listId])).rows[0].n;

router.post('/tasks', asyncHandler(async (req, res) => {
  const f = cleanTask(req.body);
  if (!f.list_id) throw new HttpError(400, 'Choose a list');
  const task = await tx(async (c) => {
    await assertOwnsList(c, f.list_id, req.user.id);
    const r = await c.query(
      `insert into tasks (list_id, title, description, due_date, priority, recurrence, order_index)
       values ($1,$2,$3,$4,$5,$6,$7) returning ${taskCols()}`,
      [f.list_id, f.title, f.description, f.due_date, f.priority, f.recurrence, await nextOrder(c, f.list_id)]);
    return r.rows[0];
  });
  res.status(201).json(task);
}));

router.put('/tasks/:id', uuidParam(), asyncHandler(async (req, res) => {
  const f = cleanTask(req.body);
  const task = await tx(async (c) => {
    const cur = await lockOwnedTask(c, req.params.id, req.user.id);
    const listId = f.list_id || cur.list_id;
    let order = cur.order_index;
    if (listId !== cur.list_id) { await assertOwnsList(c, listId, req.user.id); order = await nextOrder(c, listId); }
    const r = await c.query(
      `update tasks set list_id=$2, title=$3, description=$4, due_date=$5, priority=$6, recurrence=$7,
              order_index=$8, updated_at=now()
        where id=$1 returning ${taskCols()}`,
      [cur.id, listId, f.title, f.description, f.due_date, f.priority, f.recurrence, order]);
    return r.rows[0];
  });
  res.json(task);
}));

router.delete('/tasks/:id', uuidParam(), asyncHandler(async (req, res) => {
  const r = await pool.query(
    `delete from tasks t using lists l where t.id = $1 and t.list_id = l.id and l.user_id = $2 returning t.id`,
    [req.params.id, req.user.id]);
  if (!r.rowCount) throw new HttpError(404, 'Task not found');
  res.json({ ok: true });
}));

// Toggle complete. Completing a repeating task creates its next occurrence (once).
router.patch('/tasks/:id/complete', uuidParam(), asyncHandler(async (req, res) => {
  const task = await tx(async (c) => {
    const cur = await lockOwnedTask(c, req.params.id, req.user.id);
    const done = !cur.is_complete;
    const r = await c.query(
      `update tasks set is_complete = $2, updated_at = now() where id = $1 returning ${taskCols()}`, [cur.id, done]);
    if (done && cur.recurrence !== 'none' && !cur.next_generated) {
      await c.query(
        `insert into tasks (list_id, title, description, due_date, priority, recurrence, order_index)
         select list_id, title, description,
                (coalesce(due_date, current_date) + case recurrence
                   when 'daily' then interval '1 day' when 'weekly' then interval '7 days' else interval '1 month' end)::date,
                priority, recurrence, $2
           from tasks where id = $1`, [cur.id, await nextOrder(c, cur.list_id)]);
      await c.query('update tasks set next_generated = true where id = $1', [cur.id]);
    }
    return r.rows[0];
  });
  res.json(task);
}));

export default router;
