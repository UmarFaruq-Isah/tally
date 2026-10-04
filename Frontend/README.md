# Tally — frontend

Vanilla HTML/CSS/JS, no build step. Everything the UI knows about data lives in **one file: `js/api.js`**.

## Run it
```
python3 -m http.server 8123      # or: npx serve .
open http://localhost:8123
```
It works today in guest mode (tasks saved in `localStorage`, key `tm.data.v1`).

## Structure
| Blueprint route | File | Notes |
|---|---|---|
| `/` | `index.html` + `js/landing.js` | Hero, CTA, theme toggle |
| `/login` | `login.html` | Google button + "Continue without account" |
| `/dashboard` | `dashboard.html` + `js/dashboard.js` | Sidebar, search, filter, sort, drag-and-drop |
| `/task/new`, `/task/:id/edit` | modal in `dashboard.html` | Opened via `#/task/new` and `#/task/<id>/edit` |
| `/settings` | `settings.html` + `js/settings.js` | Theme, account, manage lists |

Shared: `css/styles.css` (design tokens at the top), `js/theme.js` (theme, loaded in `<head>`), `js/ui.js` (DOM helpers, toast, confirm dialog).
With Express, serve this folder statically and map `/`, `/login`, `/dashboard`, `/settings` to the matching `.html` files (links currently use the `.html` names).

## Going live: switch `CONFIG.MODE` to `'remote'` in `js/api.js`
Set `API_BASE` to your Express origin. Requests use `credentials: 'include'`, so enable CORS with credentials (or serve both from one origin).

| Frontend call | Request | Expected response |
|---|---|---|
| `Auth.getSession()` | `GET /auth/me` | user `{id,email,name,provider}`; **401** if not signed in |
| `Auth.loginWithGoogle()` | browser redirect to `GET /auth/google` | (adjust if you use `POST /auth/google` with a token) |
| `Api.getLists()` | `GET /lists` | `[{id,name,is_default,recurrence,created_at}]` |
| `Api.createList({name})` | `POST /lists` | the new list |
| `Api.updateList(id,{name})` | `PUT /lists/:id` | the updated list |
| `Api.deleteList(id)` | `DELETE /lists/:id` | `{ok:true}`; refuse default lists (403); delete its tasks |
| `Api.getTasks(listId,{sort,filter,q})` | `GET /lists/:id/tasks?sort=&filter=&q=` | `[task]` already sorted/filtered |
| `Api.createTask(body)` | `POST /tasks` | the new task |
| `Api.updateTask(id,body)` | `PUT /tasks/:id` | the updated task |
| `Api.deleteTask(id)` | `DELETE /tasks/:id` | `{ok:true}` |
| `Api.toggleComplete(id)` | `PATCH /tasks/:id/complete` | updated task; **create the next occurrence** if recurring |
| `Api.reorderTasks(listId,ids)` | `PATCH /lists/:id/reorder` body `{ordered_ids:[...]}` | `{ok:true}` — **not in the blueprint, add it** |

Task body/response fields: `title, description, due_date ('YYYY-MM-DD'|null), priority ('low'|'medium'|'high'), recurrence ('none'|'daily'|'weekly'|'monthly'), list_id`, plus `id, is_complete, order_index, created_at, updated_at`.
Query values: `sort` = `manual | created | due | priority`; `filter` = `all | active | completed | due_today | overdue`.
Error shape the UI shows: `{ "message": "Title is required" }` with a 4xx status.

## Schema changes the frontend needs
- `tasks.order_index` (int) — the blueprint's drag-and-drop mentions it but the table doesn't list it.
- Default lists (Daily/Weekly/Monthly) should be created per user on first login. New tasks in them pre-select the list's `recurrence` as their repeat rule.
- Guest tasks stay local; after Google sign-in you may want an "import local tasks" step (read `tm.data.v1`).

## Tested behaviour (guest mode)
Create/edit/delete tasks, validation, completion, recurrence spawning, search, filters, sorts, drag reorder, custom lists, deep links, theme persistence, settings list management.
