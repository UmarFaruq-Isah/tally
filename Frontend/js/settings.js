/* settings.js — theme, account info, manage lists. */
(function () {
  var Api = Tally.Api, h = UI.h, $ = function (s) { return document.querySelector(s); };
  function fail(e) { UI.toast(e && e.message ? e.message : 'Something went wrong. Try again.'); }

  // Theme
  var radios = document.querySelectorAll('input[name="theme"]');
  function syncTheme() { radios.forEach(function (r) { r.checked = r.value === Theme.get(); }); }
  radios.forEach(function (r) { r.addEventListener('change', function () { Theme.set(r.value); }); });
  document.addEventListener('themechange', syncTheme); syncTheme();

  // Account
  Tally.Auth.getSession().then(function (s) {
    if (!s) { location.replace('login.html'); return; }
    var box = $('#account'); box.replaceChildren();
    if (s.type === 'guest') {
      box.append(h('strong', {}, 'Guest'), h('span', {}, 'Your tasks are saved in this browser only.'),
        h('a', { class: 'btn btn-secondary btn-sm', href: 'login.html', style: 'margin-top:.75rem;justify-self:start' }, 'Sign in with Google'));
    } else {
      box.append(h('strong', {}, s.user.name || 'Signed in'), h('span', {}, s.user.email || ''),
        h('button', { class: 'btn btn-secondary btn-sm', type: 'button', style: 'margin-top:.75rem;justify-self:start',
          onclick: function () { Tally.Auth.logout().then(function () { location.href = '../index.html?home'; }); } }, 'Sign out'));
    }
  });

  // Manage lists
  function render() {
    Api.getLists().then(function (lists) {
      var ul = $('#manage'); ul.replaceChildren();
      lists.forEach(function (l) {
        var input = h('input', { class: 'input', value: l.name, maxlength: 60, readOnly: l.is_default, 'aria-label': 'List name' });
        function save() {
          var v = input.value.trim();
          if (!v) { input.value = l.name; UI.toast('A list needs a name.'); return; }
          if (v !== l.name) Api.updateList(l.id, { name: v }).then(function () { l.name = v; UI.toast('Changes saved'); }).catch(fail);
        }
        input.addEventListener('change', save);
        ul.append(h('li', {}, input, l.is_default ? h('span', { class: 'badge' }, 'Default') :
          h('button', { class: 'icon-btn danger', type: 'button', 'aria-label': 'Delete list ' + l.name, title: 'Delete list',
            onclick: function () {
              UI.confirmDialog({ title: 'Delete list?', message: '“' + l.name + '” and every task in it will be removed permanently.', confirmLabel: 'Delete list' })
                .then(function (ok) { if (ok) return Api.deleteList(l.id).then(function () { UI.toast('List deleted'); render(); }); }).catch(fail);
            } }, UI.icon('trash'))));
      });
    }).catch(fail);
  }
  $('#add-list').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = $('#new-name').value.trim(); if (!v) { UI.toast('Enter a name for this list.'); return; }
    Api.createList({ name: v }).then(function () { $('#new-name').value = ''; UI.toast('List created'); render(); }).catch(fail);
  });
  $('#back-link').append(UI.icon('back'), 'Back to dashboard');
  render();
})();
