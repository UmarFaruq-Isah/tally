/* dashboard.js — sidebar, task list, toolbar, modal. All data goes through Tally.Api. */
(function () {
  var Api = Tally.Api, Auth = Tally.Auth, h = UI.h;
  var $ = function (s) { return document.querySelector(s); };
  var state = { lists: [], tasks: [], listId: null, sort: 'manual', filter: 'all', q: '' };
  var PRI = { high: '🔴 High', medium: '🟡 Medium', low: '🟢 Low' };
  var dlg = $('#task-dialog'), form = $('#task-form'), listDlg = $('#list-dialog');

  function fail(e) { UI.toast(e && e.message ? e.message : 'Something went wrong. Try again.'); }
  function currentList() { return state.lists.find(function (l) { return l.id === state.listId; }); }
  function dragEnabled() { return state.sort === 'manual' && state.filter === 'all' && !state.q; }

  /* URL state: ?list=&sort=&filter=&q=  (mirrors the API query params) */
  function syncUrl() {
    var p = new URLSearchParams();
    p.set('list', state.listId);
    if (state.sort !== 'manual') p.set('sort', state.sort);
    if (state.filter !== 'all') p.set('filter', state.filter);
    if (state.q) p.set('q', state.q);
    history.replaceState(null, '', location.pathname + '?' + p + location.hash);
  }

  /* ---------- sidebar ---------- */
  function renderLists() {
    var d = $('#default-lists'), c = $('#custom-lists'); d.replaceChildren(); c.replaceChildren();
    state.lists.forEach(function (l) {
      var btn = h('button', { class: 'list-link', type: 'button', 'aria-current': l.id === state.listId ? 'true' : null,
        onclick: function () { selectList(l.id); } }, h('span', {}, l.name));
      (l.is_default ? d : c).append(h('li', {}, btn));
    });
    if (!c.children.length) c.append(h('li', { class: 'side-empty' }, 'No custom lists yet.'));
  }
  function selectList(id) {
    state.listId = id; $('#app').classList.remove('nav-open');
    renderLists(); loadTasks();
  }

  /* ---------- tasks ---------- */
  function loadTasks() {
    syncUrl();
    return Api.getTasks(state.listId, { sort: state.sort, filter: state.filter, q: state.q })
      .then(function (t) { state.tasks = t; renderTasks(); }).catch(fail);
  }
  function renderTasks() {
    var list = currentList(), ul = $('#tasks'), empty = $('#empty'), drag = dragEnabled();
    $('#list-title').textContent = list ? list.name : 'Tasks';
    document.title = (list ? list.name : 'Dashboard') + ' — Tally';
    ul.replaceChildren(); empty.replaceChildren();
    var filtering = state.q || state.filter !== 'all';
    ul.hidden = !state.tasks.length; empty.hidden = !!state.tasks.length;
    $('#drag-hint').hidden = !state.tasks.length || drag;
    if (!state.tasks.length) {
      if (filtering) empty.append(h('h2', {}, 'No matching tasks'), h('p', {}, 'Try a different search or filter.'),
        h('button', { class: 'btn btn-secondary', type: 'button', onclick: clearFilters }, 'Clear search and filter'));
      else empty.append(h('h2', {}, 'No tasks yet.'), h('p', {}, 'No tasks yet. Add one to get started!'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: function () { location.hash = '#/task/new'; } }, '+ New Task'));
      return;
    }
    var today = Tally.util.today();
    state.tasks.forEach(function (t) {
      var overdue = t.due_date && !t.is_complete && t.due_date < today;
      var meta = h('span', { class: 'meta' },
        h('span', { class: 'chip ' + t.priority }, PRI[t.priority]),
        t.due_date && h('span', { class: overdue ? 'overdue' : '' }, UI.formatDue(t.due_date)),
        t.recurrence !== 'none' && h('span', {}, 'Repeats ' + t.recurrence));
      var grip = h('button', { class: 'grip', type: 'button', disabled: !drag, 'aria-label': 'Drag to reorder',
        title: drag ? 'Drag to reorder' : 'Switch to Custom order to reorder',
        onpointerdown: function () { grip.closest('li').draggable = true; },
        onpointerup: function () { grip.closest('li').draggable = false; } }, UI.icon('grip'));
      var li = h('li', { class: 'task' + (t.is_complete ? ' done' : ''), 'data-id': t.id },
        grip,
        h('input', { class: 'checkbox', type: 'checkbox', checked: t.is_complete, 'aria-label': 'Mark “' + t.title + '” complete',
          onchange: function () { toggle(t); } }),
        h('button', { class: 'task-body', type: 'button', onclick: function () { location.hash = '#/task/' + t.id + '/edit'; } },
          h('span', { class: 'task-title' }, t.title), t.description && h('span', { class: 'task-desc' }, t.description), meta),
        h('button', { class: 'icon-btn danger', type: 'button', 'aria-label': 'Delete “' + t.title + '”', title: 'Delete task',
          onclick: function () { remove(t); } }, UI.icon('trash')));
      ul.append(li);
    });
  }
  function clearFilters() {
    state.q = ''; state.filter = 'all'; $('#search').value = ''; $('#filter').value = 'all'; loadTasks();
  }
  function toggle(t) {
    Api.toggleComplete(t.id).then(function (r) {
      if (r.is_complete && t.recurrence !== 'none') UI.toast('Done. The next one is added to this list.');
      else UI.toast(r.is_complete ? 'Task completed' : 'Task reopened');
      return loadTasks();
    }).catch(fail);
  }
  function remove(t) {
    UI.confirmDialog({ title: 'Delete task?', message: '“' + t.title + '” will be removed permanently.', confirmLabel: 'Delete task' })
      .then(function (ok) { if (!ok) return; return Api.deleteTask(t.id).then(function () { UI.toast('Task deleted'); return loadTasks(); }); })
      .catch(fail);
  }

  /* ---------- drag & drop (Custom order only) ---------- */
  (function () {
    var ul = $('#tasks'), dragging = null, before = null;
    ul.addEventListener('dragstart', function (e) {
      dragging = e.target.closest && e.target.closest('.task'); if (!dragging) return;
      before = ids(); dragging.classList.add('dragging');
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragging.dataset.id); }
    });
    ul.addEventListener('dragover', function (e) {
      if (!dragging) return; e.preventDefault();
      var after = Array.prototype.filter.call(ul.children, function (c) { return c !== dragging; }).find(function (c) {
        var r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2;
      });
      if (after) ul.insertBefore(dragging, after); else ul.append(dragging);
    });
    ul.addEventListener('dragend', function () {
      if (!dragging) return;
      dragging.classList.remove('dragging'); dragging.draggable = false; dragging = null;
      var now = ids(); if (before && now.join() === before.join()) return;
      Api.reorderTasks(state.listId, now).then(loadTasks).catch(function (e) { fail(e); loadTasks(); });
    });
    function ids() { return Array.prototype.map.call(ul.children, function (c) { return c.dataset.id; }); }
  })();

  /* ---------- task modal; routes: #/task/new and #/task/:id/edit ---------- */
  var editingId = null;
  function fillListSelect(selected) {
    var sel = $('#f-list'); sel.replaceChildren();
    state.lists.forEach(function (l) { sel.append(h('option', { value: l.id, selected: l.id === selected }, l.name)); });
  }
  function openTaskDialog(task) {
    editingId = task ? task.id : null;
    $('#task-dlg-title').textContent = task ? 'Edit task' : 'New task';
    $('#f-title').value = task ? task.title : ''; $('#f-desc').value = task ? task.description : '';
    $('#f-due').value = task && task.due_date ? task.due_date : '';
    $('#f-pri').value = task ? task.priority : 'medium';
    var list = currentList();
    // New tasks in Daily/Weekly/Monthly default to that list's repeat rule.
    $('#f-rec').value = task ? task.recurrence : (list && list.recurrence) || 'none';
    fillListSelect(task ? task.list_id : state.listId);
    $('#f-title-err').hidden = true; $('#f-title').removeAttribute('aria-invalid');
    if (!dlg.open) dlg.showModal();
    $('#f-title').focus();
  }
  function route() {
    var m = location.hash.match(/^#\/task\/(?:(new)|([^/]+)\/edit)$/);
    if (!m) { if (dlg.open) dlg.close(); return; }
    if (m[1]) return openTaskDialog(null);
    var t = state.tasks.find(function (x) { return x.id === m[2]; });
    if (!t) { history.replaceState(null, '', location.pathname + location.search); UI.toast('That task could not be found.'); return; }
    openTaskDialog(t);
  }
  dlg.addEventListener('close', function () {
    if (location.hash.indexOf('#/task') === 0) history.replaceState(null, '', location.pathname + location.search);
  });
  $('#task-cancel').addEventListener('click', function () { dlg.close(); });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var title = $('#f-title').value.trim();
    if (!title) { $('#f-title-err').hidden = false; $('#f-title').setAttribute('aria-invalid', 'true'); $('#f-title').focus(); return; }
    var body = { title: title, description: $('#f-desc').value, due_date: $('#f-due').value || null, priority: $('#f-pri').value,
      recurrence: $('#f-rec').value, list_id: $('#f-list').value };
    var req = editingId ? Api.updateTask(editingId, body) : Api.createTask(body);
    req.then(function () { dlg.close(); UI.toast(editingId ? 'Changes saved' : 'Task added'); return loadTasks(); }).catch(fail);
  });

  /* ---------- new list ---------- */
  $('#new-list-btn').addEventListener('click', function () {
    $('#l-name').value = ''; $('#l-name-err').hidden = true; listDlg.showModal(); $('#l-name').focus();
  });
  $('#list-cancel').addEventListener('click', function () { listDlg.close(); });
  $('#list-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('#l-name').value.trim();
    if (!name) { $('#l-name-err').hidden = false; $('#l-name').focus(); return; }
    Api.createList({ name: name }).then(function (l) {
      listDlg.close(); state.lists.push(l); UI.toast('List created'); selectList(l.id);
    }).catch(fail);
  });

  /* ---------- toolbar & chrome ---------- */
  var timer;
  $('#search').addEventListener('input', function (e) { clearTimeout(timer); timer = setTimeout(function () { state.q = e.target.value.trim(); loadTasks(); }, 200); });
  $('#filter').addEventListener('change', function (e) { state.filter = e.target.value; loadTasks(); });
  $('#sort').addEventListener('change', function (e) { state.sort = e.target.value; loadTasks(); });
  $('#new-task-btn').addEventListener('click', function () { location.hash = '#/task/new'; });
  $('#menu-btn').append(UI.icon('menu'));
  $('#menu-btn').addEventListener('click', function () { $('#app').classList.add('nav-open'); });
  $('#scrim').addEventListener('click', function () { $('#app').classList.remove('nav-open'); });
  window.addEventListener('hashchange', route);
  $('.search').prepend(UI.icon('search'));

  /* ---------- boot ---------- */
  Auth.getSession().then(function (s) {
    if (!s) { location.replace('login.html'); return; }
    return Api.getLists().then(function (lists) {
      state.lists = lists;
      var p = new URLSearchParams(location.search);
      state.listId = lists.some(function (l) { return l.id === p.get('list'); }) ? p.get('list') : lists[0].id;
      state.sort = ['manual', 'created', 'due', 'priority'].indexOf(p.get('sort')) > -1 ? p.get('sort') : 'manual';
      state.filter = ['all', 'active', 'completed', 'due_today', 'overdue'].indexOf(p.get('filter')) > -1 ? p.get('filter') : 'all';
      state.q = p.get('q') || '';
      $('#sort').value = state.sort; $('#filter').value = state.filter; $('#search').value = state.q;
      renderLists();
      return loadTasks().then(route);
    });
  }).catch(fail);
})();
