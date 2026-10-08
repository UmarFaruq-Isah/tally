/* =====================================================================
   api.js — the ONLY file that talks to data.
   The UI calls window.Tally.Api / window.Tally.Auth and never touches
   localStorage or fetch directly.
   - Guests (no account) always use localStorage.
   - Signed-in users use the Express API under /api (same origin as the page).
   - On GitHub Pages there is no API, so the site runs as a guest-only demo and
     "Sign in with Google" hands off to the real app at CONFIG.APP_URL.
   ===================================================================== */
(function () {
  // GitHub Pages can only host static files, so it can never reach the API.
  var IS_PAGES = /\.github\.io$/.test(location.hostname);
  var CONFIG = {
    MODE: IS_PAGES ? 'local' : 'remote',   // 'remote' = signed-in users use the API | 'local' = guest-only
    API_BASE: '/api',                      // same origin as the page (Express serves this frontend)
    APP_URL: 'https://tally-6cxz.onrender.com'                            // your Render URL, e.g. 'https://tally.onrender.com' (no trailing slash).
                                           // Used by the GitHub Pages demo to send people to the full app.
  };

  /* ---------- shared helpers ---------- */
  var DATA_KEY = 'tm.data.v1', SESSION_KEY = 'tm.session';
  var PRIORITY_RANK = { high: 3, medium: 2, low: 1 };
  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
  function nowIso() { return new Date().toISOString(); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function toDateStr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fromDateStr(s) { var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function today() { return toDateStr(new Date()); }
  function httpError(status, message) { var e = new Error(message); e.status = status; return e; }
  function nextDate(dateStr, rule) {
    var d = dateStr ? fromDateStr(dateStr) : new Date();
    if (rule === 'daily') d.setDate(d.getDate() + 1);
    else if (rule === 'weekly') d.setDate(d.getDate() + 7);
    else if (rule === 'monthly') d.setMonth(d.getMonth() + 1);
    return toDateStr(d);
  }

  /* ---------- LOCAL adapter (guest mode) ---------- */
  var Local = (function () {
    function seed() {
      var t = nowIso();
      var d = {
        lists: ['Daily', 'Weekly', 'Monthly'].map(function (n) {
          return { id: uid(), user_id: null, name: n, is_default: true, recurrence: n.toLowerCase(), created_at: t };
        }),
        tasks: []
      };
      write(d); return d;
    }
    function read() {
      try { var d = JSON.parse(localStorage.getItem(DATA_KEY)); if (d && d.lists && d.tasks) return d; } catch (e) {}
      return seed();
    }
    function write(d) { localStorage.setItem(DATA_KEY, JSON.stringify(d)); }
    function clean(t, ctx) {
      var title = String(t.title || '').trim();
      if (!title) throw httpError(400, 'Title is required');
      return {
        title: title,
        description: String(t.description || '').trim(),
        due_date: t.due_date || null,
        priority: ['low', 'medium', 'high'].indexOf(t.priority) > -1 ? t.priority : 'medium',
        recurrence: ['none', 'daily', 'weekly', 'monthly'].indexOf(t.recurrence) > -1 ? t.recurrence : 'none',
        list_id: t.list_id || (ctx && ctx.list_id)
      };
    }
    function applyQuery(tasks, o) {
      var t = today(), q = (o.q || '').trim().toLowerCase();
      var out = tasks.filter(function (x) {
        if (q && (x.title + ' ' + x.description).toLowerCase().indexOf(q) < 0) return false;
        switch (o.filter) {
          case 'active': return !x.is_complete;
          case 'completed': return x.is_complete;
          case 'due_today': return x.due_date === t;
          case 'overdue': return !x.is_complete && x.due_date && x.due_date < t;
          default: return true;
        }
      });
      var by = {
        created: function (a, b) { return a.created_at < b.created_at ? 1 : -1; },
        due: function (a, b) { return (a.due_date || '9999') < (b.due_date || '9999') ? -1 : 1; },
        priority: function (a, b) { return PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]; },
        manual: function (a, b) { return a.order_index - b.order_index; }
      };
      return out.sort(by[o.sort] || by.manual);
    }
    return {
      me: function () { return { id: 'guest', name: 'Guest', email: null, provider: 'local' }; },
      lists: function () { return read().lists; },
      createList: function (b) {
        var name = String(b.name || '').trim(); if (!name) throw httpError(400, 'List name is required');
        var d = read(), l = { id: uid(), user_id: null, name: name, is_default: false, recurrence: 'none', created_at: nowIso() };
        d.lists.push(l); write(d); return l;
      },
      updateList: function (id, b) {
        var d = read(), l = d.lists.find(function (x) { return x.id === id; }); if (!l) throw httpError(404, 'List not found');
        var name = String(b.name || '').trim(); if (!name) throw httpError(400, 'List name is required');
        l.name = name; write(d); return l;
      },
      deleteList: function (id) {
        var d = read(), l = d.lists.find(function (x) { return x.id === id; });
        if (!l) throw httpError(404, 'List not found'); if (l.is_default) throw httpError(403, 'Default lists cannot be deleted');
        d.lists = d.lists.filter(function (x) { return x.id !== id; });
        d.tasks = d.tasks.filter(function (x) { return x.list_id !== id; }); write(d); return { ok: true };
      },
      tasks: function (listId, o) { return applyQuery(read().tasks.filter(function (t) { return t.list_id === listId; }), o || {}); },
      createTask: function (b) {
        var d = read(), c = clean(b); if (!d.lists.some(function (l) { return l.id === c.list_id; })) throw httpError(400, 'Choose a list');
        var max = d.tasks.filter(function (t) { return t.list_id === c.list_id; }).reduce(function (m, t) { return Math.max(m, t.order_index); }, -1);
        var t = Object.assign({ id: uid(), is_complete: false, order_index: max + 1, created_at: nowIso(), updated_at: nowIso() }, c);
        d.tasks.push(t); write(d); return t;
      },
      updateTask: function (id, b) {
        var d = read(), t = d.tasks.find(function (x) { return x.id === id; }); if (!t) throw httpError(404, 'Task not found');
        var c = clean(b, t);
        if (c.list_id !== t.list_id) c.order_index = d.tasks.filter(function (x) { return x.list_id === c.list_id; }).length;
        Object.assign(t, c, { updated_at: nowIso() }); write(d); return t;
      },
      deleteTask: function (id) { var d = read(); d.tasks = d.tasks.filter(function (t) { return t.id !== id; }); write(d); return { ok: true }; },
      toggle: function (id) {
        var d = read(), t = d.tasks.find(function (x) { return x.id === id; }); if (!t) throw httpError(404, 'Task not found');
        t.is_complete = !t.is_complete; t.updated_at = nowIso();
        // Recurrence: completing a repeating task creates its next occurrence (once).
        if (t.is_complete && t.recurrence !== 'none' && !t.next_generated) {
          t.next_generated = true;
          var max = d.tasks.filter(function (x) { return x.list_id === t.list_id; }).reduce(function (m, x) { return Math.max(m, x.order_index); }, -1);
          d.tasks.push({ id: uid(), list_id: t.list_id, title: t.title, description: t.description, due_date: nextDate(t.due_date, t.recurrence),
            priority: t.priority, is_complete: false, recurrence: t.recurrence, order_index: max + 1, created_at: nowIso(), updated_at: nowIso() });
        }
        write(d); return t;
      },
      reorder: function (listId, ids) {
        var d = read();
        ids.forEach(function (id, i) { var t = d.tasks.find(function (x) { return x.id === id && x.list_id === listId; }); if (t) t.order_index = i; });
        write(d); return { ok: true };
      }
    };
  })();

  /* ---------- REMOTE adapter (Express) ---------- */
  function request(method, path, body) {
    return fetch(CONFIG.API_BASE + path, {
      method: method, credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      if (res.status === 204) return { ok: true };
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401 && path !== '/auth/me') {      // session expired: back to sign-in
          localStorage.removeItem(SESSION_KEY); location.replace('login.html');
        }
        if (!res.ok) throw httpError(res.status, data.message || 'Something went wrong');
        return data;
      });
    });
  }
  function qs(o) {
    var p = new URLSearchParams();
    Object.keys(o || {}).forEach(function (k) { if (o[k]) p.set(k, o[k]); });
    var s = p.toString(); return s ? '?' + s : '';
  }
  var Remote = {
    me: function () { return request('GET', '/auth/me'); },
    lists: function () { return request('GET', '/lists'); },
    createList: function (b) { return request('POST', '/lists', b); },
    updateList: function (id, b) { return request('PUT', '/lists/' + id, b); },
    deleteList: function (id) { return request('DELETE', '/lists/' + id); },
    tasks: function (listId, o) { return request('GET', '/lists/' + listId + '/tasks' + qs({ sort: o.sort, filter: o.filter, q: o.q, today: today() })); },
    createTask: function (b) { return request('POST', '/tasks', b); },
    updateTask: function (id, b) { return request('PUT', '/tasks/' + id, b); },
    deleteTask: function (id) { return request('DELETE', '/tasks/' + id); },
    toggle: function (id) { return request('PATCH', '/tasks/' + id + '/complete'); },
    reorder: function (listId, ids) { return request('PATCH', '/lists/' + listId + '/reorder', { ordered_ids: ids }); }
  };

  /* ---------- public API (always async, so local and remote behave the same) ---------- */
  // Guests always use localStorage; signed-in users (session flag 'user') use the Express API.
  function pick() { return CONFIG.MODE === 'remote' && localStorage.getItem(SESSION_KEY) === 'user' ? Remote : Local; }
  function call(fn) {
    return function () {
      var a = arguments, ad = pick();
      return Promise.resolve().then(function () { return ad[fn].apply(ad, a); }).then(clone);
    };
  }
  var Api = {
    getLists: call('lists'), createList: call('createList'), updateList: call('updateList'), deleteList: call('deleteList'),
    getTasks: call('tasks'), createTask: call('createTask'), updateTask: call('updateTask'), deleteTask: call('deleteTask'),
    toggleComplete: call('toggle'), reorderTasks: call('reorder')
  };

  var Auth = {
    isRemote: CONFIG.MODE === 'remote',
    /* Resolves { type:'user'|'guest', user } or null (not signed in). */
    getSession: function () {
      var flag = localStorage.getItem(SESSION_KEY);
      if (flag === 'guest') return Promise.resolve({ type: 'guest', user: Local.me() });
      if (CONFIG.MODE !== 'remote') return Promise.resolve(null);
      return Remote.me()
        .then(function (u) { localStorage.setItem(SESSION_KEY, 'user'); return { type: 'user', user: u }; })
        .catch(function (e) {
          if (e.status === 401) localStorage.removeItem(SESSION_KEY);
          else throw e;                                   // server unreachable: surface it, don't sign out
          return null;
        });
    },
    continueAsGuest: function () { localStorage.setItem(SESSION_KEY, 'guest'); },
    /* Remote: hand off to the backend OAuth route. Local-only mode: not available. */
    loginWithGoogle: function () {
      if (CONFIG.MODE !== 'remote') {                     // static demo: continue on the real app, if configured
        if (!CONFIG.APP_URL) return false;
        location.href = CONFIG.APP_URL + CONFIG.API_BASE + '/auth/google'; return true;
      }
      localStorage.removeItem(SESSION_KEY);               // so getSession asks the server when we come back
      location.href = CONFIG.API_BASE + '/auth/google'; return true;
    },
    /* Always resolves; clears the local flag even if the server call fails. */
    logout: function () {
      var done = function () { localStorage.removeItem(SESSION_KEY); };
      var wasUser = localStorage.getItem(SESSION_KEY) === 'user';
      if (CONFIG.MODE !== 'remote' || !wasUser) { done(); return Promise.resolve(); }
      return request('POST', '/auth/logout').then(done, done);
    }
  };

  window.Tally = { CONFIG: CONFIG, Api: Api, Auth: Auth, util: { today: today, fromDateStr: fromDateStr } };
})();
