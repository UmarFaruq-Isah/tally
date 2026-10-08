import { HttpError, isUuid } from './http.js';
const PRIORITIES = ['low', 'medium', 'high'];
const RECURRENCES = ['none', 'daily', 'weekly', 'monthly'];

export function cleanListName(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) throw new HttpError(400, 'List name is required');
  if (s.length > 60) throw new HttpError(400, 'List name must be 60 characters or fewer');
  return s;
}

export function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}

/** Validates a task body (create or full update). Returns clean fields; list_id may be undefined. */
export function cleanTask(b) {
  b = b || {};
  const title = String(b.title == null ? '' : b.title).trim();
  if (!title) throw new HttpError(400, 'Title is required');
  if (title.length > 200) throw new HttpError(400, 'Title must be 200 characters or fewer');
  const description = String(b.description == null ? '' : b.description).trim();
  if (description.length > 2000) throw new HttpError(400, 'Description must be 2000 characters or fewer');
  let due = b.due_date;
  if (due === '' || due === undefined) due = null;
  if (due !== null && !(typeof due === 'string' && isRealDate(due))) throw new HttpError(400, 'Due date must look like YYYY-MM-DD');
  const priority = b.priority == null ? 'medium' : b.priority;
  if (!PRIORITIES.includes(priority)) throw new HttpError(400, 'Priority must be low, medium or high');
  const recurrence = b.recurrence == null ? 'none' : b.recurrence;
  if (!RECURRENCES.includes(recurrence)) throw new HttpError(400, 'Repeat must be none, daily, weekly or monthly');
  if (b.list_id != null && !isUuid(b.list_id)) throw new HttpError(400, 'Choose a valid list');
  return { title, description, due_date: due, priority, recurrence, list_id: b.list_id || undefined };
}
