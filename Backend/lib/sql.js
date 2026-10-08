/** Columns sent to the frontend (never next_generated). `p` = optional table alias prefix, e.g. "t.". */
export const taskCols = (p = '') =>
  ['id', 'list_id', 'title', 'description', 'due_date', 'priority', 'is_complete', 'recurrence', 'order_index', 'created_at', 'updated_at']
    .map((c) => p + c).join(', ');
export const LIST_COLS = 'id, name, is_default, recurrence, created_at';
