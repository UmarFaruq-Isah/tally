/* ui.js — tiny DOM helpers shared by every page (no framework). */
(function () {
  function h(tag, attrs) {
    var e = document.createElement(tag), kids = Array.prototype.slice.call(arguments, 2);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else if (k === 'class') e.className = v;
      else if (k in e && k !== 'list' && k !== 'form') e[k] = v;
      else e.setAttribute(k, v === true ? '' : v);
    });
    (function add(list) {
      list.forEach(function (c) {
        if (c == null || c === false) return;
        if (Array.isArray(c)) return add(c);
        e.append(c.nodeType ? c : document.createTextNode(c));
      });
    })(kids);
    return e;
  }
  var ICONS = {
    grip: '<path d="M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01" stroke-width="2.6"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    back: '<path d="m15 6-6 6 6 6"/>'
  };
  function icon(name) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'icon'); s.setAttribute('aria-hidden', 'true');
    s.innerHTML = ICONS[name]; return s;
  }
  function toast(msg) {
    var r = document.querySelector('.toast-region');
    if (!r) { r = h('div', { class: 'toast-region', role: 'status', 'aria-live': 'polite' }); document.body.append(r); }
    var t = h('div', { class: 'toast' }, msg); r.append(t);
    setTimeout(function () { t.remove(); }, 3200);
  }
  /* Resolves true if the person confirms. */
  function confirmDialog(o) {
    return new Promise(function (resolve) {
      var ok = h('button', { class: 'btn btn-danger', type: 'submit', value: 'ok' }, o.confirmLabel || 'Delete');
      var dlg = h('dialog', { 'aria-labelledby': 'cd-title' },
        h('form', { class: 'dlg-form', method: 'dialog' },
          h('h2', { id: 'cd-title' }, o.title), h('p', {}, o.message),
          h('div', { class: 'dlg-actions' }, h('button', { class: 'btn btn-secondary', type: 'submit', value: 'cancel' }, 'Cancel'), ok)));
      dlg.addEventListener('close', function () { resolve(dlg.returnValue === 'ok'); dlg.remove(); });
      document.body.append(dlg); dlg.showModal();
    });
  }
  function formatDue(dateStr) {
    var d = window.Tally.util.fromDateStr(dateStr), same = d.getFullYear() === new Date().getFullYear();
    return 'Due on ' + d.toLocaleDateString('en-US', same ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
  }
  window.UI = { h: h, icon: icon, toast: toast, confirmDialog: confirmDialog, formatDue: formatDue };
})();
