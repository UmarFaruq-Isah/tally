import express from 'express';
import { pool, seedDefaultLists } from '../db.js';
import { HttpError, asyncHandler, isUuid, uuidParam } from '../lib/http.js';
import { cleanListName } from '../lib/validate.js';
import { taskCols, LIST_COLS } from '../lib/sql.js';

const router = express.Router();
const SORTS = {
  manual: 't.order_index asc, t.created_at asc',
  created: 't.created_at desc',
  due: 't.due_date asc nulls last, t.created_at asc',
  priority: "case t.priority when 'high' then 3 when 'medium' then 2 else 1 end desc, t.created_at asc"
};
const FILTERS = {
  active: 'and not t.is_complete',
  completed: 'and t.is_complete',
  due_today: 'and t.due_date = $TODAY',
  overdue: 'and not t.is_complete and t.due_date < $TODAY'
};

async function ownedList(id, userId) {
  const r = await pool.query(`select ${LIST_COLS} from lists where id = $1 and user_id = $2`, [id, userId]);
  if (!r.rowCount) throw new HttpError(404, 'List not found');
  return r.rows[0];
}

router.get('/lists', asyncHandler(async (req, res) => {
  await seedDefaultLists(req.user.id);   // no-op once the user has their defaults
  const r = await pool.query(
    `select ${LIST_COLS} from lists where user_id = $1 order by is_default desc, created_at asc, id`, [req.user.id]);
  res.json(r.rows);
}));

router.post('/lists', asyncHandler(async (req, res) => {
  const name = cleanListName(req.body && req.body.name);
  const r = await pool.query(
    `insert into lists (user_id, name) values ($1, $2) returning ${LIST_COLS}`, [req.user.id, name]);
  res.status(201).json(r.rows[0]);
}));

router.put('/lists/:id', uuidParam(), asyncHandler(async (req, res) => {
  const list = await ownedList(req.params.id, req.user.id);
  if (list.is_default) throw new HttpError(403, 'Default lists cannot be renamed');
  const name = cleanListName(req.body && req.body.name);
  const r = await pool.query(`update lists set name = $1 where id = $2 returning ${LIST_COLS}`, [name, list.id]);
  res.json(r.rows[0]);
}));

router.delete('/lists/:id', uuidParam(), asyncHandler(async (req, res) => {
  const list = await ownedList(req.params.id, req.user.id);
  if (list.is_default) throw new HttpError(403, 'Default lists cannot be deleted');
  await pool.query('delete from lists where id = $1', [list.id]);   // tasks go with it (on delete cascade)
  res.json({ ok: true });
}));

// GET /lists/:id/tasks?sort=&filter=&q=&today=YYYY-MM-DD
router.get('/lists/:id/tasks', uuidParam(), asyncHandler(async (req, res) => {
  const list = await ownedList(req.params.id, req.user.id);
  const { sort, filter, q, today } = req.query;
  const params = [list.id];
  let where = 't.list_id = $1';
  if (typeof q === 'string' && q.trim()) {
    params.push('%' + q.trim().slice(0, 100).replace(/[\\%_]/g, '\\$&') + '%');
    where += ` and (t.title ilike $${params.length} or t.description ilike $${params.length})`;
  }
  if (typeof filter === 'string' && FILTERS[filter]) {
    // "today" comes from the browser so overdue / due-today match the user's own calendar day.
    let todaySql = 'current_date';
    if (typeof today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(today)) { params.push(today); todaySql = `$${params.length}::date`; }
    where += ' ' + FILTERS[filter].split('$TODAY').join(todaySql);
  }
  const order = SORTS[sort] || SORTS.manual;
  const r = await pool.query(`select ${taskCols('t.')} from tasks t where ${where} order by ${order}`, params);
  res.json(r.rows);
}));

// Drag-and-drop: body { ordered_ids: [taskId, ...] } in the new top-to-bottom order.
router.patch('/lists/:id/reorder', uuidParam(), asyncHandler(async (req, res) => {
  const list = await ownedList(req.params.id, req.user.id);
  const ids = req.body && req.body.ordered_ids;
  if (!Array.isArray(ids) || ids.length > 1000 || !ids.every(isUuid) || new Set(ids).size !== ids.length)
    throw new HttpError(400, 'ordered_ids must be a list of unique task ids');
  await pool.query(
    `update tasks t set order_index = (v.pos - 1)::int
       from unnest($1::uuid[]) with ordinality as v(id, pos)
      where t.id = v.id and t.list_id = $2`, [ids, list.id]);
  res.json({ ok: true });
}));

export default router;
