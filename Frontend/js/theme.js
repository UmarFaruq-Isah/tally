/* Theme: load in <head> (no defer) so the right theme is set before first paint.
   Persists to localStorage ("tm.theme") and drives CSS variables via <html data-theme>. */
(function () {
  var KEY = 'tm.theme';
  function stored() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function initial() {
    return stored() || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }
  function apply(t) { document.documentElement.setAttribute('data-theme', t); }
  apply(initial());
  window.Theme = {
    get: function () { return document.documentElement.getAttribute('data-theme'); },
    set: function (t) {
      try { localStorage.setItem(KEY, t); } catch (e) {}
      apply(t);
      document.dispatchEvent(new CustomEvent('themechange', { detail: t }));
    },
    toggle: function () { this.set(this.get() === 'dark' ? 'light' : 'dark'); }
  };
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
      function sync() {
        var dark = Theme.get() === 'dark';
        b.textContent = dark ? '☀️' : '🌙';
        b.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
        b.setAttribute('title', dark ? 'Light mode' : 'Dark mode');
      }
      sync();
      b.addEventListener('click', function () { Theme.toggle(); });
      document.addEventListener('themechange', sync);
    });
  });
})();
